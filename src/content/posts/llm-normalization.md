---
title: 一文搞懂归一化技术
date: 2026-09-27
description: 本文梳理大模型里的归一化技术：为什么需要它、BN 为何不适合序列模型，以及 LayerNorm、RMSNorm、Pre-Norm/Post-Norm 等方案的取舍。
tags: [LLM, RMSNorm]
category: LLM
episode: 2
draft: false
lang: zh_CN
---

# 前言

本文要讨论的是归一化（Normalization）。它是让深层网络能够稳定训练的基础技术之一，也是现代 LLM 中每个 Transformer Block 都不可或缺的组件。我们将从它要解决的问题出发，逐步梳理从 BatchNorm 到 LayerNorm、再到 RMSNorm 的演进脉络，最后讨论归一化在 Transformer 中的摆放位置，以及注意力内部的 QK-Norm。

# 为什么需要归一化

## 深层网络的训练难题

在深度神经网络中，每一层的输出都会成为下一层的输入。当网络只有几层时，各层激活值的尺度差异还可以接受；但随着层数加深，激活值的尺度会随层数逐层放大或收缩。如果某一层让信号平均放大一点，几十层之后这个效应就会指数累积，最终导致激活值爆炸；反过来，信号也可能逐层衰减直至消失。梯度反向传播时面临同样的问题，这就是经典的梯度爆炸与梯度消失。

早期的解释来自 [Batch Normalization](https://arxiv.org/abs/1502.03167) 原论文提出的“内部协变量偏移（Internal Covariate Shift）”：由于前面层的参数在训练中不断更新，后面每一层看到的输入分布也随之持续变化，因此每一层都必须不断适应一个“移动的输入分布”，导致训练困难。

不过，后续工作 [How Does Batch Normalization Help Optimization?](https://arxiv.org/abs/1805.11604) 通过实验证明这个解释并不成立：即使人为向归一化后的激活注入噪声、加剧分布偏移，带归一化的网络依然训练得更快更稳。目前更被广泛接受的解释是，归一化让损失曲面变得更加平滑，参数更新方向更稳定，从而允许使用更大的学习率。至于“归一化为什么有效”这个问题本身，到今天仍没有完全统一的结论，但这并不妨碍它成为深度学习中最重要的工程手段之一。

## 归一化与残差流

在 Transformer 中，问题还有一个更具体的来源：残差连接。对于输入 $\mathbf{x}$ 与某个子层 $F$（Attention 或 FFN），残差连接的计算为：

$$
\mathbf{x} \leftarrow \mathbf{x} + F(\mathbf{x}).
$$

这意味着每一层的输出都会在原有表示上不断累加。如果各子层输出的尺度不受控制，那么残差流（residual stream）的方差会随着层数近似线性地增长。一个简单的实验就能观察到这个现象：

```python
x = torch.randn(8, 128, 512)               # [N, L, C]
stds = [x.std().item()]
for _ in range(64):
    x = x + torch.randn(8, 128, 512) * 0.1   # 模拟各子层的输出
    stds.append(x.std().item())
# stds 大致随 sqrt(层数) 增长，64 层后尺度已明显漂移
```

归一化的作用，就是在每个子层读取残差流之前，把输入重新拉回一个固定的尺度，使各层看到的输入分布保持一致：

![residual-stream](/img/posts/llm-normalization/residual-stream.svg)

这个“在残差流上进行尺度校正”的视角，是后面理解 Pre-Norm 与 Post-Norm 差异的基础。

# 归一化是什么

## 统一形式

尽管归一化方法种类繁多，但它们都可以写成同一个形式。对输入元素 $x$，先减去均值、再除以标准差，最后做一层可学习的仿射变换：

$$
y
=
\frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}}
\odot \gamma
+
\beta,
$$

其中 $\mu$ 与 $\sigma^2$ 是统计得到的均值与方差，$\gamma$ 与 $\beta$ 是可学习参数。整个计算可以拆成三件事：

