---
title: 从零理解 MLA
date: 2026-10-20
updated: 2026-10-21
description: 本文从 KV cache 的推理开销讲起，经过 MQA 与 GQA 的共享方案，理解 DeepSeek-V2 提出的多头潜在注意力：低秩联合压缩、矩阵吸收与解耦 RoPE。
tags: [LLM, Deepseek, MLA, KV Cache, AI Infra]
category: LLM
episode: 5
draft: true
lang: zh_CN
---

# 前言

回顾 [EP.0](../llm-transformer/) 的 Transformer，每个 Block 里真正做计算的就是两个模块：注意力与 FFN。现代 LLM 的架构创新也主要集中在这两处：[EP.1](../llm-moe/) 讲的 MoE 是在 FFN 上做稀疏化改造，本文要讲的 MLA 则是在注意力上动刀。

MLA 全名**多头潜在注意力**（Multi-head Latent Attention），由 [DeepSeek-V2](https://arxiv.org/abs/2405.04434) 在 2024 年 5 月首次提出，之后被 DeepSeek-V3、R1 等模型沿用。它主要针对自回归推理时的 KV cache 开销，同时也通过查询压缩减少训练时的激活显存。这也是本系列第一次讨论注意力本身的改进，前面的归一化、位置编码都是在注意力的外围做加固。[EP.3](../llm-position-encoding/) 在介绍解耦 RoPE 时曾留下一个伏笔：为什么 DeepSeek 要专门拆出一条位置通道？答案就藏在 MLA 的完整结构里，本文会把它收回来。

我们的路线是：先看清问题本身，即 KV cache 为什么成为推理瓶颈；再看最直接的解法 MQA 与 GQA 付出了什么代价；然后理解 MLA 的两件武器，低秩联合压缩与矩阵吸收；最后处理它与 RoPE 的冲突，把 DeepSeek-V2 的注意力维度配置摆出来。

# KV Cache

## 为什么需要缓存

语言模型的生成是逐个 token 进行的：每步只产生一个新 token，把它拼到输入后面，再算下一个。由于因果掩码的存在，第 $t$ 步的 token 只能看到位置 $1$ 到 $t$ 的内容。

对解码过程做一点观察就会发现大量重复计算。第 $t$ 步要做的事，是让新 token 的 query 与所有历史位置的 key、value 做注意力。推理时，历史位置看不到后续 token，因此续写不会改变这些位置在各层的表示，也不会改变它们的 K/V。若每步重新计算整个前缀，就会对不变的历史表示重复做 K/V 投影。

> **既然历史 K/V 不变，能不能算一次就存下来，后面直接用？**

当然可以，这就是 **KV Cache**。工程上把生成过程拆成两个阶段：prefill 阶段一次性处理整段 prompt，把所有 K/V 算好存起来；decode 阶段每步只给新 token 算 Q、K、V，把新的 K/V 追加进缓存，再与全部缓存做注意力。

![kv-cache](/img/posts/llm-mla/kv-cache.svg)

## 缓存开销

天下没有免费的午餐，KV cache 省的是计算，花的是显存。标准 MHA 下，每个 token 在每一层都要存一份完整的 K 和 V，大小为

$$
2 \cdot n_h \cdot d_{\text{head}} \quad \text{个元素},
$$

其中 $n_h$ 是注意力头数，$d_{\text{head}}$ 是每头维度。乘上层数 $L$，就是每个 token 的全部缓存。

这个开销有多大？拿 DeepSeek-V2 的规模估一下：$n_h = 128$、$d_{\text{head}} = 128$、$L = 60$，如果它用标准 MHA，每个 token 要缓存约 197 万个元素；一条 $128 \times 1024$ token 的序列就是约 2580 亿个元素，fp16 下约 480 GiB。这还没有计入模型权重与其他运行时开销，batch size 增大时缓存还会成倍增加。长上下文 decode 的注意力计算往往受缓存读取带宽限制：每生成一个 token，都要把整个缓存读一遍，缓存越大，生成越慢。KV cache 同时卡住了显存容量和显存带宽，这就是它成为推理瓶颈的原因。

## 代码示例

本文的代码只依赖 PyTorch，所有代码块共用下面的导入，完整可运行的版本见开源仓库 [small-language-model](https://github.com/Momoyeyu/small-language-model) 的 MLA 模块：

```python
import math

import torch
import torch.nn as nn
```

先实现一个支持缓存的 MHA。`forward` 一次可以只处理新进来的若干个 token，历史 K/V 通过参数传入并拼接：

```python
class MultiHeadAttention(nn.Module):
    """标准 MHA：q, k, v 各自由输入独立投影。"""

    def __init__(self, d: int, n_heads: int) -> None:
        super().__init__()
        self.n_heads = n_heads
        self.d_head = d // n_heads
        self.w_q = nn.Linear(d, d, bias=False)
        self.w_k = nn.Linear(d, d, bias=False)
        self.w_v = nn.Linear(d, d, bias=False)
        self.w_o = nn.Linear(d, d, bias=False)

    def forward(self, x: torch.Tensor, kv_cache=None):
        # x: [B, L, d]；返回输出与更新后的 (K, V) 缓存
        B, L, _ = x.shape
        q = self.w_q(x).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        k = self.w_k(x).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        v = self.w_v(x).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        if kv_cache is not None:                       # 拼接历史 K/V
            k = torch.cat([kv_cache[0], k], dim=2)
            v = torch.cat([kv_cache[1], v], dim=2)
        S = k.shape[2]
        scores = q @ k.transpose(-1, -2) / math.sqrt(self.d_head)   # [B, H, L, S]
        mask = torch.ones(L, S, dtype=torch.bool, device=x.device)
        scores = scores.masked_fill(~mask.tril(diagonal=S - L), -torch.inf)
        o = scores.softmax(dim=-1) @ v                              # [B, H, L, d_head]
        out = self.w_o(o.transpose(1, 2).reshape(B, L, -1))
        return out, (k, v)
```

这里有个容易写错的细节：掩码的下三角不能直接用 `torch.tril(torch.ones(L, S))`，因为带缓存时 $S > L$，新 token 要能看到全部历史位置。正确做法是把下三角向右偏移 $S - L$，即 `tril(diagonal=S - L)`。

下面对比两种解码方式：无缓存时每个位置都把整个前缀重新算一遍，有缓存时每次只算新 token：

```python
torch.manual_seed(0)
mha = MultiHeadAttention(d=64, n_heads=4).eval()
h = torch.randn(1, 12, 64)       # 一段 12 个 token 的输入

# 无缓存：每个位置都重算整段前缀
outs_naive = [mha(h[:, : t + 1])[0][:, -1:] for t in range(12)]

# 有缓存：prefill 第 1 个 token，之后每步只算 1 个新 token
out, cache = mha(h[:, :1])
outs_cached = [out]
kv_proj = 1                       # prefill 只投影了 1 个位置的 K/V
for t in range(1, 12):
    out, cache = mha(h[:, t : t + 1], cache)
    outs_cached.append(out)
    kv_proj += 1                  # decode 每步只投影 1 个位置的 K/V

for t in range(12):
    assert torch.allclose(outs_cached[t], outs_naive[t], atol=1e-6)
print(f"K/V 投影次数：无缓存 {sum(range(1, 13))} 次，有缓存 {kv_proj} 次")
print(f"缓存元素数：{cache[0].numel() + cache[1].numel()} = 2 × {mha.n_heads} × {mha.d_head} × 12")
```

输出：

```text
K/V 投影次数：无缓存 78 次，有缓存 12 次
缓存元素数：1536 = 2 × 4 × 16 × 12
```

两种方式逐位一致，但 K/V 投影次数从 $1 + 2 + \cdots + 12 = 78$ 降到了 12，这正是 KV cache 的价值；而 1536 个缓存元素正好对应公式 $2 n_h d_{\text{head}}$ 每 token。把每 token 每层这个数字乘以 60 层、$128 \times 1024$ 的序列长度和不算大的 batch，就能看出问题所在。

# MQA 与 GQA

最直接的压缩思路是共享：如果多个注意力头用同一份 K/V，缓存不就按共享倍数缩小了吗？

**多查询注意力**（Multi-Query Attention，MQA）把这个思路推到极限：所有 $n_h$ 个 query 头共享同一份 K 和 V，每个 token 每层只缓存 $2 d_{\text{head}}$ 个元素。**分组查询注意力**（Grouped-Query Attention，GQA）折中一些：把 $n_h$ 个头分成 $n_g$ 组，组内共享 K/V，缓存为 $2 n_g d_{\text{head}}$ 每 token 每层。Llama、Qwen 等系列广泛采用 GQA，但组数因型号而异；本文用 GQA-8 表示有 8 个 K/V 头的配置。

![kv-sharing](/img/posts/llm-mla/kv-sharing.svg)

共享 K/V 减少了键值投影的独立性，但各头仍有不同的 query，可以形成不同的注意力权重，并不等于合并成一个注意力头。DeepSeek-V2 的技术报告附录 D.1 对比了三个约 7B 的 dense 模型：三者同样训练 1.33T token，除注意力机制外，还调整了层数以使总参数量接近：

| 基准 | MQA | GQA-8 | MHA |
|---|---|---|---|
| MMLU | 37.9 | 41.2 | 45.2 |
| BBH | 33.2 | 35.6 | 37.0 |
| C-Eval | 30.0 | 37.7 | 42.9 |
| CMMLU | 34.6 | 38.4 | 43.5 |

这组实验中，共享越多，掉点越多：MQA 相比 MHA 在四个基准上全面大幅落后，GQA-8 居中。共享方案用性能换来了缓存，这不是免费的压缩。

## 代码示例

把 K/V 的头数做成参数，一个模块就能覆盖 MHA、GQA、MQA 三种形态。组内共享用 `repeat_interleave` 把每份 K/V 复制给同组的头。注意这里每头维度 `d_head` 是一个独立参数：DeepSeek-V2 中 $n_h d_{\text{head}} = 16384 \neq d$，Q、K、V 的总维度比模型宽度还大。

```python
class GroupedAttention(nn.Module):
    """n_kv 组共享 K/V：n_kv = n_heads 时是 MHA，n_kv = 1 时是 MQA。"""

    def __init__(self, d: int, n_heads: int, n_kv_heads: int, d_head: int) -> None:
        super().__init__()
        assert n_heads % n_kv_heads == 0
        self.n_heads, self.n_kv_heads = n_heads, n_kv_heads
        self.d_head = d_head
        self.w_q = nn.Linear(d, n_heads * self.d_head, bias=False)
        self.w_k = nn.Linear(d, n_kv_heads * self.d_head, bias=False)
        self.w_v = nn.Linear(d, n_kv_heads * self.d_head, bias=False)
        self.w_o = nn.Linear(d, n_heads * self.d_head, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, L, _ = x.shape
        q = self.w_q(x).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        k = self.w_k(x).view(B, L, self.n_kv_heads, self.d_head).transpose(1, 2)
        v = self.w_v(x).view(B, L, self.n_kv_heads, self.d_head).transpose(1, 2)
        rep = self.n_heads // self.n_kv_heads
        k = k.repeat_interleave(rep, dim=1)              # [B, H, L, d_head]
        v = v.repeat_interleave(rep, dim=1)
        scores = q @ k.transpose(-1, -2) / math.sqrt(self.d_head)
        mask = torch.ones(L, L, dtype=torch.bool, device=x.device).tril()
        scores = scores.masked_fill(~mask, -torch.inf)
        o = scores.softmax(-1) @ v
        return self.w_o(o.transpose(1, 2).reshape(B, L, -1))
```

用 DeepSeek-V2 的规模算一笔账：

```python
d, n_heads, d_head, layers = 5120, 128, 128, 60     # DeepSeek-V2 的真实配置
for n_kv in [128, 8, 2, 1]:
    attn = GroupedAttention(d, n_heads, n_kv, d_head)
    params = sum(p.numel() for p in attn.parameters())
    cache = 2 * n_kv * d_head * layers
    print(f"K/V 头数 {n_kv:>3}：参数量 {params / 1e6:6.1f}M，每 token 缓存 {cache / 1e3:7.1f}K 元素")
```

输出：

```text
K/V 头数 128：参数量 335.5M，每 token 缓存 1966.1K 元素
K/V 头数   8：参数量 178.3M，每 token 缓存  122.9K 元素
K/V 头数   2：参数量 170.4M，每 token 缓存   30.7K 元素
K/V 头数   1：参数量 169.1M，每 token 缓存   15.4K 元素
```

从 128 个 K/V 头砍到 1 个，缓存缩小了 128 倍，注意力模块参数量却只省了一半。这张表也埋下了 MLA 的目标：能不能找到一种压缩方式，缓存接近 MQA，性能却不输 MHA？

# MLA

MLA 的回答是：不直接共享 K/V，改压缩。所有头共享一个低维隐向量，再通过各头自己的投影还原 K/V。

## 低秩联合压缩

设注意力层的输入为 $\mathbf{h}_t \in \mathbb{R}^d$。MLA 先用一个下投影矩阵把 K 和 V 的信息**联合**压缩成一个隐向量：

$$
\mathbf{c}_t^{KV} = W^{DKV}\,\mathbf{h}_t, \qquad \mathbf{c}_t^{KV} \in \mathbb{R}^{d_c},
$$

其中 $d_c \ll n_h d_{\text{head}}$ 是压缩维度，$W^{DKV} \in \mathbb{R}^{d_c \times d}$。真正要用 K 和 V 的时候，再用两个上投影矩阵各自还原：

$$
\mathbf{k}_t^{C} = W^{UK}\,\mathbf{c}_t^{KV},
\qquad
\mathbf{v}_t^{C} = W^{UV}\,\mathbf{c}_t^{KV},
$$

$W^{UK}, W^{UV} \in \mathbb{R}^{n_h d_{\text{head}} \times d_c}$，输出同样切分成 $n_h$ 个头。缓存里只放 $\mathbf{c}_t^{KV}$，每 token 每层 $d_c$ 个元素。

![mla](/img/posts/llm-mla/mla.svg)

> **这和 MQA 的共享有什么本质区别？**

区别在于「各自还原」。MQA 是所有头拿到完全相同的一份 K/V；MLA 里第 $i$ 个头的 $\mathbf{k}_{t,i}^{C}$ 是隐向量经 $W^{UK}$ 的第 $i$ 个分块投影出来的，每个头仍然有自己的 key 和 value。低秩约束作用于所有头拼接后的联合表示：$W^{UK}$、$W^{UV}$ 以及两者纵向拼接的矩阵，其秩都至多为 $d_c$。信息被迫走一条窄通道，但每个头走自己的门。DeepSeek-V2 的消融实验显示，MLA 在多数所测指标上优于 MHA；可以把低秩瓶颈理解为一种类似正则化的约束。

## 矩阵吸收

上面的方案省下了缓存，却引入了一个新问题：推理时取出缓存的 $\mathbf{c}_t^{KV}$，还得先乘 $W^{UK}$、$W^{UV}$ 解压出 K/V 才能算注意力。缓存的本意是省计算，这不又把计算加回来了吗？

解围的工具是矩阵乘法的结合律。先看 logits，第 $i$ 个头的 query 为 $\mathbf{q}_{t,i}^{C}$，与位置 $j$ 的 key 做内积：

$$
(\mathbf{q}_{t,i}^{C})^{\top}\,\mathbf{k}_{j,i}^{C}
=
(\mathbf{q}_{t,i}^{C})^{\top}\,W_i^{UK}\,\mathbf{c}_j^{KV}
=
\big((W_i^{UK})^{\top}\,\mathbf{q}_{t,i}^{C}\big)^{\top}\,\mathbf{c}_j^{KV},
$$

其中 $W_i^{UK} \in \mathbb{R}^{d_{\text{head}} \times d_c}$ 是 $W^{UK}$ 的第 $i$ 个头的分块。注意最右边：$(W_i^{UK})^{\top}\mathbf{q}_{t,i}^{C}$ 是一个 $d_c$ 维向量，它与缓存的 $\mathbf{c}_j^{KV}$ 直接做内积就得到 logits，相当于把解压矩阵从 K 侧「吸收」到了 Q 侧，每头预先算好 $W^{UK}_i$ 的转置即可，历史 K 根本不需要显式还原。

输出侧同理。第 $i$ 个头的输出是 value 的加权和，而 value 也是隐向量解压出来的：

$$
\mathbf{o}_{t,i}
=
\sum_{j}\alpha_{t,j}^{(i)}\,\mathbf{v}_{j,i}^{C}
=
W_i^{UV}\,\underbrace{\sum_{j}\alpha_{t,j}^{(i)}\,\mathbf{c}_j^{KV}}_{\mathbf{z}_{t,i}\in\mathbb{R}^{d_c}},
$$

先在隐空间里对 $\mathbf{c}_j^{KV}$ 做加权求和得到 $\mathbf{z}_{t,i}$，再一次性上投影。而各头输出最后要拼起来乘 $W^O$，把 $W^{O}$ 按头分块记作 $W_i^{O} \in \mathbb{R}^{d \times d_{\text{head}}}$，则

$$
\mathbf{u}_t
=
\sum_{i=1}^{n_h} W_i^{O}\,\mathbf{o}_{t,i}
=
\sum_{i=1}^{n_h} \big(W_i^{O} W_i^{UV}\big)\,\mathbf{z}_{t,i},
$$

每头的 $W_i^{O}W_i^{UV} \in \mathbb{R}^{d \times d_c}$ 可以预先合并成一个矩阵，$W^{UV}$ 被「吸收」进了 $W^{O}$。

于是推理时的图景变成了：缓存存 $\mathbf{c}^{KV}$，logits 在隐空间里直接算，value 也以隐向量形式加权聚合，**K 和 V 从头到尾都不需要被还原出来**。缓存省下来了，重复还原历史 K/V 的计算也省下来了。

## 查询压缩

MLA 对 query 也做了同样的低秩分解：

$$
\mathbf{c}_t^{Q} = W^{DQ}\,\mathbf{h}_t \in \mathbb{R}^{d_c'},
\qquad
\mathbf{q}_t^{C} = W^{UQ}\,\mathbf{c}_t^{Q},
$$

$W^{DQ} \in \mathbb{R}^{d_c' \times d}$，$W^{UQ} \in \mathbb{R}^{n_h d_{\text{head}} \times d_c'}$。不过目的不同：query 不需要缓存，压它省的不是 KV cache，而是训练时的激活显存与参数量。配合上一节的吸收，logits 最终写成

$$
(\mathbf{q}_{t,i}^{C})^{\top}\mathbf{k}_{j,i}^{C}
=
(\mathbf{c}_t^{Q})^{\top}\,\underbrace{(W_i^{UQ})^{\top}W_i^{UK}}_{\text{每头一个可预计算的 }d_c'\times d_c\text{ 矩阵}}\,\mathbf{c}_j^{KV}.
$$

## 代码示例

下面这个模块按论文公式实现 MLA 的朴素前向：先压缩，再显式解压出 K/V 做注意力。先不引入位置编码，下一节再处理。参数名 `d_c`、`d_cq` 分别对应公式里的 $d_c$ 与 $d_c'$。

```python
class MLA(nn.Module):
    """多头潜在注意力：K/V 联合压缩进隐向量 c_kv，用时再解压。"""

    def __init__(self, d: int, n_heads: int, d_head: int, d_c: int, d_cq: int) -> None:
        super().__init__()
        self.n_heads, self.d_head, self.d_c = n_heads, d_head, d_c
        self.w_dkv = nn.Linear(d, d_c, bias=False)                   # 联合压缩
        self.w_uk = nn.Linear(d_c, n_heads * d_head, bias=False)     # K 解压
        self.w_uv = nn.Linear(d_c, n_heads * d_head, bias=False)     # V 解压
        self.w_dq = nn.Linear(d, d_cq, bias=False)                   # Q 压缩
        self.w_uq = nn.Linear(d_cq, n_heads * d_head, bias=False)    # Q 解压
        self.w_o = nn.Linear(n_heads * d_head, d, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [B, L, d]，朴素版：显式还原全部 K/V
        B, L, _ = x.shape
        c_kv = self.w_dkv(x)                                       # [B, L, d_c]
        k = self.w_uk(c_kv).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        v = self.w_uv(c_kv).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        q = self.w_uq(self.w_dq(x)).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        scores = q @ k.transpose(-1, -2) / math.sqrt(self.d_head)
        mask = torch.ones(L, L, dtype=torch.bool, device=x.device).tril()
        scores = scores.masked_fill(~mask, -torch.inf)
        o = scores.softmax(-1) @ v
        return self.w_o(o.transpose(1, 2).reshape(B, L, -1))
```

然后是吸收版单步解码。缓存里只放 $\mathbf{c}^{KV}$，logits 用吸收后的隐空间 query 计算，value 侧先在隐空间聚合再投影：

```python
    @torch.no_grad()
    def absorbed_step(self, h_t: torch.Tensor, cache=None):
        """单 token 解码：只缓存 c_kv，K/V 不显式还原。h_t: [B, 1, d]"""
        c_kv = self.w_dkv(h_t)                                     # [B, 1, d_c]
        cache = c_kv if cache is None else torch.cat([cache, c_kv], dim=1)

        q_c = self.w_uq(self.w_dq(h_t)).view(-1, 1, self.n_heads, self.d_head)
        w_uk = self.w_uk.weight.view(self.n_heads, self.d_head, self.d_c)

        # W_uk^T 被吸进 Q 侧：q_lat[i] = W_uk_i^T q_c_i，与 c_kv 同维
        q_lat = torch.einsum("btha,hac->bthc", q_c, w_uk)          # [B, 1, H, d_c]
        scores = torch.einsum("bthc,bsc->bths", q_lat, cache) / math.sqrt(self.d_head)
        attn = scores.softmax(-1)

        # 先在隐空间加权聚合，再经 W_uv 各头切片上投影，等价于把 W_uv 并进 W_o
        z = torch.einsum("bths,bsc->bthc", attn, cache)            # [B, 1, H, d_c]
        w_uv = self.w_uv.weight.view(self.n_heads, self.d_head, self.d_c)
        o = torch.einsum("bthc,hac->btha", z, w_uv)                # [B, 1, H, d_head]
        return self.w_o(o.reshape(-1, 1, self.n_heads * self.d_head)), cache
```

注意 `w_uk.weight` 的形状：PyTorch 的 `nn.Linear(in, out)` 权重是 `[out, in]`，所以 `view(H, d_head, d_c)` 的第 $i$ 块正好是 $W_i^{UK}$。验证两种算法逐位一致，并数一数缓存：

```python
torch.manual_seed(0)
mla = MLA(d=128, n_heads=4, d_head=16, d_c=32, d_cq=48).eval()
x = torch.randn(1, 10, 128)

ref = mla(x)                                     # 朴素版整段前向
cache = None
for t in range(10):                              # 吸收版逐 token 解码
    out_t, cache = mla.absorbed_step(x[:, t : t + 1], cache)
    assert torch.allclose(out_t, ref[:, t : t + 1], atol=1e-5)

kv_elems = 2 * mla.n_heads * mla.d_head          # 同配置 MHA 的每 token 每层缓存
print(f"吸收版与朴素版逐位一致")
print(f"每 token 每层缓存：MLA {mla.d_c} 元素，MHA {kv_elems} 元素，压缩 {kv_elems / mla.d_c:.0f} 倍")
```

输出：

```text
吸收版与朴素版逐位一致
每 token 每层缓存：MLA 32 元素，MHA 128 元素，压缩 4 倍
```

# 解耦 RoPE

MLA 看起来已经很完美了，但还有一个问题被刻意回避了：位置编码。[EP.3](../llm-position-encoding/) 讲过，现代 LLM 几乎都用 RoPE，而把它直接施加到内容 K/Q 上，会妨碍刚才的矩阵吸收。

原因就在矩阵吸收上。给 $\mathbf{k}_j^{C}$ 施加位置 $j$ 的旋转 $R_j$、给 $\mathbf{q}_{t,i}^{C}$ 施加位置 $t$ 的旋转 $R_t$ 之后，把 $\mathbf{q}_{t,i}^{C} = W_i^{UQ}\mathbf{c}_t^{Q}$ 也展开，logits 变成

$$
(\mathbf{q}_{t,i}^{C})^{\top}\,R_t^{\top}\,R_j\,W_i^{UK}\,\mathbf{c}_j^{KV}
=
(\mathbf{c}_t^{Q})^{\top}\,(W_i^{UQ})^{\top}\,\underbrace{R_t^{\top}R_j}_{R_{j-t}}\,W_i^{UK}\,\mathbf{c}_j^{KV}.
$$

$R_{j-t}$ 是随相对位置变化的块对角矩阵，正好卡在 $(W_i^{UQ})^{\top}$ 与 $W_i^{UK}$ 之间。中间因子依赖相对位置，因而无法像前面那样预先合并为一个与位置无关的固定矩阵。朴素做法需要还原 K 后旋转，前面那条固定矩阵吸收的路被 RoPE 堵住了。

> **DeepSeek 怎么办？把位置信息从压缩通道里拆出去。**

这就是**解耦 RoPE**（decoupled RoPE）：在原本的内容通道之外，额外开一条窄小的位置通道，专门承载 RoPE。对 query，每头从 $\mathbf{c}_t^{Q}$ 投影出一段 $d_r$ 维向量并旋转：

$$
\mathbf{q}_{t,i}^{R} = \operatorname{RoPE}\big(W_i^{QR}\,\mathbf{c}_t^{Q}\big) \in \mathbb{R}^{d_r};
$$

对 key，直接从输入投影出一个 $d_r$ 维向量并旋转，**所有头共享同一份**：

$$
\mathbf{k}_t^{R} = \operatorname{RoPE}\big(W^{KR}\,\mathbf{h}_t\big) \in \mathbb{R}^{d_r}.
$$

然后拼接：$\mathbf{q}_{t,i} = [\mathbf{q}_{t,i}^{C};\ \mathbf{q}_{t,i}^{R}]$，$\mathbf{k}_{t,i} = [\mathbf{k}_{t,i}^{C};\ \mathbf{k}_t^{R}]$。由于内积对拼接向量是分段相加的，logits 自然拆成两项：

$$
\mathbf{q}_{t,i}^{\top}\mathbf{k}_{j,i}
=
\underbrace{(\mathbf{q}_{t,i}^{C})^{\top}\mathbf{k}_{j,i}^{C}}_{\text{内容分，可吸收}}
+
\underbrace{(\mathbf{q}_{t,i}^{R})^{\top}\mathbf{k}_{j}^{R}}_{\text{位置分，RoPE 只管这里}},
$$

softmax 的缩放因子相应改成 $\sqrt{d_{\text{head}} + d_r}$。内容通道保持「可压缩、可吸收」，位置通道单独携带旋转，两者互不干扰。代价是缓存里除了 $\mathbf{c}^{KV}$ 还要多存一份共享的 $\mathbf{k}^{R}$，每 token 每层变成 $d_c + d_r$ 个元素。

## 代码示例

在 `MLA` 上加两个投影：`w_qr` 从 $\mathbf{c}^{Q}$ 生成每头的位置 query，`w_kr` 从输入直接生成共享的位置 key。RoPE 函数沿用 [EP.3](../llm-position-encoding/) 的半区配对实现，这里直接重述：

```python
def precompute_cos_sin(L: int, d_rope: int, base: float = 10000.0):
    inv_freq = base ** (-torch.arange(0, d_rope, 2).float() / d_rope)
    angles = torch.arange(L).float()[:, None] * inv_freq[None, :]   # [L, d_rope/2]
    return angles.cos(), angles.sin()

def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    # x: [..., d_rope]，cos/sin: [..., d_rope/2]，广播对齐
    x1, x2 = x.chunk(2, dim=-1)
    return torch.cat([x1 * cos - x2 * sin, x2 * cos + x1 * sin], dim=-1)
```

```python
class MLADecoupledRoPE(MLA):
    """MLA + 解耦 RoPE：内容通道走低秩压缩，位置通道各头共享。"""

    def __init__(self, d, n_heads, d_head, d_c, d_cq, d_rope) -> None:
        super().__init__(d, n_heads, d_head, d_c, d_cq)
        self.d_rope = d_rope
        self.w_qr = nn.Linear(d_cq, n_heads * d_rope, bias=False)   # 每头的位置 q
        self.w_kr = nn.Linear(d, d_rope, bias=False)                # 共享的位置 k

    def forward(self, x: torch.Tensor, cos, sin) -> torch.Tensor:
        B, L, _ = x.shape
        c_kv, c_q = self.w_dkv(x), self.w_dq(x)
        k_c = self.w_uk(c_kv).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        v = self.w_uv(c_kv).view(B, L, self.n_heads, self.d_head).transpose(1, 2)
        q_c = self.w_uq(c_q).view(B, L, self.n_heads, self.d_head).transpose(1, 2)

        k_r = apply_rope(self.w_kr(x), cos, sin)                    # [B, L, d_rope]
        q_r = apply_rope(self.w_qr(c_q).view(B, L, self.n_heads, self.d_rope), cos[:, None], sin[:, None])
        k_r = k_r[:, :, None].expand(-1, -1, self.n_heads, -1).transpose(1, 2)

        q = torch.cat([q_c, q_r.transpose(1, 2)], dim=-1)           # [B, H, L, d_head + d_rope]
        k = torch.cat([k_c, k_r], dim=-1)
        scores = q @ k.transpose(-1, -2) / math.sqrt(self.d_head + self.d_rope)
        mask = torch.ones(L, L, dtype=torch.bool, device=x.device).tril()
        scores = scores.masked_fill(~mask, -torch.inf)
        o = scores.softmax(-1) @ v
        return self.w_o(o.transpose(1, 2).reshape(B, L, -1))
```

吸收版也要相应调整：缓存里同时放 $\mathbf{c}^{KV}$ 和已旋转的 $\mathbf{k}^{R}$，内容分用 $q_{\text{lat}}$ 在隐空间算，位置分直接对缓存的 $\mathbf{k}^{R}$ 做内积：

```python
    @torch.no_grad()
    def absorbed_step(self, h_t: torch.Tensor, pos: int, cos, sin, cache=None):
        """单 token 解码：缓存 c_kv 与旋转后的 k_r。h_t: [B, 1, d]"""
        c_kv = self.w_dkv(h_t)                                       # [B, 1, d_c]
        k_r = apply_rope(self.w_kr(h_t), cos[pos], sin[pos])         # [B, 1, d_rope]
        new = torch.cat([c_kv, k_r], dim=-1)                         # 进缓存的全部内容
        cache = new if cache is None else torch.cat([cache, new], dim=1)
        c_cache, kr_cache = cache[..., : self.d_c], cache[..., self.d_c :]

        c_q = self.w_dq(h_t)
        q_c = self.w_uq(c_q).view(-1, 1, self.n_heads, self.d_head)
        q_r = apply_rope(self.w_qr(c_q).view(-1, 1, self.n_heads, self.d_rope), cos[pos], sin[pos])

        w_uk = self.w_uk.weight.view(self.n_heads, self.d_head, self.d_c)
        q_lat = torch.einsum("btha,hac->bthc", q_c, w_uk)              # 内容分：吸收版
        s_c = torch.einsum("bthc,bsc->bths", q_lat, c_cache)
        s_r = torch.einsum("bthr,bsr->bths", q_r, kr_cache)            # 位置分：直接算
        attn = ((s_c + s_r) / math.sqrt(self.d_head + self.d_rope)).softmax(-1)

        z = torch.einsum("bths,bsc->bthc", attn, c_cache)
        w_uv = self.w_uv.weight.view(self.n_heads, self.d_head, self.d_c)
        o = torch.einsum("bthc,hac->btha", z, w_uv)
        return self.w_o(o.reshape(-1, 1, self.n_heads * self.d_head)), cache
```

注意位置分的内积 `s_r` 直接用缓存的 `kr_cache`：$\mathbf{k}^{R}$ 在入缓存时就已经按自己的位置旋转过了，读出来即用，这正是解耦的意义：它不参与低秩压缩，位置信息不会卡住吸收。验证完整 MLA 的两种实现：

```python
torch.manual_seed(0)
L = 10
cos, sin = precompute_cos_sin(L, d_rope=8)
mla = MLADecoupledRoPE(d=128, n_heads=4, d_head=16, d_c=32, d_cq=48, d_rope=8).eval()
x = torch.randn(1, L, 128)

ref = mla(x, cos, sin)
cache = None
for t in range(L):
    out_t, cache = mla.absorbed_step(x[:, t : t + 1], pos=t, cos=cos, sin=sin, cache=cache)
    assert torch.allclose(out_t, ref[:, t : t + 1], atol=1e-5)

per_tok = mla.d_c + mla.d_rope
print(f"吸收版与朴素版逐位一致")
print(f"每 token 每层缓存：{per_tok} 元素：d_c={mla.d_c} + d_rope={mla.d_rope}")
```

输出：

```text
吸收版与朴素版逐位一致
每 token 每层缓存：40 元素：d_c=32 + d_rope=8
```

## 实际配置

最后把 DeepSeek-V2 的真实数字放进公式。它的注意力配置是 $n_h = 128$、$d_{\text{head}} = 128$、$d_c = 4\,d_{\text{head}} = 512$、$d_c' = 1536$、$d_r = d_{\text{head}}/2 = 64$，共 $L = 60$ 层：

$$
\text{每 token 缓存} = (d_c + d_r) \cdot L = (512 + 64) \times 60 = 34560 \ \text{个元素}.
$$

换成标准 MHA 的算法是 $2 \times 128 \times 128 \times 60 \approx 197$ 万，MLA 只有它的 **1.8%**；换成 GQA 的口径，相当于一个只有 **2.25 组**的 GQA，也只有 MQA 的 $2 d_{\text{head}} L = 15360$ 的 2.25 倍。这里的 1.8% 是固定头数、每头维度与层数后的理论比较。附录 D.2 另行训练了 16B 与 250B 两组 MoE 模型；它们的 MHA 基线缓存规模与上面的假设不同，对应缓存比例约为 14% 和 4%。小模型训练 1.33T token，大模型训练 420B token，结果如下：

| 规模 | 指标 | MHA | MLA |
|---|---|---|---|
| 16B | 每 token 缓存 | 110.6K | 15.6K |
| 16B | MMLU / BBH | 48.7 / 37.9 | 50.0 / 39.0 |
| 16B | C-Eval | 51.6 | 50.9 |
| 250B | 每 token 缓存 | 860.2K | 34.6K |
| 250B | MMLU / BBH | 57.5 / 46.6 | 59.0 / 50.7 |
| 250B | C-Eval | 57.9 | 59.2 |

![cache-compare](/img/posts/llm-mla/cache-compare.svg)

MLA 在这些实验的多数指标上更好，小模型的 C-Eval 则略有下降。

两个工程细节也值得知道。其一，论文在压缩隐向量后面加了额外的 RMSNorm，并在瓶颈处乘缩放因子，因为低秩压缩会改变层的输出尺度，这与 [EP.2](../llm-normalization/) 讲的归一化思路一脉相承。上面的教学代码省略了这些归一化、额外缩放以及长上下文 YaRN 配置，验证的是简化结构中朴素前向与吸收计算的等价性。其二，吸收形式下 logits 是在 $d_c$ 维的隐空间里算的，它换来的是显存与带宽，而不是更少的乘加。长上下文 decode 的瓶颈在搬运缓存，这笔交换是划算的。

MLA 此后成了 DeepSeek 的标志性设计：V3、R1 沿用同一结构，Kimi K2 等模型也采用了它。回头看整个方案，它把「压缩缓存」和「保住表达能力」这两个本来矛盾的目标，用「共享一个隐向量、各自做投影」的方式同时拿到了。

# 结语

本文沿着一条问题的线索走到了 MLA：自回归生成让历史 K/V 可以缓存，缓存却成了显存和带宽的双重瓶颈；MQA/GQA 用共享换缓存，在上面的实验中付出了性能代价；MLA 改用低秩联合压缩，让每个头仍有自己的 K/V，只是共享同一个隐向量；矩阵吸收用结合律避免显式还原历史 K/V；解耦 RoPE 则把位置信息请出压缩通道，补上了最后一块拼图。

注意力侧的改造故事不止这一种讲法，但 MLA 是目前最干净利落的一个：它不靠砍头来省显存，而是靠发现 K/V 里本就存在的冗余。下一篇我们继续在 LLM 的核心技术上拆小、拆透。

# 参考资料

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Fast Transformer Decoding: One Write-Head is All You Need](https://arxiv.org/abs/1911.02150)
- [GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints](https://arxiv.org/abs/2305.13245)
- [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864)
- [DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models](https://arxiv.org/abs/2401.06066)
- [DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model](https://arxiv.org/abs/2405.04434)
- [DeepSeek-V3 Technical Report](https://arxiv.org/abs/2412.19437)
- [DeepSeek-V2 推理代码](https://github.com/deepseek-ai/DeepSeek-V2)
- [small-language-model](https://github.com/Momoyeyu/small-language-model)
- [RethinkFun：DeepSeek V2](https://www.rethink.fun/chapter18/DeepSeekV2.html)
