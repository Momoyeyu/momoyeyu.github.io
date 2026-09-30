---
title: GPU 性能评估
date: 2026-09-30
description: 读懂 GPU 规格表：显存容量决定能不能跑，带宽决定推理多快，算力决定训练和 prefill，互联决定多卡效率。附可在任意 N 卡上运行的实测代码。
tags: [AI Infra, GPU, LLM]
category: AI Infra
episode: 6
draft: true
lang: zh_CN
---

# 前言

[上一篇](../ai-infra-gpu-lineup/)把 NVIDIA 的产品线捋了一遍。面对一张卡的规格表，真正要回答的其实只有两个问题：**能不能跑**，和**跑多快**。

能不能跑由显存容量一票否决；跑多快则要分场景——对 LLM 来说，训练和前奏（prefill）吃算力，逐 token 生成（decode）吃带宽，多卡场景还要再加一条互联。本文按这个顺序把规格表上的指标拆开讲，每个指标附上可以直接跑的实测代码——文章里的数字是公开 benchmark 和标称值，想验证自己手上的卡，代码拿去跑就是。

# 显存

## 容量

### 参数占用

显存的第一用途是装权重。估算很简单：

```text
权重显存 ≈ 参数量 × 每参数字节数
```

每参数字节数取决于量化精度：FP16/BF16 是 2 字节，FP8 是 1 字节，4-bit 量化约 0.5 字节（实际还要加 scale 等元数据，通常按 0.6–0.7 字节估）。由此得到一张常用门槛表：

| 模型 | FP16 | FP8 | 4-bit |
| --- | --- | --- | --- |
| 7B | 14 GB | 7 GB | ~5 GB |
| 14B | 28 GB | 14 GB | ~9 GB |
| 32B | 64 GB | 32 GB | ~20 GB |
| 70B | 140 GB | 70 GB | ~42 GB |

这张表直接划出了消费卡的边界：24G 卡能装 4-bit 的 32B，5090 的 32G 离 4-bit 70B 还差一截（得降到 Q3 档才勉强塞下），4-bit 70B 需要 48G 以上的卡。

把模型权重的体积画成竖线、各卡显存画成横条，「哪张卡过哪条线」就一目了然：

![各档 GPU 显存容量与模型权重体积对照](/img/posts/ai-infra-gpu-metrics/vram-map.svg)

注意竖线只是权重体积——实际部署还要叠加下面说的 KV cache 和框架开销，所以「刚好压线」的卡实际上跑不了，得留出一截余量。

### 额外开销

权重之外还有三笔账：

- **KV cache**。推理时每个 token 的注意力历史都要存下来，大小正比于 `层数 × KV 头数 × 头维 × 上下文长度 × batch`。以 Llama-3.1-70B 这类 GQA 模型为例，每 token 约 0.3 MB，128k 上下文单请求就要吃掉 40 GB——长上下文场景里 KV cache 经常比权重更贵。
- **激活值**。训练时反向传播要保留中间激活，随 batch 和序列长度线性增长，是训练显存的大头之一。
- **框架开销**。CUDA context、cuDNN workspace、显存碎片，通常先按 1–2 GB 预留。

经验法则：估算需求时按 `权重 + KV cache + 激活` 算完，再留 20% 余量。

## 带宽

### 带宽瓶颈

容量决定能不能跑，带宽决定跑多快——对 decode 阶段来说几乎是唯一决定因素。

原因在 decode 的访存模式：自回归生成每产出一个 token，都要把模型的全部权重从显存里读一遍，但每个权重只做一次乘加，算术强度极低。算力再强也得等数据喂到，所以单流 decode 的上限就是：

```text
tokens/s ≤ 显存带宽 ÷ 每 token 读取的字节数
```

每 token 读取的字节数约等于模型权重体积（MoE 模型只读激活专家——DeepSeek-V3 总参数 671B 但每 token 只激活 37B，所以它能用相对小的带宽跑出可观速度），再加上 KV cache 的读写。实测效率一般是峰值的 60%–80%。