1. **去中心化**：减去 $\mu$，把分布中心移到原点；
2. **缩放**：除以标准差，把尺度统一为 1；
3. **仿射**：乘以 $\gamma$、加上 $\beta$，把被“过度约束”的分布恢复出表达能力——如果恒等变换是最优解，网络可以学到 $\gamma = \sigma$、$\beta = \mu$。

公式中的 $\epsilon$ 是一个很小的正数（通常为 $10^{-5}$ 或 $10^{-6}$），放在根号内防止方差为零时出现除零。另外，在 bf16/fp16 训练中，$\mu$、$\sigma^2$ 这类统计量通常会在 fp32 精度下累加，再转回原精度参与逐元素运算，以降低舍入误差。

## 统计的维度

那么，各种归一化方法的区别在哪里？其实只有一点：

> **$\mu$ 和 $\sigma^2$ 沿哪些维度统计。**

设输入张量为 $X \in \mathbb{R}^{N \times L \times C}$，其中 $N$ 是 batch 大小，$L$ 是序列长度，$C$ 是特征维度。几种经典方法的区别可以列成一张表：

| 方法 | 统计维度 | 含义 |
| --- | --- | --- |
| BatchNorm | $(N, L)$ | 同一通道跨 batch、跨位置共享统计量 |
| LayerNorm | $C$ | 单个 token 的全部特征做统计 |
| InstanceNorm | $L$ | 单个样本的单个通道做统计 |
| GroupNorm | $(L, C/G)$ | 单个样本内的一组通道做统计 |

画成图会更直观——同样一个 $(N, L, C)$ 张量，四种方法覆盖的区域各不相同：

![norm-dims](/img/posts/llm-normalization/norm-dims.svg)

可以看到，它们的公式完全一致，只是统计量的“覆盖范围”不同。接下来我们分别看看这些方法在 LLM 场景下的取舍。

# BatchNorm

BatchNorm 沿 batch 维做统计：对第 $c$ 个通道，统计量为

$$
\mu_c
=
\frac{1}{NL}
\sum_{n,l} x_{n,l,c},
\quad
\sigma_c^2
=
\frac{1}{NL}
\sum_{n,l} (x_{n,l,c} - \mu_c)^2.
$$

也就是说，同一个通道上的所有 token、所有样本共享同一组 $\mu_c$ 与 $\sigma_c^2$。此外，BatchNorm 在训练和推理时的行为并不一致：训练时用当前 batch 的统计量，推理时则切换为训练过程中滑动平均得到的 running mean/var。这一设计在 CNN 时代非常成功，但它也带来了后来的一系列问题。

## BatchNorm 的局限性

将 BatchNorm 搬到 LLM 上，会遇到几个绕不开的问题：

1. **统计量被 padding 污染**。语言模型的序列长度不一，batch 内需要 padding 对齐，而 padding 位置的值会进入 $\mu_c$、$\sigma_c^2$ 的统计，使统计量随 batch 的 padding 比例漂移；
2. **小 batch 下统计噪声大**。统计量依赖整个 batch，batch 越小噪声越大，而大模型训练的 per-device batch 往往很小；
3. **训练与推理不一致**。推理依赖 running mean/var，但语言模型面对的输入长度、领域分布差异极大，固定的 running 统计量很难代表推理时的真实分布；
4. **自回归解码没有 batch 统计可言**。逐 token 生成时，每一步只有一个新 token，“沿 batch 统计”这个前提本身就不成立；
5. **分布式训练需要跨卡同步统计量**，带来额外的通信开销。

## 代码实现

先实现一个标准的 BatchNorm（对 `[N, L, C]` 的输入沿 `(N, L)` 统计），并复现 running mean/var 的更新逻辑：

