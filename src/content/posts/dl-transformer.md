---
title: Transformer 的数学表示与代码实现
date: 2026-09-14
description: '从 Transformer 开始的深度学习之旅'
tags: [深度学习, Transformer]
category: 深度学习
episode: 0
draft: true
lang: 'zh_CN'
---

# 前言

本文是本站【深度学习】系列的第一篇文章，我们将直接从 Transformer 开始介绍，带你快速了解目前几乎所有大模型、智能体的底层核心模型是如何实现的。

Transformer 最初由 Google Brain 与 Google Research 团队在论文 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 提出，起初用于解决翻译问题。
Transformer 以更低的训练成本和更高的性能在当时成为了翻译领域的 SOTA，随后又被用于解决 NLP 领域的各种问题，且都具有极佳的表现。
本文将主要以这篇论文的 Transformer 进行介绍，后面都以“原始论文”代指。

本文假设读者已经有一定基础，如果你是纯小白，阅读本文可能会比较困难。**不过我并不建议花费大量时间去补充基础，因为如果遇到不懂的概念，你随时可以请教AI，这将会为你节省很多时间。**

本文主要聚焦 Transformer 模型的数学表示以及其代码实现，也就是说，我们会通过数学公式来表示 Transformer 各个模块的计算细节，并通过代码对其进行实现。

接下来，让我们进入正文。

# 模型架构

