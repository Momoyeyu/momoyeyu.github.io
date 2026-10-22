---
title: How Strata Works
date: 2026-10-21
updated: 2026-10-22
description: 从稀疏激活、权重分层、CPU/GPU 并行与投机解码出发，结合源码和 Mac Studio 实例理解 Strata 的推理设计。
tags: [LLM, 推理, Strata]
category: AI Infra
episode: 9
draft: false
lang: zh_CN
---

# 前言

在 [GPU 性能评估](../ai-infra-gpu-metrics/)中，我们用容量判断模型能不能装下，用带宽估算 decode 速度。[Strata](https://github.com/Niko1221/Strata) 则把问题推进了一步：用 12 GB 显卡与 64 GB 系统内存运行 Qwen3.8-Flash-Next，权重远大于显存，仍然能有流畅的生成速度。

直觉上的办法是把装不下的权重放进内存，用到时再搬给 GPU。但 PCIe 比显存慢得多，为什么搬运没有拖垮速度？本文先跟着一个 token 走完一层计算，再看缓存与批量验证如何进一步提速。分析结合 Strata `011c9e60` 的源码与[项目论文](https://github.com/Niko1221/Strata/blob/011c9e60/docs/paper/Strata-Paper.pdf)，最后回到我的 Mac Studio 实例。

# 稀疏性的机会

理解 Strata，先抓住模型的一个特点：**参数很多，每一步真正用到的却很少。**

在 [MoE](../llm-moe/) 中，专家是不同的前馈网络 FFN，Router 根据当前 token 的表示选择其中几个，分别计算后加权汇总。Qwen3.8-Flash-Next 有 48 层，每层 512 个路由专家，每 token 选 10 个，另有一个始终参与计算的共享专家。

因此，模型虽然有 $48\times512=24576$ 个路由专家，一次 token 前向只调用其中的 $48\times10=480$ 个。按等大小专家估算，激活比例只有 $10/512\approx1.95\%$。以论文中的 Q2_0 为例，34 GB 的专家库，每 token 约读取 $34\times10/512\approx0.66$ GB。装下整个专家库需要大容量，服务这一个 token 却只需读其中一小部分。

模型的其他部分也有各自的访问方式：

| 部分 | 每一步如何使用 | 给推理系统的机会 |
| --- | --- | --- |
| 路由专家 | 每层选 10 个，其余不参与 | 按需计算，缓存热点 |
| 共享专家、投影、Router 与输出头等 | 每一步都要运行 | 放在快速存储中常驻 |
| 混合注意力 | 36 层维护固定递归状态，12 层从历史中选择微块 | 控制状态大小与历史读取量 |
| n-gram embedding | 根据最近的 token id 查询少量行 | 大表按行读取，无需整体上传 GPU |

这里的混合注意力由 Gated DeltaNet 与 Qwen Sparse Attention 组成。前者保存一个随 token 更新的递归状态；后者保留历史 K/V，通过 indexer 选择微块，本次注意力的选择预算是 512 个块、2048 个 token。n-gram 表更直观：[`ngram.hpp`](https://github.com/Niko1221/Strata/blob/011c9e60/include/strata/kernels/ngram.hpp)中每 token 查询 16 行，IQ4_NL 格式每行 90 字节，有效数据共 1440 字节，磁盘读取还会产生页与对齐开销。

[官方模型卡](https://huggingface.co/Qwen/Qwen3.8-Flash-Next)将主体标为 125B、每 token 激活 6B，另外列出 51B n-gram embedding 和 4B 多 token 预测模块 MTP。相比把这些参数直接相加，上面这张访问表更能解释系统该怎样运行它。

# 一层推理

## 权重位置

先看一台独立显卡 PC：GPU 连接小而快的显存，CPU 连接容量更大的 RAM，两者通过 PCIe 交换数据。

Strata 把每步都用的共享部分留在显存，再为注意力历史、运行缓冲区和 MTP 草稿模块留出空间，剩余显存用作路由专家缓存。正常模式下，RAM 保存完整专家库，显存只保留一部分热点副本；n-gram 表则留在 SSD，按需读行。

图中需要特别注意 RAM 的两条出口：专家既可以搬到 GPU 计算，也可以直接在 CPU 上计算。

![Strata 在独立显卡 PC 上的权重分层与数据流](/img/posts/ai-infra-strata/memory-tiers.svg)

> **GPU 明明更快，为什么还要让 CPU 参与计算？**

## 搬权重与搬向量

一个专家接收 token 的表示向量，经过矩阵运算，再输出一个同维度向量。设输入为 $\mathbf{x}$，专家为 $E$，它做的事就是计算 $\mathbf{y}=E(\mathbf{x})$。GPU 算它需要权重在显存里；CPU 算它则可以直接读取 RAM 中的权重，只把结果交回 GPU。

用一组具体数字比较。设这个量化专家占 2 MiB，输入和输出各有 2560 个 FP32 元素，每个向量占 $2560\times4=10240$ 字节，也就是 10 KiB：

| 方案 | 跨 PCIe 传输的主要内容 | 数据量 |
| --- | --- | ---: |
| 搬给 GPU 算 | 专家的整份权重 | 2 MiB |
| 留给 CPU 算 | 输入向量与输出向量 | 20 KiB |

第二种方案的跨设备数据量约为第一种的百分之一。CPU 仍需从 RAM 读取那 2 MiB 权重并完成运算，但省去了整块权重跨 PCIe 的过程。于是，**GPU 算得更快，不代表加上搬运以后仍然更快**。

选择也不必是二选一。CPU 算不过来时，可以把部分专家交给 GPU；PCIe 忙时，则让 CPU 多算一些。Strata 会结合链路探测、CPU 量化 kernel 的速度和 GPU 工作量调整比例。

## 并行执行

现在跟着一个 token 进入某一层。GPU 先完成注意力与 Router，确定本层要计算的 10 个路由专家。假设其中 6 个已在显存，另外 4 个在 RAM，调度器可以让其中 2 个搬给 GPU，剩下 2 个由 CPU 原地计算。

接下来三件事同时推进：GPU 计算共享专家与那 6 个常驻专家，复制引擎搬运那 2 个未命中专家，CPU 计算余下 2 个。复制完成后，GPU 再算搬来的专家。最后各支结果按 Router 的权重汇总，进入下一层。

![Router 发布任务后，GPU、复制引擎与 CPU 的并行时间线](/img/posts/ai-infra-strata/layer-overlap.svg)

这就是为什么 CPU 原地计算与 GPU 搬运可以同时存在：它们分担同一层的慢路径工作。下一层要等本层结果齐全才能开始，最慢的分支决定了汇合时间。分配比例的目标，就是让各分支尽量接近，减少彼此等待。

## 专家缓存

上面的例子还有一个更直接的提速办法：让更多专家提前待在显存。

路由并不均匀，同一任务的后续 token 往往重复使用一部分专家。比如一段时间里反复调用 A，B 却始终没被选中，用 A 替换显存中的 B，就能把后续对 A 的调用从慢路径变成命中。

Strata 启动时根据已有 expert profile 填充缓存，运行中再统计当前对话的热度。PC 路径默认每 4 轮检查一次，最多替换 96 个专家，并在适应后把累计计数乘以 0.7，让旧热点逐渐退场、新热点获得位置。[`generate.cpp`](https://github.com/Niko1221/Strata/blob/011c9e60/src/program/generate.cpp)负责选择替换，[`expert_cache.cpp`](https://github.com/Niko1221/Strata/blob/011c9e60/src/core/expert_cache.cpp)管理缓存存储。

注意，服务本轮未命中的临时搬运，与决定后续哪些专家常驻，是两个独立动作。缓存解决的是接下来少走几次慢路径，前面的并行调度解决的是这次未命中怎样尽快完成。

## 代码实现

下面用一个简化成本模型，观察分配比例如何改变汇合时间。设本层有 24 MB 未命中权重，CPU 有效读取速度为 20 GB/s，PCIe 为 12 GB/s；GPU 计算常驻专家需 0.2 ms，计算全部未命中专家需 0.12 ms。这些是教学设定，模型把 CPU 与 PCIe 的有效带宽分开计算。

如果全部未命中都交给 CPU，它需要 $24\text{ MB}/20\text{ GB/s}=1.2$ ms。若全部搬给 GPU，则先传输 2 ms，再计算 0.12 ms。扫描两者之间的比例，就能找到更早汇合的位置：

```python
resident_gpu_ms = 0.20
miss_bytes = 24e6
cpu_bandwidth = 20e9
pcie_bandwidth = 12e9
all_misses_gpu_ms = 0.12

def branch_times(fraction):
    cpu_ms = miss_bytes * (1 - fraction) / cpu_bandwidth * 1000
    copy_ms = miss_bytes * fraction / pcie_bandwidth * 1000
    # GPU 先计算常驻专家，等复制就绪后再计算搬来的专家。
    gpu_finish_ms = max(resident_gpu_ms, copy_ms) + all_misses_gpu_ms * fraction
    return cpu_ms, gpu_finish_ms

candidates = []
for percent in range(101):
    fraction = percent / 100
    branches = branch_times(fraction)
    candidates.append((max(branches), fraction))

best_ms, best_fraction = min(candidates)
serial_ms = resident_gpu_ms + miss_bytes / cpu_bandwidth * 1000
print('先 GPU 后 CPU ms', round(serial_ms, 3))
print('并行且全部未命中交给 CPU ms', round(max(branch_times(0)), 3))
print('并行且全部未命中搬到 GPU ms', round(max(branch_times(1)), 3))
print('最佳搬运比例', best_fraction, '分支汇合 ms', round(best_ms, 3))
assert 0 < best_fraction < 1
assert best_ms < max(branch_times(0)) and best_ms < serial_ms
```

结果是将 36% 的未命中权重搬给 GPU：CPU 处理余下部分需 0.768 ms，复制与 GPU 分支需 0.7632 ms，两边几乎同时结束。相比全交给 CPU 的 1.2 ms 或全搬给 GPU 的 2.12 ms，分担工作更快。

<details>
<summary>源码怎样减少执行开销</summary>

为了让 CPU 尽早开始，GPU 会把输入和路由结果写入映射到主机的页锁定内存，再更新序号作为 doorbell。CPU 观察到序号变化就开始分配任务。CUDA Graph 则减少每层小步骤反复提交的开销。交接协议可从 [`layer.cpp`](https://github.com/Niko1221/Strata/blob/011c9e60/src/core/layer.cpp)阅读。

还有两类细节会影响速度。量化格式改变 CPU 的计算成本：规则整数适合 SIMD 点积，码本格式则多出查表与符号恢复。部分 CUDA、HIP 路径还会跳过验证窗口中始终排名靠后的未驻留专家；这直接改变求和结果，可用 `STRATA_ROUTE_TAIL_SKIP=0` 关闭。

</details>

# 权重复用

## 提示词处理

到这里，我们讨论的是怎样尽快服务一个 token。还有另一个方向：一次读取权重，多处理几个 token。

设四个 token 都被路由到同一个 2 MiB 专家。如果逐个处理、每次重新搬权重，总传输量是 8 MiB；若把四个输入向量排成一组，搬一次权重就能计算四个输出，总传输量变成 2 MiB，平均每 token 只分摊 512 KiB。计算仍需做四份，节省的是重复读取与搬运。

以专家中的一次线性投影为例，原来一次计算 $W\mathbf{x}$，现在把四个输入并成 $X=[\mathbf{x}_1,\mathbf{x}_2,\mathbf{x}_3,\mathbf{x}_4]$，计算 $WX$。同一份权重 $W$ 服务了四列输入。

Prefill 正适合这样处理，因为整段 prompt 已经给定。Strata 把 prompt 分块，再按专家收集 token，让同一个专家一次处理多个输入，同时重叠下一批专家的传输与当前计算。融合量化 kernel 把解量化与矩阵计算放在一起，进一步减少中间数据读写。

分块也会占用激活与流式缓冲空间，甚至需要临时借用专家缓存。因此 `--prefill auto` 要在权重复用收益与内存预算之间选取大小。

## 投机解码

> **生成阶段还不知道后面的 token，怎样也凑出一批输入？**

Strata 用较便宜的 MTP 模块先猜几个 token，称为草稿；也可以通过 prompt lookup，从上下文的重复片段中取出候选。完整的 48 层主模型再一次处理整个因果窗口，判断哪些草稿可以接受。

以每次选择概率最高 token 的 greedy 解码为例，假设草稿依次是「猫、在、跑」。主模型认可第一个「猫」，第二处却预测「正」。那么本轮就提交「猫、正」，丢弃「在、跑」，下一轮从已提交的前缀继续。如果所有草稿都匹配，还能多提交最后一行预测出的 token。

![投机解码中接受前缀、首次拒绝与状态提交的关系](/img/posts/ai-infra-strata/speculative-window.svg)

这里有两个关键点。第一，窗口是因果计算，每行只看到它前面的候选，和逐个生成时的前缀一致。第二，首次分歧后的计算基于错误前缀，必须丢弃；KV、DeltaNet 递归状态和卷积历史，也要回到有效前缀，才能正确继续。

它为什么快？主模型处理窗口时，共享权重可以供多行输入使用，路由到同一专家的候选也能成组计算。原来一次完整前向只确定一个新 token，现在可能确定多个。

设普通解码每 token 花费 $t_1$，草稿花费 $t_d$，窗口验证与提交花费 $t_v$，接受的草稿前缀长度为 $a$。每轮提交 $a+1$ 个 token，平均每 token 的时间与加速比为

$$
\bar t_{\mathrm{spec}}=\frac{t_d+t_v}{\mathbb{E}[a+1]},
\qquad
\text{加速比}=\frac{t_1\,\mathbb{E}[a+1]}{t_d+t_v}.
$$

比如普通解码每 token 10 ms，草稿与验证合计 16 ms，平均提交 3 个 token，那么每 token 约 5.3 ms，加速约 1.9 倍。若同样的 16 ms 只提交 1 个 token，反而更慢。

所以窗口长度不是越大越好：更多草稿可能增加提交量，也会增加计算、触及更多专家，并在首次拒绝后浪费剩余候选。Strata 的 [`draft_policy.hpp`](https://github.com/Niko1221/Strata/blob/011c9e60/include/strata/spec/draft_policy.hpp)按预期提交量与实测成本选择草稿来源和窗口长度。随机采样的接受与分布校正则在 [`spec_prob.hpp`](https://github.com/Niko1221/Strata/blob/011c9e60/include/strata/core/spec_prob.hpp)中实现。

## 代码实现

下面用确定性的玩具模型验证提交过程。`target_next` 代表主模型给出的下一 token，`verify` 对一组候选前缀取得预测，再提交连续匹配的草稿和首次分歧处的修正。全匹配、首次拒绝和空草稿，都应与逐个生成得到相同结果。

```python
def target_next(prefix):
    return (sum((i + 1) * token for i, token in enumerate(prefix))
            + len(prefix) + 1) % 7

def plain(prefix, count):
    state = list(prefix)
    for _ in range(count):
        state.append(target_next(state))
    return state[len(prefix):]

def verify(prefix, drafts):
    # 第 i 行只能看见 prefix 与前 i 个草稿。
    predictions = [target_next(prefix + drafts[:i])
                   for i in range(len(drafts) + 1)]
    accepted = 0
    while accepted < len(drafts) and drafts[accepted] == predictions[accepted]:
        accepted += 1
    committed = drafts[:accepted] + [predictions[accepted]]
    return committed, accepted

prefix = [1, 2]
good = plain(prefix, 3)
cases = [good, [good[0], (good[1] + 1) % 7, good[2]],
         [(good[0] + 1) % 7], []]
for drafts in cases:
    committed, accepted = verify(prefix, drafts)
    assert committed == plain(prefix, len(committed))
    print('草稿', drafts, '接受', accepted, '提交', committed)

# 简化的可回退状态：丢弃错误草稿，再从提交前缀继续。
committed, _ = verify(prefix, cases[1])
assert plain(prefix + committed, 2) == plain(prefix, len(committed) + 2)[-2:]
```

# 统一内存

## 权重映射

Apple Silicon 的 CPU 与 GPU 共享物理内存。主权重装得下时，Strata 将 GGUF 文件 mmap 后包装为 no-copy Metal buffer，GPU 按张量偏移读取，省去 PC 路径的整份上传与专家跨 PCIe 搬运。文件页面仍需读入内存，计算仍消耗内存带宽；专用量化 kernel、prefill 分组和 MTP 复用也仍然有用。实现在 [`window.cpp`](https://github.com/Niko1221/Strata/blob/011c9e60/metal/src/engine/window.cpp)。

权重之外还要为系统、KV、MTP 和运行缓冲区预留空间。预算不足时，Metal 改用专家流式路径：热点留在 arena，缺失专家从文件读取，并预取下一层可能使用的专家。配套文件把 gate、up、down 矩阵排在一起，以减少 I/O 请求。实现在 [`stream.cpp`](https://github.com/Niko1221/Strata/blob/011c9e60/metal/src/engine/stream.cpp)。驻留路径主要消耗内存带宽，流式路径还要应对 SSD 延迟。

## 实例验证

我的实例是一台 M3 Ultra Mac Studio，512 GB 统一内存，macOS 15.4.1。模型为 IQ3_S，实例报告引擎 `0.1.46-metal`，上下文配置 65536，启用 MTP，`--spec 2`。

加载日志打印主文件为 `wrapped (54.8 GB)`，说明主权重走驻留映射路径；n-gram 表单独按行读取。残差门控的一部分矩阵使用 Q8_0，减少这部分权重的读取量。

[测试脚本](/resource/script/strata-bench.py)先预热一次，再连续请求三次：温度为 0，关闭 thinking，每次最多生成 128 token，并记录生成耗时、缓存复用量与草稿接受量。可通过 SSH 在服务所在机器运行。

三次请求的 prompt 均为 41 token，生成均为 128 token，未命中 prompt cache：

| 请求 | Prompt ms | Decode ms | Decode token/s | 草稿接受数 / 提出数 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 767.1 | 4367.0 | 29.3 | 55 / 78 |
| 2 | 903.5 | 5001.4 | 25.6 | 53 / 80 |
| 3 | 782.5 | 4970.3 | 25.8 | 52 / 78 |

用三次总生成 token 数除以总 decode 时间，得到 **26.78 token/s**，草稿总体接受比例为 $160/236\approx67.8\%$。

# 结语

回到最初的问题，大模型能在小显存上运行，先是因为每步只使用少量专家；速度能保持下来，则靠热点常驻、未命中工作并行，以及一次读取服务多个 token。缓存命中率决定慢路径有多少工作，各分支的速度决定一轮要等多久，草稿接受量决定这一轮最终产出多少 token。

# 参考资料

- [Strata](https://github.com/Niko1221/Strata/tree/011c9e60)
- [Strata 技术文档](https://github.com/Niko1221/Strata/blob/011c9e60/docs/DETAILS.md)
- [Strata 项目论文](https://github.com/Niko1221/Strata/blob/011c9e60/docs/paper/Strata-Paper.pdf)
- [Strata Metal 文档](https://github.com/Niko1221/Strata/blob/011c9e60/docs/MAC.md)
- [Qwen3.8-Flash-Next](https://huggingface.co/Qwen/Qwen3.8-Flash-Next)
- [Fast Inference from Transformers via Speculative Decoding](https://arxiv.org/abs/2211.17192)
