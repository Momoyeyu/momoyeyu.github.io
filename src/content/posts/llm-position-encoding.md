---
title: 位置编码技术的演进
date: 2026-09-30
description: 本文梳理 Transformer 的位置编码演进：为什么注意力需要位置信息，正弦编码、可学习编码、相对位置编码、ALiBi 与 RoPE 各自的设计取舍与长度外推。
tags: [LLM]
category: LLM
episode: 3
draft: true
lang: zh_CN
---

# 前言

在[第一篇](../llm-transformer/)实现 Transformer 时，我们直接使用了原始论文的正弦位置编码，当时只是把它当作一个黑盒；在[上一篇](../llm-normalization/)讨论归一化时，我们也提到 QK-Norm 与 RoPE 之间存在先后顺序问题。本文就来把这些伏笔收回来：从注意力为什么需要位置信息讲起，沿着绝对位置编码、相对位置编码、ALiBi、RoPE 一路梳理到长度外推，看看现代 LLM 的位置编码是如何一步步演进成今天的样子的。

# 为什么需要位置编码

## 排列等变性

回顾 Self-Attention 的计算：

$$
\text{Attention}(Q, K, V)
=
\text{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right)V.
$$

这个计算对输入序列的顺序是完全无感的（先不考虑 mask）：如果把输入 token 的顺序打乱，输出的每一行只会跟着重排，内容本身一个字都不会变。也就是说，「我打他」和「他打我」在 Attention 看来是完全一样的输入——这对语言模型显然是不可接受的。可以用一个玩具实验直接验证：

```python
# mha 为 EP.0 中实现的 MultiHeadAttention
x = torch.randn(1, L, d_model)                             # [1, L, d_model]
out = mha(x, x, x)                                         # [1, L, d_model]
out_shuffled = mha(x.flip(1), x.flip(1), x.flip(1))
assert torch.allclose(out_shuffled, out.flip(1), atol=1e-5)  # 只是跟着重排
```

这个性质称为**排列等变**（permutation equivariance）。因此，位置信息必须从外部注入。

## 评价维度

注入位置信息的方式有很多，梳理演进历史之前，先明确评价一种位置编码的几个维度：

1. **绝对还是相对**：编码的是「token 在第几个位置」，还是「两个 token 相距多远」；
2. **能否外推**：训练时只见过长度 $L$，推理时遇到 $4L$ 是否还能正常工作；
3. **工程兼容性**：是否与 KV cache、FlashAttention 等推理优化兼容；
4. **是否引入额外参数与计算**。

后面每讲到一种方法，都可以回到这张评分表上对照。而纵观所有方案，注入位置的路其实只有两条：

![pe-inject](/img/posts/llm-position-encoding/pe-inject.svg)

要么加在 token 表示上，要么藏在 attention score 里。本文的演进主线，就是位置信息沿着这两条路不断迁移的过程。

# 绝对位置编码

## 正弦编码

原始 Transformer 的做法是为每个位置生成一个与 token embedding 同维度的向量，两者相加后送入网络。这个向量不是学出来的，而是按固定公式生成的：

$$
PE_{(pos,\,2i)} = \sin\left(\frac{pos}{10000^{2i/d}}\right),
\quad
PE_{(pos,\,2i+1)} = \cos\left(\frac{pos}{10000^{2i/d}}\right),
$$

其中 $pos$ 是位置，$i$ 是维度下标，$d$ 是 embedding 维度。

直觉上，可以把不同维度理解成频率不同的时钟：低维度的正弦周期短、转得快，高维度的周期长、转得慢。每个位置在所有维度上的取值合起来，就构成了一个独一无二的「指纹」。

![sine-pe](/img/posts/llm-position-encoding/sine-pe.svg)

正弦编码还有一个精心设计的性质：$PE_{pos+k}$ 可以表示为 $PE_{pos}$ 的线性函数。利用三角函数的和角公式：