```python
class BatchNorm(nn.Module):
    def __init__(self, num_features: int, eps: float = 1e-5, momentum: float = 0.1) -> None:
        super().__init__()
        self.eps = eps
        self.momentum = momentum
        self.weight = nn.Parameter(torch.ones(num_features))
        self.bias = nn.Parameter(torch.zeros(num_features))
        self.register_buffer("running_mean", torch.zeros(num_features))
        self.register_buffer("running_var", torch.ones(num_features))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [N, L, C]
        if self.training:
            mean = x.mean(dim=(0, 1))                    # [C]
            var = x.var(dim=(0, 1), unbiased=False)      # [C]
            with torch.no_grad():
                self.running_mean.mul_(1 - self.momentum).add_(self.momentum * mean)
                # PyTorch 惯例：running_var 用无偏估计
                self.running_var.mul_(1 - self.momentum).add_(
                    self.momentum * x.var(dim=(0, 1), unbiased=True)
                )
        else:
            mean, var = self.running_mean, self.running_var
        return (x - mean) / torch.sqrt(var + self.eps) * self.weight + self.bias
```

注意两处方差的口径不一样。归一化当前 batch 用**有偏方差**，分母是 $NL$，这样归一化后的方差恰好约为 1；如果错用无偏估计，分母变成 $NL - 1$，归一化后方差就只剩 $\frac{NL - 1}{NL}$。更新 `running_var` 时则反过来用**无偏方差**：它是推理阶段对总体方差的长期估计，样本量小时有偏估计会系统性偏低，这也是 PyTorch `BatchNorm` 的做法。另外 $NL = 1$ 时无偏估计会除零，得到 NaN。

而 padding 污染的问题可以直接观察到：给序列补零之后，统计量会明显偏移。

```python
x = torch.randn(4, 16, 8) + 2      # [N, L, C]
x_padded = torch.cat([x, torch.zeros(4, 16, 8)], dim=1)  # [N, 2L, C]，补长一倍

x.mean(dim=(0, 1))          # ≈ 2
x_padded.mean(dim=(0, 1))   # ≈ 1，均值被拉走，方差也从 ≈1 变成 ≈1.5
```

batch 内容一变，统计量就变。归根结底，BatchNorm 的统计依赖于 batch 与序列维度，而语言模型的 batch 构成和序列长度都在不断变化——Transformer 需要一种**只依赖单个 token 自身特征**的归一化方法，这正是 LayerNorm。

# LayerNorm