这个公式解释了很多现象：为什么 4-bit 量化能加速近 4 倍（读的字节少了四分之三），为什么 H100 推理比 4090 快得不成比例（SXM 版带宽 3.35 TB/s 对 1.0 TB/s），为什么带宽 273 GB/s 的 DGX Spark 跑 70B 只有个位数的 t/s。

代进具体数字，同一个 70B FP8 模型（每 token 读取约 70 GB）在各卡上的理论上限差距就是这么夸张：

![70B FP8 模型在不同 GPU 上的 decode 速度上限](/img/posts/ai-infra-gpu-metrics/decode-bandwidth.svg)

单人要流畅交互大约需要 20 t/s 上下——这条虚线说明 70B 级别模型的「顺畅体验」基本是数据中心卡的专利；而 DGX Spark 虽然装得下，却只能以个位数速度吐字。反过来说，小模型（7B/14B）因为每 token 读取量小一个数量级，消费卡的带宽就足够流畅——这就是为什么本地玩小模型的人不觉得卡慢。

### 位宽与颗粒

带宽 = 位宽 × 速率。消费卡用 GDDR6X/GDDR7，靠高频率补位宽：5090 是 512-bit × 28 Gbps ≈ 1792 GB/s。数据中心卡用 HBM，直接把位宽做到 4096–8192-bit，于是 H100 有 3.35 TB/s、B200 有约 8 TB/s——这不是工艺差距，是封装差距：HBM 是堆叠颗粒跟 GPU 封装在同一块基板上，消费卡的布线方式做不到这个位宽。所以**带宽是消费卡和数据中心卡之间最难跨越的硬指标**，靠堆料解决不了。

## 代码实现

两个可以直接跑的小工具。第一个是显存带宽实测：设备到设备的拷贝既要读也要写，总流量是拷贝字节数的两倍，所以按 `2 × nbytes` 换算后和规格表带宽直接可比。

```python
import time
import torch

def vram_bandwidth(nbytes=1 << 31, iters=50):
    """实测显存带宽，返回 GB/s。"""
    src = torch.empty(nbytes, dtype=torch.uint8, device="cuda")
    dst = torch.empty_like(src)
    for _ in range(5):  # warmup
        dst.copy_(src)
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(iters):
        dst.copy_(src)
    torch.cuda.synchronize()
    return 2 * nbytes * iters / (time.perf_counter() - t0) / 1e9

print(f"{vram_bandwidth():.0f} GB/s")
```

第二个是 decode 速度估算器，把上面的带宽瓶颈公式写成函数，换上任意卡的带宽和模型大小就能估：

```python
def decode_tps(bandwidth_gbps, params_b, bytes_per_param, efficiency=0.7):
    """估算单流 decode 的 tokens/s 上限。"""
    return bandwidth_gbps * efficiency / (params_b * bytes_per_param)

# 几个例子：同一模型在不同卡上的差异，以及带宽更大的卡跑更大的模型
print(decode_tps(1008, 32, 0.6))      # 4090 + 32B Q4 ≈ 37 t/s
print(decode_tps(1792, 32, 0.6))      # 5090 + 32B Q4 ≈ 65 t/s
print(decode_tps(3350, 70, 1))        # H100 + 70B FP8 ≈ 33 t/s
```

这个估算只看权重读取，单流（batch=1）场景比较准；batch 开大之后权重被摊薄，瓶颈会逐渐转向算力和调度开销，那是生产部署的话题。

# 算力

## CUDA 与 Tensor Core

规格表上"CUDA 核心"是传统意义上的通用执行单元，标量、访存、控制流都靠它；**Tensor Core** 是专门的矩阵乘单元，一次完成一小块矩阵的乘加，深度学习的绝大部分 FLOPs 都走这里。所以读算力只看 Tensor Core 那一栏，CUDA 核心数主要影响非矩阵部分和调度能力。

## 精度档位

### 标称值读法

Tensor Core 算力按精度分列：FP32/TF32、FP16/BF16、FP8、FP4，每降一档精度峰值大致翻倍。读这个数字时注意两个坑：

- **dense vs sparse**。NVIDIA 官方数字经常标稀疏（2:4 sparsity，结构化剪枝下才有）值，是稠密值的两倍。规格表脚注里的 "with sparsity" 就是这回事，对比时先统一口径。
- **AI TOPS**。消费卡宣传的 "AI TOPS" 通常是 INT4/FP4 稀疏口径的营销数字，和 FP16 稠密算力能差出一个数量级，不能直接拿来比。

