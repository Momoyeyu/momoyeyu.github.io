---
title: GPU 选型
date: 2026-10-03
description: 从本地推理到生产部署的 GPU 选型决策：显存门槛、带宽体验、互联预算，以及三条影响卡价值的非常规路径：PCIe P2P 破解、魔改显存和云租赁。
tags: [AI Infra, GPU, LLM]
category: AI Infra
episode: 7
draft: true
lang: zh_CN
---

# 前言

前两篇分别解决了[都有哪些卡](../ai-infra-gpu-lineup/)和[怎么读懂规格表](../ai-infra-gpu-metrics/)。这篇把它们合成决策：按本地推理、微调训练、生产部署三类场景，说清楚每一类里钱到底该花在哪个指标上。最后聊几条非常规路径。它们不是教程，但它们的存在改变了一些卡的价值，选型时不能装作不知道。

# 本地推理

本地跑模型的决策链最短：**先看显存够不够，再看带宽够不够快**。

## 模型规模门槛

用上篇的公式 `显存 ≈ 参数量 × 字节 + KV cache + 约 20% 余量` 直接对照：

| 模型 | 常用量化 | 最低显存 | 对应卡 |
| --- | --- | --- | --- |
| 7B | FP16 | ~16 GB | 4060 Ti 16G / 5060 Ti 16G，但很紧张 |
| 8B | FP16 | ~20 GB | 24G 起步：3090 / 4090 / 5090 |
| 14B | Q4–Q6 | ~16 GB | 16G 甜点档 |
| 32B | Q4 | ~24 GB | 3090 / 4090 / 5090 |
| 70B | Q4 | ~48 GB | 2×24G，或 48G 以上的卡 |
| 70B 级 | FP8 | ~80 GB | A100 80G / H100 起 |

注意"能跑"和"够用"的区分：32B Q4 在 24G 卡上能跑，但 KV cache 几乎没余量，长上下文一来就爆；70B Q4 硬塞进 32G 的 5090 则根本装不下。门槛表给的是下限，舒适使用要再加一档。

## 交互体验

体验由 decode 速度决定，而 decode 速度由上篇的带宽公式决定。体感门槛大致是：

| decode 速度 | 体感 |
| --- | --- |
| 10 t/s 以下 | 读得难受 |
| 10–30 t/s | 可用 |
| 50 t/s 以上 | 流畅 |
| 100 t/s 以上 | 无感 |

同一张卡上，量化从 FP16 降到 4-bit 既能省显存又能提速，这也是为什么本地推理几乎没人用 FP16。

## 多卡推理

显存不够时有两条路：上更大的卡，或者多张卡拼。两张 24G 拼 48G 跑 70B Q4，成本远低于一张数据中心卡，代价是引入互联问题：张量并行每层都要同步。好在推理的通信量不大：有实测显示 8×5090 无 NVLink 全走 PCIe，高并发下通信只占 step 时间的 3%–6%，推理场景里 PCIe 多卡是可以接受的。训练就是另一个故事了，见下节。

# 微调与训练

## 微调门槛

微调先分两种。**参数高效微调**（LoRA/QLoRA）只训练少量适配参数，底座可以量化加载，QLoRA 在 24G 卡上微调 32B 级别的模型是可行的，24G 因此成了个人微调的分水岭。**全参微调**的账完全不同：AdamW 下需要权重、梯度、两份优化器状态和一份 master weights，7B 模型就要 100 GB 往上，连 A100 80G 单卡都装不下，得多卡 ZeRO 分片，或者 8-bit 优化器加 offload 这套组合拳。

## 多卡训练

训练对互联的要求比推理高一个量级。数据并行每个 step 都要 allreduce 梯度，张量并行更是每层同步，PCIe 的几十 GB/s 在多卡训练里会立刻成为瓶颈，这就是为什么训练集群绕不开 NVLink 域或至少高速 P2P。反过来，只是推理或者流水线并行这种低频通信的场景，PCIe 多卡就够用。**先定并行方式，再谈互联预算。**

# 生产部署

## 吞吐与延迟

生产场景的目标函数变了：不再是单流体验，而是单位成本下的吞吐。连续批处理（continuous batching）把多请求的 prefill 和 decode 混排，把权重读取摊到整个 batch 上，前面"decode 纯吃带宽"的结论在大 batch 下会松动，算力重新变得重要。再进一步，prefill 和 decode 甚至可以分开部署：算力密度高的卡做 prefill，带宽大的卡做 decode，各自物尽其用。

## 机房的账

生产不用游戏卡的原因不是性能，4090 的性价比机房不是看不见，而是几张表外的账：GeForce EULA 对数据中心部署的限制、无 ECC 带来的长任务位翻转风险、开放式散热不适配机柜风道、没有服务器保修、供应商不支持。改成涡轮散热确实能把游戏卡塞进机柜，前面说的灰色市场就是这么来的。对小团队这些账可以折算成风险自担；对要过合规和稳定性审计的机房，数据中心卡是没有替代品的。

# 非常规方案

官方产品线之外有三条灰色路径。它们不值得展开成教程，但每一条都在实际改写某些卡的价值。

## PCIe P2P 直连