$$
\sin((pos+k)\omega)
=
\sin(pos\,\omega)\cos(k\omega) + \cos(pos\,\omega)\sin(k\omega),
$$

即相对偏移 $k$ 对应一个只依赖 $k$ 的线性变换。这为模型提供了感知相对位置的线索——不过这个性质当时并没有被充分利用，真正把它发扬光大的是后面的 RoPE。

局限也很明显：外推性差。位置超出训练见过的最大长度后，正弦指纹落到了模型从未见过的区域，行为变得不可预测。正弦编码的实现我们在 [EP.0](../llm-transformer/) 已经写过，这里不再重复。

## 可学习编码

BERT、GPT-2 等模型走了另一条更直接的路：准备一张 $(L_{max}, d)$ 的嵌入表，让每个位置的编码向量成为可学习参数，随模型一起训练。

```python
self.pos_emb = nn.Embedding(max_len, d_model)
x = tok_emb(x) + self.pos_emb(torch.arange(L))   # [B,L,d_model] + [L,d_model]
```

可学习编码更灵活，模型可以自由决定每个位置该长什么样。但代价是 $L_{max}$ 成了硬天花板：训练时表只有 $L_{max}$ 行，推理时遇到更长的序列，要么重训一张更大的表，要么对已有位置做插值——而且插值效果如何并没有保证。

# 相对位置编码

仔细观察上面的方法会发现一个共同点：它们编码的都是「token 在第几个位置」这样的**绝对**信息。但注意力真正需要的其实是「$i$ 和 $j$ 相距多远」这样的**相对**信息。于是一个自然的想法是：

> **能不能只编码相对距离，而不关心 token 的绝对位置？**

相对位置编码的思路就是把位置信息从 token 表示上挪开，注入到 attention score 中去。

## 相对位置偏置