### 有效算力

标称是峰值，实测永远打折：时钟会因功耗墙波动、kernel 利用率不可能 100%、大模型训练里 MFU（实际算力利用率）能做到 40%–55% 已是优秀水平。另外新精度有软件滞后期——FP8 在 H100 发布一年后才被主流框架用顺，FP4 现在仍在走这条路；买新卡冲新精度，要做好"头半年跑不出标称"的心理准备。

## 适用场景

算力什么时候是瓶颈？看算术强度。**Prefill 和训练**是 compute-bound：prompt 的几千个 token 可以并行算，权重被反复使用，算术强度远超带宽供给能力，这时 Tensor Core 有多少 FLOPS 就直接值多少钱。**Decode 反之**是 bandwidth-bound，算力空转。

这个关系用 roofline 模型画出来最清楚——横轴是算术强度（每读一字节能做多少运算），可达性能被「带宽斜线」和「算力天花板」夹在下方：

![Roofline 模型：decode 落在带宽受限区，prefill 与训练落在算力受限区](/img/posts/ai-infra-gpu-metrics/roofline.svg)

分水岭在拐点 AI\*（峰值算力 ÷ 带宽）。decode 的算术强度只有个位数，死死压在带宽斜线上——给它再强的 Tensor Core 也没用；而 prefill 和训练的几百 FLOP/B 早已越过拐点，此时唯一值钱的就是峰值算力。

一个实用推论：同一张卡，prefill 快不代表 decode 快。数据中心里 prefill 和 decode 甚至开始分开部署——算力强的卡做 prefill、带宽大的卡做 decode，这是后话。

## 代码实现

实测 matmul 算力，顺带演示 FP32 和 TF32 的差距：

```python
import time
import torch

def matmul_tflops(dtype, n=8192, iters=20):
    """实测 n×n matmul 的 TFLOPS。"""
    a = torch.randn(n, n, dtype=dtype, device="cuda")
    b = torch.randn(n, n, dtype=dtype, device="cuda")
    for _ in range(3):  # warmup
        a @ b
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(iters):
        a @ b
    torch.cuda.synchronize()
    dt = (time.perf_counter() - t0) / iters
    return 2 * n**3 / dt / 1e12

print(f"FP16: {matmul_tflops(torch.float16):.0f} TFLOPS")
print(f"BF16: {matmul_tflops(torch.bfloat16):.0f} TFLOPS")

torch.set_float32_matmul_precision("highest")  # 真 FP32
print(f"FP32: {matmul_tflops(torch.float32):.0f} TFLOPS")
torch.set_float32_matmul_precision("high")     # TF32
print(f"TF32: {matmul_tflops(torch.float32):.0f} TFLOPS")
```

在大多数卡上会看到 FP16 ≈ BF16 ≫ TF32 > FP32 的阶梯，阶梯高度就是各档 Tensor Core 算力的差距。FP8 从 Ada（RTX 40 系）起就有硬件支持，可以通过 `torch._scaled_mm` 测；FP4 则是 Blackwell 独占。

# 互联

单卡之外，多卡场景下第三个维度是互联带宽。

## PCIe

PCIe 是所有卡共用的基础互联：Gen4 x16 约 32 GB/s，Gen5 x16 约 64 GB/s，单向口径。多卡工作站常把 x16 拆成两个 x8，对 PCIe 来说 x8 Gen5 约等于 x16 Gen4，大多数量化推理感觉不到差别；但对数据搬运重的任务，通道数实打实减半。查拓扑用 `nvidia-smi topo -m`，它还会告诉你两张卡之间走不走 P2P。

## NVLink

NVLink 是 GPU 间的专用直连总线，带宽远超 PCIe：

| 代际 | 代表卡 | 带宽（双向合计） |
| --- | --- | --- |
| NVLink 3.0 | RTX 3090（消费级绝唱）、A100 | 112.5 / 600 GB/s |
| NVLink 4.0 | H100/H200 | 900 GB/s |
| NVLink 5.0 | B200/GB200 | 1.8 TB/s |

