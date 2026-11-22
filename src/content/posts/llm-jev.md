---
title: How Jev Works
date: 2026-11-11
updated: 2026-11-20
description: 从判断的计算形式、概率校准的数学和输入复用的成本结构，讲清 Jev 这条技术路线的工作原理。
tags: [LLM, Jev, System-One, RLCD, 推理]
category: LLM
episode: 6
draft: true
lang: zh_CN
---

# 前言

打开 [TypeSafe 的发布页](https://typesafe.ai/blog/introducing-system-one-models-and-jev)，快近 200 倍、便宜 400 多倍、不会幻觉，几句话就把期待拉满了。独立评测随后又发现了选项敏感性、相关错误等问题。宣传和质疑放在一边，真正值得弄清楚的是：把「判断」从「生成」里拆出来，计算上到底发生了什么变化。

本文把 Jev 当作一条技术路线的名字：**为判断而非生成设计的模型**。TypeSafe 的 Jev 是目前最完整的商业实现，开源 judgment model 和论文里的 decision model 都在这条路上。参考 `jev-1.14.0` 的公开文档与源码，我们从一次判断的计算形式讲起，推到概率的数学含义，再算清成本和边界。读完应当能自己写出这条路线最核心的几个公式，并知道每个数字意味着什么。

# 模型架构

## 读出方式

先回忆生成模型的读出方式。自回归 LLM 在位置 $t$ 的隐藏状态为 $h_t$，词表为 $V$，输出头给出整个词表上的分布：

$$
P(x_{t+1}=v\mid x_{\le t})=\operatorname{softmax}(W_V h_t)_v,\qquad v\in V.
$$

每步只在 $|V|$ 个候选里取一个 token，再把它拼回上下文算下一步。即使只要一个 JSON，也要把字段名、引号、数字、标点逐个生成出来。

判断模型的读出不同。记共享状态为 $s$，第 $i$ 个问题为 $q_i$，候选集合及定义为 $C_i$。状态编码一次后，判断头为每个候选产出 logit，再在这个小集合上归一化：

$$
p_i=\operatorname{softmax}\big(g_\theta(h_s,h_{q_i},C_i)\big),\qquad |C_i|=n,\ n\le 255.
$$

差别不在于「也是 Transformer」，而在于读出端：词表大小通常是几万，候选集只有 2 到 255；生成要串行解码 $L$ 步，判断一次就得到整份分布。这就是这条路线最核心的计算事实，后面所有速度和成本结论都从它推出来。

Noul 是这个形式在 $n=2$ 时的特例。若 yes 与 no 的 logit 分别为 $z_1,z_0$，两项 softmax 就是 sigmoid：

$$
p(\text{yes})=\frac{e^{z_1}}{e^{z_1}+e^{z_0}}=\sigma(z_1-z_0).
$$

所以 Noul 只返回 yes 的概率，不需要额外的置信度字段：二元情形下，概率本身就写完了分布。

Score 则是在等级分布上取位置期望。第 $j$ 档概率为 $r_j$，共 $m$ 档，从 0 编号：

$$
v=\sum_{j=0}^{m-1}j\,r_j.
$$

例如三档概率 $[0.1,0.3,0.6]$，$v=0\times0.1+1\times0.3+2\times0.6=1.5$。它表示分布在标尺上的重心，不是 1.5 小时，也不是发生概率。注意[官方接口](https://docs.typesafe.ai/primitives/score)让每档判据分别评价，模型看不到档位序号和相邻档位，所以「比上一档更紧急」不是合法判据，每一档必须能独立定义。

下图左边是生成模型的读出循环，右边是判断模型的一次归一化，输出端就是这份分布。

![生成模型逐步生成 token，判断模型在候选集上一次归一化并输出分布](/img/posts/llm-jev/readout.svg)

## 共享状态

一次请求包含共享状态 `state` 和一组 `questions`。工单正文只放一份，退款意图、重复扣款、紧急程度分别提问。

![同一 state 进入三个独立判断头并行输出分布，有依赖的问题由程序分轮处理](/img/posts/llm-jev/state-questions.svg)

沿图走一遍：状态进入模型，三个问题各拿一份分布；业务代码再查数据库、套退款规则，最后才决定动作。「有退款意图」只是条件之一，账务记录不支持重复扣款时，模型再自信也不该触发退款。

问题之间的独立性要写成条件形式才不容易误读：对同一状态 $s$，接口近似满足

$$
p(q_1,q_2\mid s)\approx p(q_1\mid s)\,p(q_2\mid s),
$$

也就是说，**一批返回不等于语义融合**。模型并不利用「退款意图」的答案去帮助判断「紧急程度」。如果后一题需要前一题的结果，比如先选中订单再查支付，就必须由程序接过输出，发起下一轮。

批处理因此只消除人为排出来的等待，不能消除真实的数据依赖。把「先找订单，再查支付，最后退款」塞成三个问题，后两题不会自动拿到前面的结果。

# 概率校准

## 校准误差

接口返回概率，不代表概率可信。校准的定义很具体：把所有预测约为 0.8 的事件放在一起，其中应约有 80% 真的发生。它约束的是一组预测的统计表现，不是给眼前这一题盖章。

把样本 $(p_k,y_k)$ 按预测概率分桶，第 $m$ 桶为 $B_m$，桶内平均置信为 $\bar p_m$，实际频率为 $\bar y_m$。常用的期望校准误差为

$$
\mathrm{ECE}=\sum_m\frac{|B_m|}{N}\,\big|\bar y_m-\bar p_m\big|,
$$

另一个常用量是 Brier score：

$$
\mathrm{BS}=\frac1N\sum_{k=1}^{N}(p_k-y_k)^2.
$$

两个公式都需要数字才有意义。取四个样本，真实标签为 $[1,1,0,0]$，比较两组预测：

| 预测 | 准确率 | Brier score | ECE |
| --- | ---: | ---: | ---: |
| 全部 0.9 | 50% | $(0.01+0.01+0.81+0.81)/4=0.41$ | 0.40 |
| 全部 0.6 | 50% | $(0.16+0.16+0.36+0.36)/4=0.26$ | 0.10 |

两组准确率完全一样，但 0.9 组明显过度自信，Brier score 和 ECE 都更差。这就是「准确率」和「校准」必须分开讨论的原因：只报准确率，0.9 组看起来没有毛病。

[RLCD](https://docs.typesafe.ai/introduction/machine-learning-primer) 全名 Reinforcement Learning for Calibrated Decisions，核心是把这种概率与频率的一致性写进训练目标，而不是训练完再做温度缩放。相较于 [RLHF](../llm-ppo/)围绕偏好优化回答，这里优化的是概率数值本身。

![可靠性图与两组预测对照：准确率相同，0.9 组的 Brier 与 ECE 更差](/img/posts/llm-jev/calibration-error.svg)

## 置信度

Jev 的 `confidence` 与校准又是另一件事。对有 $n$ 个选项的 Choice，设最大候选概率为 $p_{\max}$，官方[计算方式](https://docs.typesafe.ai/confidence)为

$$
c=\frac{p_{\max}-1/n}{1-1/n},\qquad n\ge2.
$$

它只是对最大概率做线性重标定：均匀分布 $p_{\max}=1/n$ 时为 0，one-hot 时为 1。三个选项最高概率 0.8，$c=(0.8-1/3)/(2/3)=0.7$。

所以 confidence 是**分布集中程度的几何量，不是答对的概率**。回到上面的例子：0.9 组的 confidence 显然高于 0.6 组，但 Brier score 反而更差。选项数固定时，confidence 与 $p_{\max}$ 一一对应，同时看两个数不会多出一份独立证据。

![confidence 是 p_max 的线性重标定：均匀分布为 0，one-hot 为 1，0.8 对应 0.70](/img/posts/llm-jev/confidence-rescale.svg)

## 代码实现

下面用本地标准库验证这三个量。概率与标签均为教学数据，不是 Jev 实测输出。

```python
from math import isclose, isfinite


def check_probs(probs):
    if not probs or any(not isfinite(p) or p < 0 or p > 1 for p in probs):
        raise ValueError("概率必须在 [0, 1] 内")
    if not isclose(sum(probs), 1.0, rel_tol=0, abs_tol=1e-9):
        raise ValueError("概率之和必须为 1")


def choice_confidence(probs):
    check_probs(probs)
    n = len(probs)
    if not 2 <= n <= 255:
        raise ValueError("Choice 需要 2–255 个选项")
    return (max(probs) - 1 / n) / (1 - 1 / n)


def score_value(probs):
    check_probs(probs)
    if not 2 <= len(probs) <= 10:
        raise ValueError("Score 需要 2–10 个等级")
    return sum(level * p for level, p in enumerate(probs))


def brier(preds):
    return sum((p - y) ** 2 for p, y in preds) / len(preds)


def ece(preds):
    total = 0.0
    for lo, hi in [(0, 0.75), (0.75, 1.01)]:
        bucket = [(p, y) for p, y in preds if lo <= p < hi]
        if not bucket:
            continue
        conf = sum(p for p, _ in bucket) / len(bucket)
        acc = sum(y for _, y in bucket) / len(bucket)
        total += len(bucket) / len(preds) * abs(acc - conf)
    return total


print(f"Choice confidence: {choice_confidence([0.8, 0.15, 0.05]):.2f}")
print(f"Score: {score_value([0.1, 0.3, 0.6]):.2f}")
over = [(0.9, 1), (0.9, 1), (0.9, 0), (0.9, 0)]
flat = [(0.6, 1), (0.6, 1), (0.6, 0), (0.6, 0)]
print(f"0.9 组: Brier={brier(over):.2f}, ECE={ece(over):.2f}")
print(f"0.6 组: Brier={brier(flat):.2f}, ECE={ece(flat):.2f}")
```

输出为 `Choice confidence: 0.70`、`Score: 1.50`、`0.9 组: Brier=0.41, ECE=0.40`、`0.6 组: Brier=0.26, ECE=0.10`，与手算一致。真实任务上的分桶校准需要带标签的数据，对应后面的 TODO 2。

# 成本分析

## 输出开销

把一次生成调用粗略拆开：传输与排队 $T_{\mathrm{io}}$，输入处理 $T_{\mathrm{in}}$，以及 $L_{\mathrm{out}}$ 步串行解码：

$$
T_{\mathrm{LLM}}\approx T_{\mathrm{io}}+T_{\mathrm{in}}+
\sum_{t=1}^{L_{\mathrm{out}}}T_{\mathrm{dec},t}.
$$

判断路线没有最后的求和项：一次前向就拿到整份分布。需要完整概率 JSON 时，LLM 的输出包含每题的字段名、标签、概率数字和标点，题目越多，$L_{\mathrm{out}}$ 越长；只返回一个标签时，这段差距又会缩小。所以速度倍数必须绑定输出形态来谈，不能当成一个固定常数。

![生成 JSON 需要逐 token 解码，判断模型一次前向输出整份分布](/img/posts/llm-jev/output-cost.svg)

## 输入复用

设共享状态与公共输入开销为 $S$ 个 token，第 $i$ 个问题新增 $Q_i$ 个 token，共 $N$ 题。拆成多次请求的输入量为 $NS+\sum_i Q_i$，合并请求为 $S+\sum_i Q_i$。

![逐题请求重复发送 state，合并请求只发一份；官方缓存的输入量、费用与耗时对照](/img/posts/llm-jev/input-reuse.svg)

省掉的是重复出现的长前缀。状态越长、每题越短，费用比越接近 $N$；若问题本身占了大半输入，收益就小得多。这与模型是否便宜无关，是调用结构直接决定的输入量。

## 代码实现

当前公开单价为每百万输入 token 0.042 美元，输出不收费。记 $a=0.042/10^6$，两种调用方式的账单为

$$
B_{\mathrm{batch}}=a\left(S+\sum_i Q_i\right),\qquad
B_{\mathrm{separate}}=a\left(NS+\sum_i Q_i\right).
$$

```python
from decimal import Decimal

price = Decimal("0.042") / 1_000_000
state_tokens = 10_000
question_tokens = [100] * 13

batch = state_tokens + sum(question_tokens)
separate = len(question_tokens) * state_tokens + sum(question_tokens)
print(f"示例输入: {batch} / {separate} tokens")
print(f"示例费用比: {Decimal(separate) / batch:.2f}x")

# 官方 Parallel questions 缓存记录的每轮输入量
recorded_batch = 11_838
recorded_separate = 145_002
print(f"官方合并费用: ${recorded_batch * price:.9f}")
print(f"官方拆分费用: ${recorded_separate * price:.9f}")
print(f"官方费用比: {Decimal(recorded_separate) / recorded_batch:.2f}x")
```

假设例子的输入为 11,300 与 131,300 token，费用比为 11.62 倍。官方记录复算得到 0.000497196 美元与 0.006090084 美元，费用比为 12.25 倍。两组数字都符合「共享状态越占大头，节省越接近问题数」的预期。输出不收费是定价选择，与「输出没有计算」是两回事。

# 实验结果

## 官方工作流

官网的 **193.6 倍快、444.6 倍便宜**来自[四类工作流](https://evals.typesafe.ai/)，参考答案是强模型的共识概率，TypeSafe 也说明这些数字可能位于收益较高的一端。

[官方 adapter 源码](https://github.com/typesafe-ai/system-one-adapter-python/tree/e1d4cc938204b22fc5a3c3aca7044072fe3f712d)把多个问题组合成一次 LLM 请求，要求直接输出完整候选概率，并支持原生严格 schema。它没有为每个字段单独调用，也没有靠反复采样估计概率。不过，让 LLM 写出全部概率，比只返回最佳标签承担了更多输出工作，这部分差异会算进对照的成本里。

## 阈值稳定性

[Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) 用 Jev 1.14 回答同一篇 GDPR 材料上的 13 个问题，合并与逐题调用各跑五轮。取出[公开缓存](https://raw.githubusercontent.com/typesafe-ai/typesafe-public-examples/main/cookbooks/parallel_questions/parallel_questions_cache.json)，复算每轮的输入量、耗时和费用，再把二元题的概率交给同一条业务规则。

| 每轮 13 题 | 合并成一次请求 | 逐题串行请求 |
| --- | ---: | ---: |
| 输入 token | 11,838 | 145,002 |
| 平均耗时 | 0.239 秒 | 2.809 秒 |
| 费用 | 0.000497 美元 | 0.006090 美元 |

合并发送把输入费用降到约十二分之一，串行等待从 2.8 秒缩短到 0.24 秒。逐题并发也能缩短等待，每次请求仍要发送同一份材料。

省下了重复输入，程序最后会做同样的决定吗？对 8 道二元题逐条回放，用 $p(\text{yes})\ge\tau$ 决定是否触发，每种调用方式各有 40 次判断。把十次输出有时触发、有时不触发的题记为「跨线」。

| 阈值 | 合并请求触发次数 | 单题请求触发次数 | 跨线的题 |
| --- | ---: | ---: | ---: |
| 0.50 | 20/40 | 20/40 | 0/8 |
| 0.83 | 17/40 | 18/40 | 1/8 |
| 0.90 | 15/40 | 15/40 | 0/8 |

在 0.83 跨线的那道题问的是，是否必须在 72 小时内向监管机构报告个人数据泄露。合并和单题调用的平均 yes 概率分别是 0.830 和 0.832，只差 0.002。可是在五次合并调用中只有两次触发，五次单题调用只有三次触发。同一种调用方式内，程序的动作就已经变了。

把阈值抬到 0.90，这道题的十次输出都不再触发，动作一致了，触发范围也变窄了。给业务定阈值时，除了看概率均值，还要看哪些例子挨着这条线，以及触发或漏掉它们各有什么代价。

## 独立评测

[Rubric Judges 的 v3](https://arxiv.org/html/2609.29769v3) 在七个公开基准、九组面板上比较模型，共使用 5,003 个样本与判据配对。Jev 在许多比较中能以更低费用承担评分工作；但在有序评分上，机器裁判彼此的一致程度常高于它们与人工标签的一致程度。换一种输出接口，并没有自动换掉原来的偏差。

[选项名称研究的 v3](https://arxiv.org/html/2609.26758v3)刻意交换名称与定义。在 1,200 个英文判断中，Jev 的 yes/no 条件出现 32.5% 的定义层面翻转，0/1 对照为 2.08%，所有输出仍然类型合法。这个实验测的是名称冲突下的稳定性，不是日常业务错误率。

| 证据 | 支持什么 | 不能据此外推 |
| --- | --- | --- |
| 官方四工作流 | 特定概率判断任务的效率收益 | 通用能力全面追平最强 LLM |
| 官方 13 问缓存 | 共享输入比串行拆分更省 | 任意并发配置都有相同倍数 |
| 独立 rubric 评测 | 低价评分有价值，也有共同偏差 | 换成 Jev 就更接近人类判断 |
| 选项名称交换 | 合法输出仍可能选错含义 | 32.5% 是正常使用错误率 |

# 能力边界

## 类型与语义

「不会幻觉」的可确认部分，是答案被限制在事先声明的空间里。程序不会收到凭空生成的新类别，但完全可能收到一个合法而错误的选项。

名称交换实验把这件事放大了：`yes` 本来对应「需要人工处理」，交换之后却对应「不需要」。如果模型跟着熟悉的名称走，返回值看起来没问题，实际含义已经反了。

![交换选项名称与定义后，相同的合法标签可能对应相反的业务含义](/img/posts/llm-jev/option-semantics.svg)

机制上这很自然：判断头读的是选项的名称和描述文本，schema 只约束输出形状。名称与定义必须一致，类型约束不会替你消歧。[官方已知弱点](https://docs.typesafe.ai/model-jaggedness)还承认，选项顺序和 state 中的对抗内容也可能改变答案。这是这条路线共同的边界，不是某一家实现的问题。

## 推理与上下文

回到工单，「有没有退款意图」适合做语义判断，「两笔金额相加是否超过限额」则应该计算。把十步推理藏进一句话，并不会因为只要求 yes/no 就变成 System One 任务。

上下文也不是越多越好。长 state 可以让多题共享材料，却同时带来更多干扰，官方文档明确提到无关内容增多会降低准确率。默认请求上限为 64k，每个问题连同 state 的上限为 32k；显式开启长上下文可以扩到 262k，但容量上限并不保证信息利用质量。先检索、筛选，再送入相关内容，通常比把全部记录塞进去更合理。

## 级联判断

最常见的用法是先让 Jev 判断，不确定的交给更强模型。以 Choice 为例，设路由阈值为 $\tau$，当 $c<\tau$ 时调用后备模型。记前级单价为 $C_J$，后备单价为 $C_F$，每题的期望成本为

$$
E[\text{cost}]=C_J+P(c<\tau)\,C_F.
$$

阈值越高，$P(c<\tau)$ 越大，省下的钱越少。能否改善准确率，则取决于后备模型是否恰好擅长前级做错的题，成本公式里没有这一项，但它决定这笔花销值不值。

![阈值路由的期望成本公式，以及后备模型与前级错误重叠对收益的限制](/img/posts/llm-jev/cascade.svg)

Rubric Judges 的实验中，在 Jev 最自信却答错的子集上，快速档 LLM 的判定有 96.0% 重复了同一个错误。这不是总体错误率，却说明高置信度错误本就不容易被阈值拦下，即使送到下一层，也可能再次得到相同答案。评估级联时要同时看省下多少调用和留下哪些错误；有些任务真正需要的是补充证据、确定性检查或人工复核。

# 实验复现

以下 TODO 需要在有 GPU 的机器上执行，单个实验用一张 24 GB 显存的消费级显卡即可。每个 TODO 都写清目的、做法和结果写回位置，完成后直接替换对应小节里的表述。合并与串行两组已用公开缓存复算，见上文「阈值稳定性」，其余实验仍待完成。

## TODO 1 开源实现的对照验证

目的：用开源 judgment model 验证本文的架构推断，即「共享 state 编码 + 独立问题判断头 + 整份概率分布输出」这条技术路线的行为是否一致。

做法：选一个开源 decision model 或 judgment model，输入与正文相同的工单 state 和三组问题。分别记录三个问题的概率分布；把 Choice 的选项名称与定义互换后重跑，统计语义翻转率；再把三题拆成三次请求，记录输入 token 总量与端到端延迟，与合并请求对照。

写回：在「模型架构」一节末尾补一张对照表，列为模型、翻转率、合并输入 token、拆分输入 token、合并延迟、拆分延迟，并用实测结果替换「结构是清楚的」一段中的推断表述。

## TODO 2 置信度与准确率

目的：验证 confidence 与真实准确率的关系，给出校准曲线，而不只停留在「confidence 不是准确率」的定性说法。

做法：取 200 条带标准答案的二元或三分类样本，可用公开分类数据集子集。逐条运行模型，记录 confidence 与预测结果。按 confidence 分四桶：小于 0.5、0.5 到 0.7、0.7 到 0.9、0.9 及以上，计算每桶样本数、平均 confidence 和准确率。

写回：新增小节「置信度与校准」，放一张分桶表，列为 confidence 区间、样本数、平均 confidence、准确率，再补一句可靠性图的结论。若高 confidence 桶的准确率仍明显偏低，把「级联判断」一节里阈值路由的建议改成「先校准再路由」。

## TODO 3 批量与串行的吞吐成本

状态：合并与串行两组已用公开缓存复算，输入、耗时与阈值稳定性见上文「阈值稳定性」。剩余工作是开源模型上的三组实测，尤其是并发组。

目的：在可控环境里复测 Parallel questions 实验，确认输入复用与并行评价各自的贡献。

做法：使用同一个开源模型和同一份长 state，准备 13 个独立问题。A 组把 13 题合并成一次请求，B 组串行执行 13 次单题请求，C 组并发执行 13 次单题请求。每组运行五轮取平均，记录端到端延迟、输入 token 总量和显存峰值。

写回：替换「实验结果」里官方 13 问缓存的段落，放一张三组对照表，并说明 C 组相比 B 组省了多少等待、相比 A 组多花了多少输入。这样可以把「模型层的并行」与「应用层的并发」分开计价。

# 结语

Jev 这条路线的关键不是某个宣传数字，而是三个可以自己动手验证的事实：判断在小候选集上一次归一化，省掉串行解码；概率要按频率校准，confidence 只是分布集中程度；共享输入按调用结构省钱，语义错误则仍要按业务验证。把这三点算清楚，模型怎么选、问题怎么拆、阈值怎么定，就都有了依据。

# 参考资料

https://typesafe.ai/blog/introducing-system-one-models-and-jev

https://docs.typesafe.ai/models

https://docs.typesafe.ai/concepts/system-one

https://docs.typesafe.ai/primitives/choice

https://docs.typesafe.ai/primitives/score

https://docs.typesafe.ai/primitives/noul

https://docs.typesafe.ai/introduction/machine-learning-primer

https://docs.typesafe.ai/confidence

https://docs.typesafe.ai/cookbooks/parallel_questions

https://docs.typesafe.ai/model-jaggedness

https://typesafe.ai/blog/dont-call-it-a-decision-model

https://typesafe.ai/blog/jev-1-14

https://evals.typesafe.ai/

https://github.com/typesafe-ai/system-one-adapter-python/tree/e1d4cc938204b22fc5a3c3aca7044072fe3f712d

https://raw.githubusercontent.com/typesafe-ai/typesafe-public-examples/main/cookbooks/parallel_questions/parallel_questions_cache.json

https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/

https://zhuanlan.zhihu.com/p/2088646609622062108

https://openreview.net/forum?id=c2HwfxMNe8

https://arxiv.org/html/2609.26758v3

https://arxiv.org/html/2609.29769v3