最早的做法来自 [Shaw et al. 2018](https://arxiv.org/abs/1803.02155)：为每个相对距离准备一组可学习向量，加到 key 和 value 上，距离超出一定范围就截断到同一个桶里。

[T5](https://arxiv.org/abs/1910.10683) 把这个思路进一步简化到极致：不再给 key/value 加向量，而是把相对距离分桶，每个桶对应一个可学习标量 bias，直接加到 attention logits 上：

```python
i = torch.arange(L)[:, None]                  # [L, 1]
j = torch.arange(L)[None, :]                  # [1, L]
rel = (j - i).clamp(-max_dist, max_dist)      # [L, L]，相对距离截断
bias = self.rel_bias(self.bucket(rel))        # [L, L]，查表
logits = q @ k.transpose(-1, -2) / math.sqrt(d_head) + bias  # [L, L]
```

两者本质是同一做法的两个粒度：都是往 score 上加一个依赖 $(i-j)$ 的项，只是一个加向量、一个加标量。

## 重参数化

[Transformer-XL](https://arxiv.org/abs/1901.02860) 则走了更理论化的一条路：把 attention score 展开为 content-content、content-position、position-content、position-position 四项并重参数化，使每一项都只依赖相对距离。这样改动之后，位置信息同样只进入 score，并且还顺带支撑了 Transformer-XL 的 segment 级循环机制。

## 局限

相对位置编码方向正确，但实现上都有一个共同代价：score 里多出一个依赖位置对 $(i,j)$ 的项。这个 $L\times L$ 的偏置矩阵需要额外显存与计算，更关键的是它与 FlashAttention 这类不显式物化 score 矩阵的实现不兼容——模型可以选择为它退回普通 attention，但推理效率就丢了。这是它们没有成为主流的直接原因。

# ALiBi

相对位置偏置仍然需要在 score 里学一组参数。顺着这个思路可以再推一步：

> **能不能连位置参数都不学，直接写一个固定的偏置？**

[ALiBi](https://arxiv.org/abs/2108.12409) 的做法简单到有点极端：token 上什么都不加，只在 attention logits 上加一个与距离成正比的固定惩罚项：

$$
\text{logits}_{ij}
=
\frac{\mathbf{q}_i \cdot \mathbf{k}_j}{\sqrt{d}}
-
m \cdot |i - j|.
$$

其中 $m$ 是每个注意力头各自的斜率，按几何级数取值，例如 8 个头时取 $2^{-1}, 2^{-2}, \dots, 2^{-8}$：

```python
i = torch.arange(L)[:, None]                  # [L, 1]
j = torch.arange(L)[None, :]                  # [1, L]
slopes = torch.pow(2.0, -torch.arange(1, H + 1) * (8.0 / H))  # [H]
bias = -slopes[:, None, None] * (j - i).abs()       # [H, L, L]
logits = q @ k.transpose(-1, -2) / math.sqrt(d_head) + bias   # [H, L, L]
```

![alibi](/img/posts/llm-position-encoding/alibi.svg)

ALiBi 的收益很诱人：零参数、几乎没有额外计算，而且「近处多注意、远处少注意」的归纳偏置天然符合语言的局部性，外推到更长序列时表现意外地好——原论文的标题就叫 *Train Short, Test Long*。但硬币的另一面是，硬性距离惩罚对需要远程依赖的任务不利；当上下文窗口越来越长、长距离检索越来越重要时，这条路线就逐渐让位给了 RoPE。

# RoPE

## 核心思想

[RoPE](https://arxiv.org/abs/2104.09864) 的思路非常巧妙：它给的是绝对位置，但产生的是相对效果。具体做法是，把 Q/K 的每个二维分量看作复数，按各自位置旋转角度 $m\,\theta_i$ 与 $n\,\theta_i$：

$$
\mathbf{q}_m
=
R_m\,\mathbf{q},
\quad
\mathbf{k}_n
=
R_n\,\mathbf{k},
$$

其中 $R_m$ 是按位置 $m$ 构造的旋转矩阵，$\theta_i = 10000^{-2i/d_{\text{head}}}$ 是第 $i$ 个维度对的旋转频率。

![rope](/img/posts/llm-position-encoding/rope.svg)

关键在于旋转矩阵满足 $R_m^\top R_n = R_{n-m}$，于是内积：

$$
\mathbf{q}_m^\top \mathbf{k}_n
=
\mathbf{q}^\top R_m^\top R_n\, \mathbf{k}
=
\mathbf{q}^\top R_{n-m}\, \mathbf{k}
=
(R_{m-n}\,\mathbf{q})^\top \mathbf{k},
$$

结果只依赖相对距离 $m-n$，与绝对位置无关。token 带着自己的绝对位置旋转，attention score 却天然只感知相对距离——绝对位置、相对效果，说的就是这一点。

二维情形的推导尤其简洁：把维度对 $(x_1, x_2)$ 看作复数 $x_1 + ix_2$，旋转 $m\theta$ 就是乘上 $e^{im\theta}$。高维时把维度两两分组，每组用各自的频率 $\theta_i$，合起来就是一个块对角的旋转矩阵：

$$
R_m
=
\begin{pmatrix}
\cos m\theta_1 & -\sin m\theta_1 & & \\
\sin m\theta_1 & \cos m\theta_1 & & \\
& & \ddots & \\
& & & \cos m\theta_{d/2} & -\sin m\theta_{d/2} \\
& & & \sin m\theta_{d/2} & \cos m\theta_{d/2}
\end{pmatrix}.
$$

这里画出的是原始论文的相邻维配对形式，与下文代码使用的 half-split 配对只差一个维度置换。工程上并不需要真的构造这个稀疏矩阵——展开后会发现它就是「一半乘 cos、一半乘 sin 再互换相加」的逐元素运算，可以直接写成几行代码，也很容易融合进 kernel。

## 性质

RoPE 有两个值得注意的性质。其一是**远程衰减**：苏剑林在原始分析中指出，在一定条件下注意力得分随距离增大呈衰减趋势——和 ALiBi 的直觉殊途同归，但机制完全不同。需要注意的是这个结论并不严格单调，各频率分量的叠加会产生波动，所以更准确的说法是「整体上呈现衰减趋势」。

其二是**工程兼容性**：RoPE 只在 Q、K 上作用，score 算完它就消失了——attention 内部、FFN、残差流里都没有它的痕迹。因此它与 KV cache、FlashAttention 完全兼容，这正是它在工程上完胜前面那些方案的原因。

## 实现细节

读开源代码时有两个细节必须先确认，否则很容易踩坑：

* **维度配对方式**。RoPE 原始论文的公式是相邻维两两配对 $(2i, 2i+1)$，即 interleaved；而 HuggingFace / LLaMA 的实现是前后两半配对 $(i, i+d_{\text{head}}/2)$，即 half-split。两者只差一个维度置换，数学上等价，但混用会得到完全不同的结果；
* **base 的选择**。原始值取 10000，它决定低频维的波长。base 越大，低频维转得越慢、能覆盖的上下文越长——它是后面所有长度外推技巧的总旋钮。

## 解耦 RoPE

RoPE 与 KV cache 兼容，但它让 K 依赖绝对位置这一点，在某些架构里反而会出问题。[DeepSeek-V2](https://arxiv.org/abs/2405.04434) 的 MLA 就是一个例子：MLA 想把 KV 压成一个低秩的隐向量存进 cache，但如果 K 带了 RoPE，位置信息与内容纠缠在一起，压缩表示就不再成立。

DeepSeek 的解法是**解耦 RoPE**：把 key 拆成两条通路——一条走低秩压缩、不带 RoPE，承载语义内容；另一条是专门的窄 key，不做压缩、专门携带 RoPE 位置信息。用一小部分额外容量，换来了「KV 可压缩」和「位置可编码」两者兼得。这也是 RoPE 进入现代 LLM 架构设计的一个代表性案例，和 [EP.1](../llm-moe/) 的 DeepSeekMoE 一脉相承。

## 代码实现

先用矩阵形式把推导坐实。RoPE 的旋转矩阵是块对角的，每个 $2\times2$ 块对应一对维度、一个频率。下面采用 half-split 配对，即第 $i$ 维与第 $i + d_{\text{head}}/2$ 维一组：

```python
def rope_matrix(pos: int, d_head: int, base: float = 10000.0) -> torch.Tensor:
    inv_freq = base ** (-torch.arange(0, d_head, 2).float() / d_head)  # [d/2]
    R = torch.zeros(d_head, d_head)                                    # [d, d]
    half = d_head // 2
    for i, theta in enumerate(pos * inv_freq):           # 第 i 维与第 i+d/2 维配对
        c, s = theta.cos(), theta.sin()
        R[i,       i]      = c;  R[i,       i + half] = -s
        R[i + half, i]     = s;  R[i + half, i + half] = c
    return R                                             # [d, d]，R(pos)
```

工程实现不建矩阵：预计算每个位置的 cos/sin，对向量做逐元素运算即可。

```python
def precompute_cos_sin(L: int, d_head: int, base: float = 10000.0):
    inv_freq = base ** (-torch.arange(0, d_head, 2).float() / d_head)  # [d/2]
    pos = torch.arange(L).float()                                    # [L]
    angles = pos[:, None] * inv_freq[None, :]            # [L, d/2]
    return angles.cos(), angles.sin()

def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    # x: [T, d]，cos/sin: [T, d/2]
    x1, x2 = x.chunk(2, dim=-1)                          # [T, d/2], [T, d/2]
    return torch.cat([x1 * cos - x2 * sin, x2 * cos + x1 * sin], dim=-1)  # [T, d]
```

`apply_rope` 里 `x1 * cos - x2 * sin` 与 `x2 * cos + x1 * sin` 正是 $2\times2$ 旋转矩阵 $\begin{pmatrix}\cos & -\sin \\ \sin & \cos\end{pmatrix}$ 的展开，配对约定与上面的 `rope_matrix` 保持一致。

最后数值验证 RoPE 的核心性质：内积只依赖相对位置。

```python
cos, sin = precompute_cos_sin(L=512, d_head=64)        # [L, d/2], [L, d/2]
q, k = torch.randn(64), torch.randn(64)                # [d], [d]
m, n = 100, 37

lhs = apply_rope(q, cos[m], sin[m]) @ apply_rope(k, cos[n], sin[n])
rhs = (rope_matrix(m - n, 64) @ q) @ k                    # (R_{m-n} q) · k
assert torch.allclose(lhs, rhs, atol=1e-5)
```

# 长度外推

RoPE 性质很好，但它有一个软肋：**外推**。训练时模型只见过长度 $L$ 以内的位置，低频维的旋转角 $pos\cdot\theta_i$ 在训练分布内是有限的；推理时位置一旦超出 $L$，低频维的角度就落到了训练时从未见过的区域，模型的困惑度会急剧上升。

围绕这个问题，社区发展出了一系列补救手段。

## 位置插值

[Position Interpolation](https://arxiv.org/abs/2306.15595) 的思路很直接：既然位置 $pos > L$ 没见过，那就把所有位置除以缩放因子 $s$，把 $4L$ 的位置压回 $[0, L]$ 的训练区间：

$$
\text{angles}
=
\frac{pos}{s}
\cdot
\theta_i.
$$

代价是相邻位置的区分度被压缩了 $s$ 倍，高频维的分辨率受影响最明显，因此 PI 通常需要配合少量步数的微调才能让模型重新适应。

## 缩放 base

PI 对所有维度等比缩放，但有些维度（高频维）在 $L$ 内就已经转过很多圈，插值对它们的伤害最大。NTK-aware 缩放的思路是不动位置、改 base：把 base 调大，让低频维转得更慢，从而把视角拉远。高频维几乎不受影响，低频维被拉伸——不微调也能获得一定的外推能力。推理时按输入长度动态调整 base 的 **Dynamic NTK**，就是 Qwen 等模型的实际用法。

另一条更粗暴的路是直接在训练期换尺子：LLaMA 2 → 3 把 RoPE base 从 10000 提到 500000，让模型在更长的上下文上从头训练。可以看到，NTK 缩放和调大 base 拧的是同一个旋钮 $base^{-2i/d_{\text{head}}}$，只是一个改在推理侧、一个改在训练侧。

## YaRN

[YaRN](https://arxiv.org/abs/2309.00071) 是目前开源模型拉长上下文的主流方案。它按频率分段处理：高频维直接外推，低频维做插值，中间频段平滑过渡（NTK-by-parts），再对 attention logits 乘一个温度系数做校正，弥补插值后注意力分布变软的问题。相比 PI 它几乎不需要微调，相比纯 NTK 缩放它的外推质量更好。

## 评估方式

需要注意的是，外推效果好坏不能只看 ppl：一个只关注局部的模型也能拿到不错的 ppl。真正的检验是 needle-in-a-haystack 这类长距离检索任务——在长上下文的任意位置藏一条信息，看模型能不能找回来。

## 代码实现

PI 和缩放 base 都只需要动 `precompute_cos_sin` 里的一行：

```python
# Position Interpolation：位置除以缩放因子 s
angles = (pos[:, None] / s) * inv_freq[None, :]         # [L, d/2]

# 缩放 base：换 inv_freq，高频维几乎不变、低频维被拉伸
inv_freq = new_base ** (-torch.arange(0, d_head, 2).float() / d_head)   # [d/2]，θ_i = base^{-2i/d_head}
```

评估外推效果可以用滑窗 ppl：固定窗口向前滑动，累计每个 token 的负对数似然，画出不同上下文长度下的 ppl 曲线。

```python
def eval_ppl(model, ids: torch.Tensor, ctx_len: int, stride: int = 256) -> float:
    # ids: [B, T]，token id
    nlls = []
    for begin in range(0, ids.size(1) - 1, stride):
        end = min(begin + ctx_len, ids.size(1))
        logits = model(ids[:, begin:end]).logits         # [B, t, V]
        target = ids[:, begin + 1 : end + 1]             # [B, t]
        nlls.append(F.cross_entropy(logits[0, -stride - 1 : -1], target[0, -stride:]))  # [stride, V] vs [stride]
        if end == ids.size(1):
            break
    return math.exp(torch.stack(nlls).mean().item())
```

![extrapolation](/img/posts/llm-position-encoding/extrapolation.svg)

只改 base 不微调时，曲线会在超过训练长度后明显抬升；PI 和 NTK 类方法则能把它压平。用这样一条曲线来评估外推方案，比单看一个数字要直观得多。

# NoPE

讨论到这里，一个更根本的问题值得反问一下：

> **我们真的需要位置编码吗？**

[Haviv et al. 2022](https://arxiv.org/abs/2203.16634) 的答案是「未必」。Decoder-only 模型的因果 mask 本身就泄露了位置信息：第 $t$ 个 token 只能看到前 $t$ 个位置，可见序列的长度就隐含了它的绝对位置。实验证明不加任何位置编码的 Decoder-only 模型也能正常工作，甚至在某些长度泛化任务上表现更好。

不过 NoPE 并没有成为主流——显式的位置编码仍然带来了更好的收敛速度与下游效果。但这个方向提醒我们：位置信息未必只能从「加法」或「旋转」里来，模型结构本身也可以是一种编码。

# 多维位置编码

最后提一句多维扩展。在图像和视频里，位置是二维甚至三维的，处理思路和 RoPE 一脉相承：把 head_dim 切成几段，每一段负责一个坐标轴，各自做一维旋转。ViT 中的 2D-RoPE 是这样做的，Qwen-VL 的 M-RoPE（把时间、高度、宽度三个维度分开编码）也是同一个思路，这里点到为止。

# 结语

回顾位置编码的演进，主线其实很清晰：先把位置**加在 token 上**（正弦编码、可学习编码），再把它**藏进 score 里**（相对位置偏置、ALiBi），最后把这个「相对偏移」做成了**旋转**（RoPE）——既保留了相对位置的语义，又不给 attention 计算和推理引擎添任何负担，这是它能成为现代 LLM 默认选择的根本原因。

至于长度外推，PI、NTK、YaRN 三代方法拧的都是同一个旋钮：让低频维的旋转角始终落在模型见过的范围内。理解了 RoPE 的频率结构，这些技巧就只是同一个思想的不同实现。

# 参考资料

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Self-Attention with Relative Position Representations](https://arxiv.org/abs/1803.02155)
- [Transformer-XL: Attentive Language Models Beyond a Fixed-Length Context](https://arxiv.org/abs/1901.02860)
- [Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer](https://arxiv.org/abs/1910.10683)
- [Train Short, Test Long: Attention with Linear Biases Enables Input Length Extrapolation](https://arxiv.org/abs/2108.12409)
- [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864)
- [Extending Context Window of Large Language Models via Positional Interpolation](https://arxiv.org/abs/2306.15595)
- [YaRN: Efficient Context Window Extension of Large Language Models](https://arxiv.org/abs/2309.00071)
- [DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model](https://arxiv.org/abs/2405.04434)
- [Transformer Language Models without Explicit Positional Encodings](https://arxiv.org/abs/2203.16634)
- [The Impact of Positional Encoding on Length Generalization](https://arxiv.org/abs/2305.19466)