[Layer Normalization](https://arxiv.org/abs/1607.06450) 的思路非常直接：对每个 token 的隐藏状态 $\mathbf{x} \in \mathbb{R}^{d_{\text{model}}}$ 做统计：

$$
\mu
=
\frac{1}{d_{\text{model}}}
\sum_{i=1}^{d_{\text{model}}} x_i,
\quad
\sigma^2
=
\frac{1}{d_{\text{model}}}
\sum_{i=1}^{d_{\text{model}}} (x_i - \mu)^2,
$$

$$
\text{LN}(\mathbf{x})
=
\frac{\mathbf{x} - \mu}{\sqrt{\sigma^2 + \epsilon}}
\odot \gamma
+
\beta.
$$

统计量只来自当前 token 的特征维度，与 batch 大小、序列长度、序列位置都无关。这让它天然适配语言模型：训练和推理行为一致，单 token 解码时行为也不变，padding 更不会影响其他 token 的统计量。

## 性质

LayerNorm 有几个值得注意的数学性质：

* **平移不变性**：$\text{LN}(\mathbf{x} + c\mathbf{1}) = \text{LN}(\mathbf{x})$，所有分量同时加上常数，归一化结果不变；
* **缩放不变性**：$\text{LN}(\alpha\mathbf{x}) = \text{LN}(\mathbf{x})$（$\alpha > 0$），输入整体缩放不改变归一化结果。

这也意味着 LayerNorm 会“抹掉”输入的平移与缩放信息，而被抹掉的部分由可学习的 $\gamma$、$\beta$ 补回。从反向传播的角度看，由于均值与方差同样参与计算，LN 的梯度中会出现“减去均值方向的梯度分量”这一项，这使得它同时约束了梯度的尺度，是其稳定训练的原因之一。

代价方面，LayerNorm 需要先统计均值和方差，再做逐元素归一化，属于典型的访存受限（memory-bound）算子：计算量不大，但要完整读写几遍激活值。在 LLM 中归一化层极多，这部分开销累积起来也不可忽视——这也是后来 RMSNorm 出现的一个动机。

## 代码实现

```python
class LayerNorm(nn.Module):
    def __init__(self, d_model: int, eps: float = 1e-5) -> None:
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(d_model))
        self.bias = nn.Parameter(torch.zeros(d_model))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [N, L, C]
        mean = x.mean(dim=-1, keepdim=True)                       # [N, L, 1]
        var = x.var(dim=-1, unbiased=False, keepdim=True)         # [N, L, 1]
        return (x - mean) / torch.sqrt(var + self.eps) * self.weight + self.bias
```

与 `nn.LayerNorm` 数值对拍（默认参数、零初始化 bias，输出应在浮点误差内一致）：

```python
x = torch.randn(4, 16, 768)  # [N, L, C]
assert torch.allclose(LayerNorm(768)(x), nn.LayerNorm(768)(x), atol=1e-6)
```

# RMSNorm

LayerNorm 把统计范围缩到了单个 token，但它仍然包含去中心化和仿射偏移两部分。一个自然的问题是：

> **LayerNorm 里哪些成分真正起作用？**

[RMSNorm](https://arxiv.org/abs/1910.07467) 的作者给出的假设是：LayerNorm 的收益主要来自 **re-scaling 不变性**（除以标准差），re-centering（减均值）则是可有可无的；[Understanding and Improving Layer Normalization](https://arxiv.org/abs/1911.07013) 的消融实验也表明，可学习的 $\gamma$、$\beta$ 在多数任务中并不带来收益。RMSNorm 据此把均值与 $\beta$ 一起去掉，只保留均方根缩放：

$$
\text{RMSNorm}(\mathbf{x})
=
\frac{\mathbf{x}}{\sqrt{\frac{1}{d_{\text{model}}}\sum_{i=1}^{d_{\text{model}}} x_i^2 + \epsilon}}
\odot \gamma.
$$

少算一个统计量、少一组参数，换来的却是与 LayerNorm 基本持平的训练效果。因此自 [LLaMA](https://arxiv.org/abs/2302.13971) 起，RMSNorm 逐渐成为现代 LLM 的默认选择。

## 工程细节

实现层面有几个值得注意的点：

* **统计量在 fp32 下计算**。bf16 激活先 upcast 到 fp32 求均方根，再转回原精度做逐元素乘法，避免累加误差；
* **用 `rsqrt` 而不是 `sqrt` + 除法**。`rsqrt` 在硬件上通常是单条指令，速度更快、数值上也更稳；
* **fused kernel**。PyTorch 的 `nn.RMSNorm`，以及 Liger Kernel、FlashInfer 等推理框架中的实现，都是把“统计 + 缩放 + 乘权重”融合成一个 kernel，减少访存次数；
* **Gemma 的小差别**。Gemma 系列的 RMSNorm 权重形式是 $(1 + w)$ 而不是 $w$，参数初始化为 0 而不是 1。数学上等价，但读代码时容易困惑，值得留意。

## 代码实现

```python
class RMSNorm(nn.Module):
    def __init__(self, d_model: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(d_model))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [N, L, C]
        dtype = x.dtype
        x = x.float()                                        # 统计量用 fp32
        x = x * torch.rsqrt(x.pow(2).mean(dim=-1, keepdim=True) + self.eps)  # [N,L,C] × [N,L,1]
        return self.weight * x.to(dtype)                     # 转回原精度再乘权重（LLaMA 顺序）
```

与 `nn.RMSNorm` 对拍时注意把 `eps` 显式对齐（两者的默认值不同）：

```python
x = torch.randn(4, 16, 768)  # [N, L, C]
assert torch.allclose(
    RMSNorm(768, eps=1e-6)(x),
    nn.RMSNorm(768, eps=1e-6)(x),
    atol=1e-6,
)
```

至于“RMSNorm 到底快多少”，可以直接写个基准对比：同样 `[T, d]` 的输入，分别跑 `nn.LayerNorm` 与 `nn.RMSNorm` 各千次取平均。由于两者都是访存受限算子，实际收益主要来自少维护一组 $\beta$ 参数、少一次均值规约，量级通常在百分之几到十几，远不如 fused kernel 与 fp32 统计带来的差异显著——这一点值得用实测数字说话，而不是想当然。

# 归一化放在哪

前面讨论的都是归一化“怎么算”，还有一个同样重要的问题是归一化“放在哪”。

## Post-Norm

原始 Transformer 采用的是 Post-Norm，即先残差相加、再归一化：

$$
\mathbf{x} \leftarrow \text{Norm}(\mathbf{x} + F(\mathbf{x})).
$$

Post-Norm 的每一层输出都被强制拉回固定尺度，表达能力较强；但代价是残差路径上每一层都要穿过一次归一化。[On Layer Normalization in the Transformer Architecture](https://arxiv.org/abs/2002.04745) 的分析表明，Post-Norm 在训练初期靠近输出层的梯度会异常放大，因此深层时必须配合 warmup 才能稳定收敛。

## Pre-Norm

现代 LLM 几乎全部使用 Pre-Norm，即先归一化、再进入子层、最后残差相加：

$$
\mathbf{x} \leftarrow \mathbf{x} + F(\text{Norm}(\mathbf{x})).
$$

这样残差流本身就是一条没有归一化打断的“高速公路”，梯度可以直达每一层，训练非常稳定，对 warmup 也不敏感。代价则来自前面提到的方差累加：残差流的尺度随层数不断增长，深层子层的输出相对残差流越来越小，相当于深层模块的贡献被稀释。此外还有一个容易遗漏的细节：因为残差流上不再有归一化，所以模型最后通常还需要一个 **final norm**，在 `lm_head` 之前把输出拉回固定尺度。

两种接线方式的对比一目了然：

![pre-post-norm](/img/posts/llm-normalization/pre-post-norm.svg)

## 折中方案

Post-Norm 与 Pre-Norm 各有代价，因此也出现了一些折中设计：

* **DeepNorm**：[DeepNet](https://arxiv.org/abs/2203.00555) 在 Post-Norm 的残差通路上给 $\mathbf{x}$ 乘一个常数 $\alpha$，即 $\mathbf{x} \leftarrow \text{LN}(\alpha\mathbf{x} + F(\mathbf{x}))$，并配套缩小初始化幅度，让 Post-Norm 结构也能稳定堆叠到上千层；
* **Sandwich Norm**：在子层前后各放一个归一化，同时约束输入与输出幅度，CogView 曾采用；Gemma 2 中每个子层前后各一个 RMSNorm 的设计也是同样的思路。

| 方案 | 稳定性 | 效果上限 | 实现复杂度 |
| --- | --- | --- | --- |
| Post-Norm | 差（依赖 warmup） | 高 | 低 |
| Pre-Norm | 好 | 略低（深层贡献被稀释） | 低 |
| DeepNorm / Sandwich | 好 | 兼顾二者 | 需调参或多一层 Norm |

## 代码实现

两种接线方式的差别只在 `forward` 里一行代码的顺序：

```python
class PostNormBlock(nn.Module):
    def __init__(self, d_model: int, sublayer: nn.Module) -> None:
        super().__init__()
        self.sublayer = sublayer
        self.norm = nn.RMSNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [N, L, C]
        return self.norm(x + self.sublayer(x))   # 残差之后归一化


class PreNormBlock(nn.Module):
    def __init__(self, d_model: int, sublayer: nn.Module) -> None:
        super().__init__()
        self.sublayer = sublayer
        self.norm = nn.RMSNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [N, L, C]
        return x + self.sublayer(self.norm(x))   # 归一化后进子层
```

如果想直观感受两者的差异，可以堆一个几十层的 mini Transformer，固定学习率、去掉 warmup 分别训练：Post-Norm 的 loss 通常在几十个 step 内就开始震荡甚至发散，而 Pre-Norm 能平滑下降——这个实验比任何公式都更能说明问题。

# QK-Norm

归一化不只作用于残差流，注意力内部也有需要校正尺度的地方。随着模型规模增大，attention logits 的数值会不断增长，导致 softmax 饱和、梯度退化，甚至在训练中后期引发 loss 尖刺。[ViT-22B](https://arxiv.org/abs/2302.05442) 在把视觉 Transformer 扩到 220 亿参数时首次系统报告了这个问题，并给出了直接的解决方案：对 Q、K 分别做归一化，再计算内积，即 QK-Norm。

设某个注意力头的查询与键为 $\mathbf{q}, \mathbf{k} \in \mathbb{R}^{d_{\text{head}}}$，做法是在 head_dim 上对二者分别归一化：

$$
\mathbf{q}'
=
\text{Norm}(\mathbf{q}),
\quad
\mathbf{k}'
=
\text{Norm}(\mathbf{k}),
\quad
\text{logit}
=
\frac{\mathbf{q}' \cdot \mathbf{k}'}{\sqrt{d_{\text{head}}}}.
$$

归一化后 Q、K 的模长被固定，logits 的范围随之可控：

![qk-norm](/img/posts/llm-normalization/qk-norm.svg)

有两个实现细节值得注意：

1. **归一化与 RoPE 的先后顺序**。实际模型（Gemma 2/3、Qwen3、OLMo 2 等）通常先对线性投影得到的 Q、K 做 RMSNorm，再应用 RoPE；
2. **Norm 的选择**。ViT-22B 用的是 LayerNorm，而 LLM 中普遍使用 RMSNorm，且 Q、K 各有一组独立的归一化参数。

这里出现的 RoPE 是作用在 Q、K 上的一种旋转式位置编码，也是下一篇文章的主角。暂时不熟悉它的读者，可以先把它看成一个给 Q、K 注入位置信息的操作；至于归一化为什么要放在 RoPE 之前而不是之后，则与 RoPE 的数学形式有关，答案留到下一篇揭晓。

## 代码实现

在 attention 中插入 qk norm 只需在投影之后、RoPE 之前加两行：

```python
self.q_norm = RMSNorm(head_dim)
self.k_norm = RMSNorm(head_dim)

def forward(self, x):
    # x: [B, L, d_model]
    q = self.q_norm(self.q_proj(x).view(B, L, H, D))  # [B,L,H·D] -> [B,L,H,D]
    k = self.k_norm(self.k_proj(x).view(B, L, H, D))  # [B,L,H,D]
    q = apply_rope(q, cos, sin)   # norm 在 RoPE 之前
    k = apply_rope(k, cos, sin)   # apply_rope 见 EP.3
    ...
```

# 结语

回到最初的问题，LLM 中的归一化可以概括为一句话：**只看单个 token 的缩放校正，放在残差分支之前**。代表性的现代方案是 Pre-RMSNorm 加最后的 final norm，注意力内部再辅以 QK-Norm 约束 logits 的尺度。

梳理下来，记住三个层次就够了：

1. **统计范围**：从 BatchNorm 的跨 batch 统计，收缩到 LayerNorm/RMSNorm 的单 token 统计，这是语言模型对归一化的根本要求；
2. **统计内容**：从均值加方差，简化到只保留均方根，依据是 re-scaling 不变性起主要作用；
3. **摆放位置**：从 Post-Norm 换到 Pre-Norm，用一点效果上限换来深层训练的稳定性。

下一篇文章我们将讨论 Transformer 的另一个基础组件：位置编码。

# 参考资料

- [Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift](https://arxiv.org/abs/1502.03167)
- [How Does Batch Normalization Help Optimization?](https://arxiv.org/abs/1805.11604)
- [Layer Normalization](https://arxiv.org/abs/1607.06450)
- [Understanding and Improving Layer Normalization](https://arxiv.org/abs/1911.07013)
- [Root Mean Square Layer Normalization](https://arxiv.org/abs/1910.07467)
- [On Layer Normalization in the Transformer Architecture](https://arxiv.org/abs/2002.04745)
- [DeepNet: Scaling Transformers to 1,000 Layers](https://arxiv.org/abs/2203.00555)
- [Scaling Vision Transformers to 22 Billion Parameters](https://arxiv.org/abs/2302.05442)
- [LLaMA: Open and Efficient Foundation Language Models](https://arxiv.org/abs/2302.13971)