第一篇说过，NVIDIA 在 GeForce 上禁用了 GPU 间 P2P：40、50 系消费卡连"直连"的硬件路径（MAILBOX P2P）都没给留。但开源社区给出了驱动补丁：tinygrad 的 open-gpu-kernel-modules fork 及其衍生借用 Hopper 的 BAR1 P2P 路径，让 4090/5090 在无 NVLink 的情况下也能点对点直连显存，配合 Resizable BAR 和 IOMMU 关闭或直通即可使用。

三种数据通路放在一起对比最直观：默认的消费卡通信要先把显存拷进主机内存再拷回，BAR1 P2P 让 DMA 直接读对端显存，而 3090 的 NVLink 则是芯片级直连：

![GPU 间通信的三种通路：NVLink、BAR1 P2P 与主存中转](/img/posts/ai-infra-gpu-selection/p2p-topology.svg)

这个补丁的存在改变了消费卡多卡的天花板：8×5090 的"推理一体机"成了真实可买的商品，有报道称中国厂商大量采购 5090 用于运行 DeepSeek 类模型，黑市价格一度炒到 5000 美元。换言之，**5090 的市场定价里已经包含了这条灰色路径的期权价值**，判断它的性价比时不能只看官方规格表。

## 魔改显存

第二条路径是华强北式的硬件改装：把 4090 的 24G 显存扩到 48G。做法是重画或换用双面颗粒的 PCB，24 颗 2G 颗粒正反面贴。代价是锁功耗墙、约 5% 的核心性能损失和无保修，价格在两三万人民币区间；更早的还有 2080 Ti 22G 这种老方案。

它对价值体系的冲击在于：官方渠道里 48G 显存的最低门槛也要四五千美元，RTX PRO 5000、6000 Ada 这个级别，魔改把它拉到了消费级价位。"跑 70B 需要数据中心卡"这个默认假设，在魔改存在之后不再成立。当然，保修为零、稳定性自负的折价也要算进去。

## 云租赁

第三条路径其实不灰，只是常被忽视：**不拥有卡**。当前时租的大致水位：

| 卡 | 时租 |
| --- | --- |
| RTX 3090 | 约 0.25 美元/小时 |
| RTX 4090 | 约 0.35 美元/小时 |
| H100 | 约 2.2 美元/小时 |
| B200 | 约 6 美元/小时 |

以上是 vast.ai、RunPod 等聚合平台的水位，波动很大；国内 AutoDL 等平台的 4090 大约 2–3 元/小时，会员和闲时更低。

租还是买，核心是利用率：一张 4090 自购约 ¥1.5 万，按 ¥2/h 算，每天跑满 8 小时约两年半回本，算上电费约三年。使用率越高买越划算，偶尔跑跑则租显然更省。

把这笔账画成累计成本曲线，利用率就是那个决定性的斜率：

![自购与云租赁的累计成本对比](/img/posts/ai-infra-gpu-selection/rent-vs-buy.svg)

24 小时跑满的用户十个月就把租赁花超了购卡钱；每天 8 小时的中度用户回本点推到两年半以外；而每天只跑 2 小时的轻度用户，三年都摸不到购卡成本，对这类人来说租赁是压倒性的划算。何况 H100 这种级别的卡没有正规零售渠道，拆机商报价两三万美元起；B200 干脆只随整机卖，对大部分人来说租赁是唯一通路。反过来，vast.ai 这类市场的实例可能被随时回收、没有 SLA，生产负载放上去要考虑 checkpoint 和中断成本。

# 结语

三篇文章到此收束成一个决策顺序：**需求场景 → 显存门槛 → 带宽体验 → 互联与预算**。先想清楚要跑什么，算显存下限，再用带宽估体验，最后按多卡需求决定互联投入；非常规路径存在，但它改变的是个别卡的价值锚点，不改变决策顺序本身。

![GPU 选型决策流程](/img/posts/ai-infra-gpu-selection/decision-flow.svg)

这个系列聊的都是 NVIDIA，因为 CUDA 生态是当前的事实标准。但在出口管制和国产替代的大背景下，昇腾、寒武纪这条线是另一个完整的世界，值得单独开一篇，后面再谈。

# 参考资料

- [Which GPU(s) to Get for Deep Learning — Tim Dettmers](https://timdettmers.com/2023/01/30/which-gpu-for-deep-learning/)
- [tinygrad/open-gpu-kernel-modules — P2P patch for consumer GPUs](https://github.com/tinygrad/open-gpu-kernel-modules)
- [aikitoria/open-gpu-kernel-modules — P2P for 3090/4090/5090](https://github.com/aikitoria/open-gpu-kernel-modules)
- [RTX 4090 48GB 魔改版评测 — 晨涧云](https://www.mornai.cn/news/gpu/rtx-4090-48gb/)
- [First Teardown: 48GB RTX 4090 Mod — Hardware Corner](https://www.hardware-corner.net/48gb-rtx-4090-first-tests/)
- [Vast.AI GPU Pricing Guide — DeployBase](https://deploybase.ai/articles/vast-ai-gpu-cloud-pricing-complete-guide-vs-hr-for-every-gpu)
- [Cloud GPU Pricing Comparator — Kenodo](https://kenodo.com/tools/cloud-gpu-pricing-comparator)
- [deepseek-v4-flash-5090 — 8× RTX 5090 serving recipe](https://github.com/Unravl/deepseek-v4-flash-5090)