![ModalNet-21.png](https://s3.bmp.ovh/2026/09/13/hWWm8Md7.png)

Transformer 使用了 **[Encoder-Decoder](https://arxiv.org/abs/1406.1078)** 架构，这是当时解决 seq2seq 问题的经典架构。

接下来我们将分为 Encoder 和 Decoder 进行介绍。其中 Decoder 有许多基本计算模块和 Encoder 是相同的，因此不重复介绍相同的部分。

## Encoder

标准 Transformer 的 Encoder 由 6 个完全相同的 Encoder Block 堆叠而成，每一层的输入是上一层的输出。
每个 Block 包含两个 SubLayer：Multi-Head Attention (MHA) 和 Feed-Forward Network (FFN)。
每个子层都采用 Residual Connection，然后接 LayerNorm。
此外，在训练阶段，每个 SubLayer 的输出在进入残差连接之前会先经过 Dropout。

由于两个子层结构相同，都是“Dropout、残差、LayerNorm”的组合，只是内部函数 $F$ 不同。因此可以先将子层抽象为一个通用形式：

$$
\text{SubLayer}_F(x) = \text{LN}(\text{Dropout}(F(x)) + x)
$$

其中 $F$ 分别为 MHA 和 FFN，那么整个 Encoder Block 的计算过程可以表示为两个子层的复合：

$$
\text{EncoderBlock} = \text{SubLayer}_{\text{FFN}} \circ \text{SubLayer}_{\text{MHA}}
$$

接下来将展开讲解各个子层的计算细节。

### MHA

MHA 可以说是整个 Transformer 的核心，其特点在 Self-Attention 和 Multi-Head 两部分。

#### Self-Attention

Self-Attention 指的是一组 Query、Key 和 Value 都通过同一个输入 $x$ 计算获得。
具体而言，同一个输入 $x$ 通过矩阵 $W_q$、$W_k$、$W_v$ 分别进行线性变换，从而得到 $q$、$k$、$v$：

$$
q = x W_q, \quad k = x W_k, \quad v = x W_v
$$

由于序列中的每个 $x$ 相互独立，我们可以将输入序列拼接成矩阵 $X \in \mathbb{R}^{n \times d_{\text{model}}}$，其中 $n$ 为序列长度。
通过 GPU 直接对矩阵 $X$ 进行运算，从而大幅提高计算效率：

$$
Q = X W_q, \quad K = X W_k, \quad V = X W_v
$$

在上述矩阵运算中的权重矩阵 $W_q$、$W_k$、$W_v$ 与之前对单个 $x$ 进行计算时的参数是一样的。

得到 Query、Key、Value 后，我们就可以计算注意力分数和最终的注意力加权和了。
自注意力的意义在于捕捉序列内不同位置之间的依赖关系，因此我们跳过对单个输入的讨论，直接从矩阵形式开始说明 Transformer 如何使用点积计算注意力分数：

$$
A(Q, K) = \text{softmax}\left(\frac{Q K^T}{\sqrt{d_k}}\right)
$$

其中 $d_k$ 是 $Q$ 和 $K$ 的特征维度，由于二者要进行点积运算，二者的特征维度必须相同。

使用 $\text{softmax}$ 是为了把注意力分数转化为一组非负且和为 1 的权重，使得注意力输出是 Value 的加权平均，从而符合“注意力”的语义。

公式中还除以了 $\sqrt{d_k}$，这一项是由于点积运算会导致结果的方差变为原来的 $d_k$ 倍，
所以这里除以标准差 $\sqrt{d_k}$ 可以抵消 $d_k$ 对点积结果量级的影响，让 logits 的数值范围保持稳定。
这么做可以避免 $\text{softmax}$ 进入饱和区，让模型的训练更稳定。

得到注意力分数后，就可以和 Value 矩阵 $V$ 进行相乘了。

$$
Attention(Q, K, V) = A(Q, K)V = \text{softmax}\left(\frac{Q K^T}{\sqrt{d_k}}\right)V
$$

最终我们得到的就是经过注意力分数加权计算的注意力加权和。

#### Multi-Head

“多头”指的是在计算 $Q$、$K$、$V$ 矩阵时，使用多组独立的 $W_q$、$W_k$、$W_v$ 矩阵对输入进行计算，每一组就是一个头，其基本思想是希望每个头负责提取不同类型的特征。

$$
Q_i = X W_q^{(i)}, \quad K_i = X W_k^{(i)}, \quad V_i = X W_v^{(i)}
$$

其中 $i$ 表示头的序号，输入 $X$ 的特征维度为 $d_{\text{model}}$，有 $h$ 个头，$Q_i$ 和 $K_i$ 的特征维度为 $d_k$，$V_i$ 的特征维度是 $d_v$。
三个投影矩阵 $W_q^{(i)} \in \mathbb{R}^{d_{\text{model}} \times d_k}$，$W_k^{(i)} \in \mathbb{R}^{d_{\text{model}} \times d_k}$，$W_v^{(i)} \in \mathbb{R}^{d_{\text{model}} \times d_v}$。

原始论文设 $d_k = d_{\text{model}} / h$，这样 $h$ 组 $Q_i$、$K_i$ 沿特征维度拼接后就得到特征维度为 $d_{\text{model}}$ 的矩阵。
这么做的目的其实是为了保证对于取不同 $h$ 的模型，其参数量、计算量都基本一致，这样在消融实验中可以更好地突出头数量 $h$ 本身的作用。

每个头独立地做一次自注意力计算，得到各自的输出：

$$
\text{head}_i = \text{softmax}\left(\frac{Q_i K_i^T}{\sqrt{d_k}}\right) V_i
$$

然后将所有头的输出沿特征维度拼接，并通过线性层 $W_o$ 映射回 $d_{\text{model}}$：

$$
\text{MHA}(X) = \text{Concat}(\text{head}_1, \dots, \text{head}_h) W_o
$$

其中每个 $\text{head}_i$ 的特征维度为 $d_v$，拼接后特征维度为 $h \cdot d_v$，$W_o \in \mathbb{R}^{(h \cdot d_v) \times d_{\text{model}}}$，保证输出与后续残差连接的维度一致。这里的 $W_o$ 在原始论文中是存在的，即便在单头情况下也保留。

原始论文设 $d_v = d_{\text{model}} / h = d_k$，这主要是出于和 $d_k$ 一样的原因，不过这不是强制的，因为最后一层的线性变换依然可以保证输出为 $d_{\text{model}}$。

### FFN

![ModalNet-23.png](https://s3.bmp.ovh/2026/09/14/aZdYW61H.png)

FFN 本质就是一个双层 MLP，它对序列中每个位置独立地应用同一个网络，因此不进行跨位置的信息混合。
由于这种 FFN 在每次前向传播中会激活全部参数，因此后来也被称为 Dense FFN，与之相对的是后来提出的 MoE 架构。
关于 MoE 我会在以后的文章讨论，这里就不展开了。

此处直接给出 FFN 层的计算公式：

$$
\text{FFN}(X) = \text{ReLU}(X W_{1} + b_1) W_{2} + b_2
$$

其中 $W_1 \in \mathbb{R}^{d_{\text{model}} \times d_{ff}}$，$W_2 \in \mathbb{R}^{d_{ff} \times d_{\text{model}}}$，
原始论文中取 $d_{ff} = 4 d_{\text{model}}$，即先升维再降维。

## Decoder

Decoder 和 Encoder 类似，也是由多个 Block 堆叠组成。一个 DecoderBlock 含有三个子层：Masked Multi-Head Attention、Cross Attention、FFN，每个子层同样采用残差连接、Dropout 和 LayerNorm。

DecoderBlock 本质上仍然是由 MHA 和 FFN 组成，其中 FFN 与 Encoder 完全一致。 沿用 Encoder 中的 SubLayer 抽象，DecoderBlock 可以表示为三个子层的复合：

$$
\text{DecoderBlock} = \text{SubLayer}_{\text{FFN}} \circ \text{SubLayer}_{\text{CrossAttention}} \circ \text{SubLayer}_{\text{MaskedAttention}}
$$

Transformer 总共堆叠了 6 个 DecoderBlock。

关键区别在于 Decoder 的 MHA 具有两个特点：Masked Attention 和 Cross Attention。

### Masked Attention

在训练阶段，我们通常采用 teacher forcing，也就是一次性把整个目标序列喂给 Decoder，让它预测每个位置的下一个 token。
此时位置 $t$ 的 Query 会与所有位置的 Key 计算注意力分数，包括 $t+1, t+2, \dots$ 这些未来位置。
如果不加处理，模型就能直接“看到”未来的 token，从而失去自回归生成的能力，训练和推理也会不一致。

为了避免这种情况，需要在计算注意力分数后，将未来位置的分数设为一个极大的负数，通常是 $-\infty$，这样经过 softmax 后这些位置的权重就变为 0。

![mask.png](https://s3.bmp.ovh/2026/09/15/sCq3sL7m.png)

设注意力分数矩阵为 $A = Q K^T / \sqrt{d_k} \in \mathbb{R}^{n \times n}$。定义掩码矩阵 $M \in \mathbb{R}^{n \times n}$：

$$
M_{ij} = \begin{cases} 0 & j \le i \\ -\infty & j > i \end{cases}
$$

则 Masked Attention 可以表示为：

$$
\text{MaskedAttention}(Q, K, V) = \text{softmax}(A + M) V
$$

### Cross Attention

前面我们在 Self-Attention 中默认三个输入都来自同一个 $X$。
事实上，注意力机制并不要求三者同源，只要经过投影后的 $Q$ 和 $K$ 维度一致即可。
因此可以把 MHA 推广为接受三个输入的形式：

$$
\text{MHA}(X_q, X_k, X_v) = \text{Concat}(\text{head}_1, \dots, \text{head}_h) W_o
$$

其中每个头的输出为：

$$
\text{head}_i = \text{softmax}\left(\frac{(X_q W_q^{(i)})(X_k W_k^{(i)})^T}{\sqrt{d_k}}\right) (X_v W_v^{(i)})
$$

于是 Self-Attention 就是 $\text{MHA}(X, X, X)$ 的特例。

Cross Attention 则把三个输入拆开：$Q$ 来自 Decoder 当前状态 $Y$，$K$ 和 $V$ 来自 Encoder 输出 $H$，即：

$$
\text{CrossAttention}(Y, H) = \text{MHA}(Y, H, H)
$$

展开后：

$$
\text{head}_i = \text{softmax}\left(\frac{(Y W_q^{(i)})(H W_k^{(i)})^T}{\sqrt{d_k}}\right) (H W_v^{(i)})
$$

其中 $W_q^{(i)} \in \mathbb{R}^{d_{\text{model}} \times d_k}$，$W_k^{(i)} \in \mathbb{R}^{d_{\text{model}} \times d_k}$，$W_v^{(i)} \in \mathbb{R}^{d_{\text{model}} \times d_v}$。

Decoder 在生成每个 token 时，需要参考完整的输入序列。Query 来自 Decoder，表示“当前要生成什么”；Key 和 Value 来自 Encoder，表示“输入提供了哪些信息”。

计算上，Cross Attention 与普通 MHA 完全一致，唯一的区别就是 $Q$ 和 $K$、$V$ 的来源不同。

## 线性分类头

Decoder 最后一层的输出经过一个线性层和 softmax，就得到了下一个 token 的概率分布：

$$
p = \text{softmax}(Z W_{\text{out}})
$$

其中 $Z \in \mathbb{R}^{n \times d_{\text{model}}}$ 是最后一层 DecoderBlock 的输出；
$W_{\text{out}} \in \mathbb{R}^{d_{\text{model}} \times V}$，$V$ 是词表大小；
$p \in \mathbb{R}^{n \times V}$，每一行对应一个位置上所有 token 的概率分布。

训练时，取 $p$ 中对应目标 token 的概率计算交叉熵损失。
推理时，原始论文使用 beam search，beam size 取 4，即同时保留概率最高的 4 条候选序列，最终选择整体概率最高的一条作为输出。

通过公式不难发现，在词表 $V$ 非常大时，$W_{\text{out}}$ 的参数量会十分庞大，而这个问题其实是有办法缓解的。

第一种方式是通过加一层线性变换，先将 Decoder 最后一层的输出特征维度压缩，得到一个更小的向量，然后再进行最终的线性变换。这种方式的优点是实现简单，不过压缩会带来一定的性能损失，实际应用中较少使用。

另一种方式是使用 weight tying，即权重绑定，即让 $W_{\text{out}}$ 与输入的 embedding 层的权重矩阵共享参数：$W_{\text{out}} = E^T$，其中 $E \in \mathbb{R}^{V \times d_{\text{model}}}$ 是 embedding 矩阵。
这样可以省去对线性分类头参数的独立学习，减少模型参数量。这种方式对模型性能几乎没有影响，在输入输出词表一致的任务中已成为标准做法。

## 位置编码

最后我们讲一下位置编码。

由于 Transformer 的自注意力机制本身对序列中 token 的顺序是不敏感的，即打乱输入序列的顺序，计算结果也不会改变。因此，我们需要额外为每个 token 注入位置信息。原始论文采用了一种基于正弦和余弦函数的固定位置编码：

$$
PE_{(pos, 2i)} = \sin\left(\frac{pos}{10000^{2i / d_{\text{model}}}}\right)
$$

$$
PE_{(pos, 2i+1)} = \cos\left(\frac{pos}{10000^{2i / d_{\text{model}}}}\right)
$$

其中 $pos$ 是 token 在序列中的位置，从 0 开始计数；$i$ 是维度索引，取值范围为 $i \in \{0, 1, \dots, d_{\text{model}}/2 - 1\}$，$2i$ 和 $2i+1$ 分别对应偶数维度和奇数维度；$d_{\text{model}}$ 是词嵌入维度。最终，我们将位置编码直接与输入嵌入相加，作为 Encoder 和 Decoder 的输入。

这种编码方式的一个重要性质是：它使得模型能够更容易地捕捉相对位置信息。考虑两个位置 $t$ 和 $t + \Delta t$，它们在某个维度上的编码可以看作一个二维向量 $(\sin(w_i t), \cos(w_i t))$ 和 $(\sin(w_i (t + \Delta t)), \cos(w_i (t + \Delta t)))$，其中 $w_i = 10000^{-2i / d_{\text{model}}}$。对这两个向量做点积：

$$
(\sin(w_i t), \cos(w_i t)) \cdot (\sin(w_i (t + \Delta t)), \cos(w_i (t + \Delta t)))
$$

$$
= \sin(w_i t)\sin(w_i (t + \Delta t)) + \cos(w_i t)\cos(w_i (t + \Delta t))
$$

$$
= \cos(w_i \Delta t)
$$

可以看到，点积的结果只与相对位置 $\Delta t$ 有关，而与绝对位置 $t$ 无关。这意味着模型可以通过这种编码自然地学习到“两个 token 之间相隔多远”这样的相对位置关系，这对于自然语言处理是非常重要的。

![position encoding.png](https://s3.bmp.ovh/2026/09/14/h0yOLxJn.png)

# 结语

本文以 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 这篇文章作为核心，讨论了 Transformer 中各个位置的计算细节，尽量用准确的数学语言描述了模型的算法。

除了数学表示，本文还希望通过代码让读者对计算过程有更加直观的理解，这部分暂时还在写作当中，尽情期待。

此外，本文还在文中提到了如 Dense FFN 和 MoE 等概念，这些是我在后续的文章中希望进一步介绍的，希望本文对你理解 Transformer 有所帮助。

# 参考资料

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Dive into Deep Learning](https://d2l.ai/)
- [RethinkFun 深度学习](https://www.rethink.fun/)