注意口径：NVLink 惯例按双向合计报，而上面 PCIe 的数字是单向——跨表对比时别忘了这一点。

注意代际之间不通用：NVLink 带宽是"NVLink 域内"的值，域由 NVSwitch 或直连桥构成；出了域就是另一个世界——跨节点走 InfiniBand，NDR 400 Gb/s 大约 50 GB/s，比域内低一个数量级。这就是为什么 GPU 集群设计成"域内紧密、域间稀疏"的两级结构。

把这几档互联放在同一根对数轴上，「域内」和「域间」的落差一眼就能看出来：

![PCIe、InfiniBand 与各代 NVLink 带宽对比（对数轴）](/img/posts/ai-infra-gpu-metrics/interconnect.svg)

对数轴上一个格就是十倍：PCIe 和 IB 挤在左侧几十 GB/s 的区间，而 NVLink 各代稳稳落在几百到上千 GB/s——「域内紧密、域间稀疏」不是比喻，是实打实的带宽断层。

## P2P

P2P（peer-to-peer）指一张卡直接读写另一张卡的显存，不绕主存。数据中心卡上这是默认能力（GPUDirect P2P），延伸到网卡就是 GPUDirect RDMA——网卡直读显存，跨节点通信不过 CPU。消费卡在驱动层面禁用了它，后果是消费卡多卡通信只能走主存中转，带宽低一截——这正是上一篇说的"功能阉割"，也是下一篇偏方的突破口。

哪些并行方式吃互联：**张量并行**（TP）把单层切到多卡，每层都要 allreduce，对互联最敏感，基本绑定 NVLink 或至少 P2P；**流水线并行**（PP）只在 stage 边界传激活，PCIe 就够用；**专家并行**（EP）的 all-to-all 居中；**数据并行**（DP）每个 step 同步梯度，量大但频次低。选多卡方案时先想清楚用哪种并行，再决定互联预算。

# 其他指标

## 可靠性与虚拟化

**ECC** 显存是数据中心卡的标配，消费卡没有——单卡几小时的任务感觉不到，千卡集群跑几周就是硬需求。**MIG** 可以把一张 A100/H100 切成最多 7 个带隔离的实例，**vGPU** 支撑云厂商分时租赁，这两个都是数据中心卡独占。

## 功耗与散热

TDP 不只是电费问题：4 张 5090 就是 2.3 kW 的 GPU 功耗墙，家用插座和电源都是问题；散热形态（开放式风扇、涡轮、被动）决定能不能塞进多卡机箱；噪音决定这玩意能不能放客厅。这些指标不上规格表的热搜，但每张卡都要落到真实的机箱里。

## 软件许可

GeForce 驱动的 EULA 限制数据中心部署，专业卡和数据卡没有这条。对个人玩票无影响，但对想拿消费卡建推理服务的人来说，这是采购合规层面真实存在的一条线——现实中的执行尺度是另一回事，下一篇偏方篇会再提。

# 结语

读 GPU 规格表的顺序可以浓缩成一句话：**显存容量一票否决，带宽决定 decode 体验，算力决定训练与 prefill，互联决定多卡上限**，剩下的 ECC、形态、许可按场景兜底。

指标会读了，下一篇进入实战：按本地推理、微调训练、生产部署三类场景，把谱系和指标合成选型决策。

# 参考资料

- [Which GPU(s) to Get for Deep Learning — Tim Dettmers](https://timdettmers.com/2023/01/30/which-gpu-for-deep-learning/)
- [Making Deep Learning Go Brrrr From First Principles — Horace He](https://horace.io/brrr_intro.html)
- [Epoch AI — Machine Learning Hardware Dataset](https://epoch.ai/data/machine-learning-hardware)
- [NVLink — Wikipedia](https://en.wikipedia.org/wiki/NVLink)
- [llm-roofline — decode throughput floor](https://github.com/Pluenet-Killian/llm-roofline)
- [NVIDIA Blackwell Architecture Datasheet](https://dam-cdn.nvd.orangelogic.com/AssetLink/01dyp27s6aj4e0483cs5goo15354m438.pdf)
