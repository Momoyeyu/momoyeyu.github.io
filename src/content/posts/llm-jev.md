---
title: How Jev Works
date: 2026-11-11
description: 从类型化判断、概率校准和共享输入理解 Jev 的工作方式，拆解速度与费用的来源，再用独立评测看清它的能力边界。
tags: [LLM, Jev, System-One, RLCD, 推理]
category: LLM
episode: 6
draft: true
lang: zh_CN
---

# 前言

最近 Jev 很热。打开 [TypeSafe 的发布页](https://typesafe.ai/blog/introducing-system-one-models-and-jev)，快近 200 倍、便宜 400 多倍、不会幻觉，几句话就把期待拉满了。[中文媒体的介绍](https://zhuanlan.zhihu.com/p/2088646609622062108)和相关研究也跟得很快：9 月 15 日模型发布，日期为 9 月 19 日的 [ICLR 2027 投稿记录](https://openreview.net/forum?id=c2HwfxMNe8)就已经出现。

热闹之外，质疑也来了。独立评测发现了选项敏感性、相关错误等问题；相关论文的公开评审则指出，作者对闭源架构的推断缺少依据，实验对照也不够充分。论文的质量和模型的能力是两回事，混在一起，很容易从过度期待走到全盘否定。

先把这些争论放一放。这篇从 Jev 接到一次请求开始，看看它怎样给出判断，为什么快、为什么便宜，以及这些优势留下了什么代价。

# 判断与生成

假设客服系统收到一张工单：“同一笔订单扣了两次钱，请退回多扣的一笔，今天还要付款。”程序需要知道用户是否要求退款、是否描述重复扣款、事情有多紧急。至于有没有重复到账、能退多少、是否已经退过，查数据库和写规则就能解决。

LLM 可以把整件事分析一遍，再输出 JSON。但软件最终消费的是几个值，中间那段文字生成并非总有必要。上一篇 [MLA](../llm-mla/)讨论怎样降低逐 token 生成的开销，Jev 则从任务本身入手：如果只需要判断，能否省掉把答案写成一段话的过程？

TypeSafe 把这类能力称为 **System One**，借用的是快速直觉与慢速推理的区分。它适合语义分类、相关性评价、意图识别等判断，业务流程仍由程序组织。一个看起来很短的 yes/no 问题，也可能藏着很长的推理链，答案短不代表任务简单。

# 模型架构

## 共享状态

一次 Jev 请求包含共享状态 `state` 和一组 `questions`。状态是待理解的数据，问题描述要判断什么，判据规定每个候选答案的含义。工单正文只放一份，退款意图、重复扣款和紧急程度分别提问。

记共享状态为 $s$，第 $i$ 个问题为 $q_i$，它的候选集合及定义为 $C_i$，模型参数为 $\theta$，返回的概率分布为 $p_i$。公开接口可以写成：

$$
p_i=f_\theta(s,q_i,C_i).
$$

下面这张图画的是这个数据流。图中的退款规则和数据库查询属于应用代码，不是 Jev 隐藏在模型里的工作。

![共享工单进入 Jev，独立问题得到概率，业务代码结合数据库决定动作](/img/posts/llm-jev/judgment-flow.svg)

概率交给代码之后，才成为具体动作。“有退款意图”只是处理退款的一个条件；账务记录不支持重复扣款时，程序不能因为模型很自信就发起退款。

至于框里真正的神经网络，[TechCrunch 报道](https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/)称其基于 Transformer，但完整结构尚未公开。参数量、基座、注意力组织和读出方式都没有足够资料可以复原。这里能拆解的是公开的数据流与计算职责，不能照着某个开源 Jev-like 模型，反过来认定 Jev 也采用相同结构。

## 类型化输出

Jev 的三种主要文本原语，分别对应选择、评分和二元判断。它们都由调用方先定义答案空间，模型不会临时发明新标签。

| 原语 | 工单中的问题 | 返回值 |
| --- | --- | --- |
| Choice | 主要意图是退款、咨询还是投诉 | 候选概率、最高概率选项和 confidence |
| Score | 需要常规处理、优先处理还是紧急处理 | 等级概率、加权评分和 confidence |
| Noul | 是否描述了重复扣款 | 回答为 yes 的概率 |

Choice 最多支持 255 个选项，Score 使用 2–10 个等级。图里的数值只是教学示例，用来观察同一份工单的三种输出形状。

![Choice 的候选分布、Score 的等级期望和 Noul 的 yes 概率](/img/posts/llm-jev/output-primitives.svg)

Score 值得多看一眼。若三个等级从 0 编号，概率分别为 0.1、0.3、0.6，评分就是 $0\times0.1+1\times0.3+2\times0.6=1.5$。它表达在这把标尺上的位置，不是 1.5 个小时，也不是某个事件的发生概率。等级怎么定义，会直接影响这个数的意义。

本文按 2026 年 11 月 11 日的[模型文档](https://docs.typesafe.ai/models)整理，`jev-latest` 指向 `jev-1.14.0`。这一版也支持图像与 Box 原语，本文以文本判断为主。

## 问题隔离

同一批问题共享状态，但**不读取彼此的答案**。退款意图与重复扣款可以同时判断；若下一步要根据第一题选中的订单，再构造新的查询，就需要程序接过结果，发起下一轮。

![独立问题可在同批回答，后题依赖前题结果时需要分轮](/img/posts/llm-jev/question-dependencies.svg)

所以，批处理能消除人为排出来的等待，不能消除任务真正的数据依赖。把“先找订单，再查支付，最后决定退款”塞成三个问题，不会让后两题自动拿到前面的结果。

输入还有一些容易忽略的细节：[Choice](https://docs.typesafe.ai/primitives/choice) 的问题 ID 不给模型看，选项名称和描述却会给它看。[Score](https://docs.typesafe.ai/primitives/score) 的等级描述分别评价，模型看不到等级位置和相邻等级。因此“比上一档更紧急”不是一个完整判据，要写清这一档自身的条件。

# RLCD

## 概率校准

返回概率只是接口，概率是否可信还取决于训练和数据。[RLCD](https://docs.typesafe.ai/introduction/machine-learning-primer) 全名为 Reinforcement Learning for Calibrated Decisions，目标是让模型输出经过校准的判断概率。相较于 [RLHF](../llm-ppo/)围绕回答偏好优化，TypeSafe 强调的是概率与实际结果之间的对应关系。

校准可以这样理解：把大量预测为 0.8 的事件放在一起，其中应当约有 80% 发生。它描述一组预测的统计表现，不是对眼前这一题盖章。下图把“分布看起来很确定”和“长期预测得准”分开来看。

![概率集中程度与校准是两件事，预测概率需要与一组事件的实际频率对照](/img/posts/llm-jev/calibration.svg)

一百次都说 0.9，最后只对六十次，模型依然很自信，却没有校准好。反过来，对本来就难分的案例给出接近 0.5，也可能是合理的概率估计。软件拿到分布后，可以按误判代价设置阈值，但阈值要在自己的任务数据上验证。

目前公开资料介绍了 RLCD 的目标，没有给出完整损失函数、奖励构造或优化算法。交叉熵、Brier score、PPO 都能出现在概率学习的讨论里，却不能据此指定哪一种就是 Jev 的训练实现。下面只计算已公开的输出量。

## 置信度

Jev 的 `confidence` 容易被误读成“答对的概率”。对有 $n$ 个选项的 Choice，设最大候选概率为 $p_{\max}$，官方[计算方式](https://docs.typesafe.ai/confidence)为：

$$
c=\frac{p_{\max}-1/n}{1-1/n},\qquad n\geq2.
$$

均匀分布对应 0，全部概率落在一个选项上对应 1。三个选项中最高概率为 0.8，confidence 就是 0.7。这个 0.7 是分布集中程度的换算，不能读成“有 70% 把握答对”。在选项数固定时，它与最大概率一一对应，同时检查二者也不会多出一份独立证据。

Score 的评分则是等级位置的期望。记第 $j$ 档的概率为 $r_j$，等级数为 $m$，从 0 编号：

$$
v=\sum_{j=0}^{m-1}j r_j.
$$

它与 Score 自身的 confidence 也是不同的量，后者还考虑概率在等级之间的距离。Noul 只返回 yes 的概率，没有单独的 confidence 字段。

## 代码实现

下面两组概率均为教学数据，不是 Jev 实测输出。先检查分布，再按公式计算：

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


print(f"Choice confidence: {choice_confidence([0.8, 0.15, 0.05]):.2f}")
print(f"Score: {score_value([0.1, 0.3, 0.6]):.2f}")
```

输出为 `Choice confidence: 0.70` 和 `Score: 1.50`。这些公式可以复算返回值，却不能检验校准；后者还需要一批带真实标签的数据。

# 推理效率

## 串行输出

自回归 LLM 即使启用了严格 JSON schema，也通常还要依次生成字段名、标签、概率数字和标点。约束能让格式合法，却没有自动去掉 token 之间的生成依赖。

把一次调用粗略拆开，令 $T_{\mathrm{io}}$ 表示传输与排队时间，$T_{\mathrm{in}}$ 表示输入处理时间，输出长度为 $L_{\mathrm{out}}$，第 $t$ 步解码耗时为 $T_{\mathrm{dec},t}$：

$$
T_{\mathrm{LLM}}\approx T_{\mathrm{io}}+T_{\mathrm{in}}+
\sum_{t=1}^{L_{\mathrm{out}}}T_{\mathrm{dec},t}.
$$

Jev 的公开设计直接返回类型化判断和概率，避开了把所有结果逐 token 写成文本的路径。时序图只表示依赖，不按某次测量的毫秒数缩放。

![LLM 顺序生成概率 JSON，Jev 并行评价独立问题，二者都有输入处理和服务开销](/img/posts/llm-jev/output-timeline.svg)

问题多、候选多、还需要完整概率分布时，文本输出会更长，这种差异就更重要。如果只让 LLM 输出一个标签，待生成的内容已经很少，速度差距自然不能照搬复杂工作流的倍数。

## 并行判断

官方文档说明，Jev 读取共享 state 一次，再并行评价问题。工单的三个判断没有先后依赖，就不用等退款意图的文本写完，才开始输出紧急程度。

这里有两层不同的节省：一层是模型不走相同的串行文本输出过程，另一层是应用把独立问题合成一批，少做重复输入和请求。前者不等于零计算，后者也不意味着问题数可以无限增加。更长的状态、更多的判据，仍然需要处理。

一次 API 请求内部有多少次 forward 并未披露，“一批返回”不能直接翻译成“固定一次前向、固定计算量”。有真实依赖的任务仍要分轮，跨地区网络和排队时间也仍会进入总延迟。

# 成本分析

## 输入复用

设共享状态与公共输入开销为 $S$ 个 token，第 $i$ 个问题新增 $Q_i$ 个 token，一共问 $N$ 题。忽略少量包装差异，拆成多次请求的输入量为 $NS+\sum_i Q_i$，合并请求则为 $S+\sum_i Q_i$。

![拆分请求重复计入共享状态，合并请求保留一份状态和全部问题](/img/posts/llm-jev/shared-input.svg)

省掉的是重复出现的长前缀。状态越长、每个问题越短，费用比就越接近 $N$；若问题本身占了大半输入，收益会小很多。添加问题仍增加输入量，输出免费并不等于可以免费提无限个问题。

## 服务定价

当前公开单价为每百万输入 token 0.042 美元，输出不收费。记每 token 价格为 $a=0.042/10^6$ 美元，两种调用方式的输入账单为：

$$
B_{\mathrm{batch}}=a\left(S+\sum_i Q_i\right),\qquad
B_{\mathrm{separate}}=a\left(NS+\sum_i Q_i\right).
$$

这是能从价目表算清楚的部分。避开串行生成和重复输入，确实有减少工作量的工程理由；但服务商使用什么硬件、怎样调度、每次推理实际花多少钱，并没有公开。输出不收费是定价方式，不代表输出计算没有成本。TypeSafe 在发布文中也承认，仅凭当前价格无法证明没有补贴。

## 代码实现

先用假设的 10,000 token 状态和 13 个各 100 token 的问题算一遍，再复算官方批处理示例公开的输入量。这里计算的是账单，不调用 API。

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

假设例子的输入为 11,300 与 131,300 token，费用比为 11.62 倍。官方记录复算得到 0.000497196 美元与 0.006090084 美元，费用比为 12.25 倍。两组数字都符合“共享状态越占大头，节省越接近问题数”的预期。

# 实验结果

## 官方工作流

官网的 **193.6 倍快、444.6 倍便宜**来自[四类工作流](https://evals.typesafe.ai/)，覆盖安全事件、Agent 轨迹、发票和客服。参考答案是强模型的共识概率，不能直接当成人工真值；TypeSafe 也说明，这些数字可能位于实际收益较高的一端。

对照程序值得看一下。[官方 adapter 源码](https://github.com/typesafe-ai/system-one-adapter-python/tree/e1d4cc938204b22fc5a3c3aca7044072fe3f712d)把多个问题组合成一次 LLM 请求，要求直接输出完整候选概率，并支持原生严格 schema。它没有为每个字段单独调用一次，也没有靠反复采样估计概率。不过，让 LLM 写出全部概率，比只返回最佳标签承担了更多输出工作。这份固定版本源码能说明对照方式，尚不能证明它与发布评测使用的版本完全一致。

另一个更容易读懂的实验是 [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions)：同一篇 GDPR 材料上的 13 个问题，两种策略各运行五轮。官方缓存中，合并请求平均约 0.239 秒，13 次单题请求串行执行合计约 2.809 秒。前面的费用复算来自同一份记录。

这里的 11.8 倍时间差，比较对象是**串行单题调用**。并发发送单题请求也能缩短等待，但仍会重复传入 state。这组实验验证了批处理的价值，不能拿来表示 Jev 比某个 LLM 快多少。本篇复核了缓存，没有重新运行这些模型实验。

## 独立评测

独立研究给出的图景更具体：效率优势可以成立，但质量取决于任务和对照方式。

[Rubric Judges 的 v3](https://arxiv.org/html/2609.29769v3) 在七个公开基准、九组面板上比较模型，共使用 5,003 个样本与判据配对。Jev 在许多比较中能以更低费用承担评分工作；但在有序评分上，机器裁判彼此的一致程度常高于它们与人工标签的一致程度。换一种输出接口，并没有自动换掉原来的偏差。

[选项名称研究的 v3](https://arxiv.org/html/2609.26758v3)则刻意交换名称与定义。在 1,200 个英文判断中，Jev 的 yes/no 条件出现 32.5% 的定义层面翻转，0/1 对照为 2.08%。所有输出仍然类型合法。这个实验测的是名称冲突下的稳定性，不是日常业务错误率。摘要里更夸张的 AUC 从 93.8% 掉到 23.2%，属于另一个模型 Laya，不能记到 Jev 头上。

把几组实验放在一起，适合得出的结论如下：

| 证据 | 支持什么 | 不能据此外推 |
| --- | --- | --- |
| 官方四工作流 | 特定概率判断任务的效率收益 | 通用能力全面追平最强 LLM |
| 官方 13 问缓存 | 共享输入比串行拆分更省 | 任意并发配置都有相同倍数 |
| 独立 rubric 评测 | 低价评分有价值，也有共同偏差 | 换成 Jev 就更接近人类判断 |
| 选项名称交换 | 合法输出仍可能选错含义 | 32.5% 是正常使用错误率 |

这些研究使用的是各自实验时的服务版本和提示方式，不能视为对当前版本的统一复测。

# 能力边界

## 类型与语义

“不会幻觉”的可确认部分，是答案被限制在事先声明的空间里。程序不会收到凭空生成的新类别，但完全可能收到一个合法而错误的选项。

名称交换实验把这件事放大了：`yes` 本来对应“需要人工处理”，交换之后却对应“不需要”。如果模型跟着熟悉的名称走，返回值看起来没问题，实际含义已经反了。

![交换选项名称与定义后，相同的合法标签可能对应相反的业务含义](/img/posts/llm-jev/option-semantics.svg)

这也解释了为什么选项命名是输入设计的一部分。名称与定义应当一致；遇到明显冲突，不能指望类型约束替你消歧。[官方已知弱点](https://docs.typesafe.ai/model-jaggedness)还承认，选项顺序和 state 中的对抗内容也可能改变答案。

## 推理与上下文

回到工单，“有没有退款意图”适合做语义判断，“两笔金额相加是否超过限额”则应该计算。把十步推理藏进一句话，并不会因为只要求 yes/no 就变成 System One 任务。

上下文也不是越多越好。长 state 可以让多题共享材料，却同时带来更多干扰。官方文档明确提到，无关内容增多会降低准确率。默认请求上限为 64k，每个问题连同 state 的上限为 32k；显式开启长上下文可以扩到 262k，但容量上限并不保证信息利用质量。先检索、筛选，再送入相关内容，通常比把全部记录塞进去更合理。

## 级联判断

最自然的用法是先让 Jev 判断，不确定的交给更强模型。以 Choice 为例，设路由阈值为 $\tau$，当置信度 $c<\tau$ 时调用后备模型。它能减少昂贵调用，但能否改善准确率，还要看后备模型是否恰好擅长前级做错的题。

下图用假设样本区分互补错误与重叠错误。路由决定谁来答题，错误关系决定换人之后有没有帮助。

![阈值路由可以节省调用，但后备模型与 Jev 的错误重叠会限制纠错收益](/img/posts/llm-jev/cascade-errors.svg)

Rubric Judges 的实验中，在 Jev 最自信却答错的子集上，快速档 LLM 的判定有 96.0% 重复了同一个错误。这不是总体错误率，却说明一个问题：高置信度错误本就不容易被阈值拦下，即使送到下一层，也可能再次得到相同答案。

因此，评估级联时要同时看省下多少调用和留下哪些错误。换一个更贵的模型，不必然增加一份独立判断；有些任务真正需要的是补充证据、确定性检查，或人工复核。

# 结语

Jev 的价值在于让一类原本要通过文本生成完成的判断，变成软件可以直接使用的概率接口。限定输出、共享输入和并行评价，解释了它为何能在合适的工作流里又快又便宜。

代价也留在同一处：答案空间要预先设计，依赖关系要由程序组织，类型正确之外的语义错误仍要验证。用好它，需要先看清任务里哪些部分是在理解，哪些是在计算，哪些真的需要继续推理。

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
