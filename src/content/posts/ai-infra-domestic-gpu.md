---
title: 国产算力
date: 2026-10-04
updated: 2026-10-10
description: 核对国产算力的芯片交付、超节点部署、软件适配与选型边界。
tags: [AI Infra, GPU，昇腾]
category: AI Infra
episode: 8
draft: false
lang: zh_CN
---

# 前言

[谱系](../ai-infra-gpu-lineup/)、[指标](../ai-infra-gpu-metrics/)和[选型](../ai-infra-gpu-selection/)三篇主要讲 NVIDIA。本文沿用同一套指标，看国产算力的芯片、超节点、软件生态和获取方式。

# 玩家谱系

2026 年的变化不只是型号变多：超节点开始批量交付，推理业务也从样机适配走向线上服务。市场上有昇腾、寒武纪、海光，以及摩尔线程、沐曦、壁仞、燧原等路线不同的厂商。

## 昇腾

华为覆盖芯片、灵衢互联、Atlas 整机、CANN 软件栈和云服务。910C 支撑现有超节点，950PR 已上市，950DT 面向下一代训练系统。

950PR 一行采用 Atlas 350 板卡规格；950DT 的数据来自产品规划。

| 型号 | 进展 | 用途 | 显存 | 显存带宽 |
| --- | --- | --- | --- | --- |
| 910C | 已商用 | 训练、推理 | 128 GB | 3.2 TB/s |
| 950PR | 少量上市 | Prefill、推荐 | 112 GB | 1.4 TB/s |
| 950DT | 超节点测试中 | Decode、训练 | 预计 144 GB | 预计 4 TB/s |
| 960DT / 960PR | 预计 2027 Q1 / Q3 | 训练 / 推理 | 未公布 | 未公布 |
| 970 / 980 | 预计 2028 / 2029 | 待公布 | 未公布 | 未公布 |

华为在 2026 年全联接大会展出了 Atlas 950 超节点，并发布 Peerium 计算架构。Ascend C 新增 SIMD/SIMT 编程模式和 PTO ISA，芯片与软件栈同步迭代。960DT、960PR 的计划上市时间也提前到 2027 年一季度和三季度：

![截至 2026 年 10 月的昇腾芯片进度](/img/posts/ai-infra-domestic-gpu/ascend-roadmap.svg)

950PR 侧重计算密集的 prefill 和推荐，950DT 则为 decode 和训练提供更高的带宽与互联规格。

## 寒武纪与海光

- **寒武纪**：思元系列走专用 AI 加速器路线。2026 年上半年营收约 60 亿元、归母净利润约 23.1 亿元，收入几乎全部来自云端产品。
- **海光信息**：DCU 采用 GPGPU 架构，软件栈包括 DTK、DAS 和 DAP，已适配多款主流模型。公司上半年营收约 91 亿元，包括 CPU 与 DCU 两条产品线；CUDA 项目迁移到 DCU 主要依靠 HIP 和对应的算子库。

## 摩尔线程、沐曦、壁仞与燧原

2026 年，这四家已有产品进入量产或客户交付，后续型号仍在开发：

| 厂商 | 产品进展 | 2026 年上半年营收 |
| --- | --- | --- |
| 摩尔线程 | S5000 与夸娥集群已交付，花港架构产品待上市 | 约 17.36 亿元 |
| 沐曦 | 曦云 C600 于 5 月量产，C700 处于设计验证阶段 | 约 13.24 亿元 |
| 壁仞 | R100 系列进入客户交付 | 约 12.36 亿元 |
| 燧原 | 推理产品进入互联网客户业务 | 约 11.2 亿元 |

## 路线分化

软件迁移主要有三条路径：摩尔线程 MUSA 和沐曦 MXMACA 提供 CUDA 源码适配，海光 DCU 使用 DTK 与 HIP，昇腾 CANN、寒武纪 Neuware、燧原 TopsRider 则有各自的算子与运行时。迁移成本落在目标模型的算子、低精度格式和集合通信适配上。

![国产算力厂商的软件迁移路线](/img/posts/ai-infra-domestic-gpu/domestic-landscape.svg)

# 指标对照

先用 910C 与 A100、H100 的标称规格对照显存、算力和互联：

| 指标 | 昇腾 910C | NVIDIA 对位 | 比较结果 |
| --- | --- | --- | --- |
| 显存 | 128 GB HBM | A100 / H100 的 80 GB 型号 | 容量多 48 GB |
| 显存带宽 | 约 3.2 TB/s | A100 80G 约 2 TB/s、H100 SXM 3.35 TB/s | 高于 A100，接近 H100 |
| 算力 | FP16/BF16 约 800 TFLOPS | H100 SXM 稠密 FP16/BF16 约 990 TFLOPS | 标称值约为 H100 的八成 |
| 卡间互联 | 约 784 GB/s | H100 NVLink 4 双向合计 900 GB/s | 属同一量级 |

## 单卡

图中再加入 B200，可以看出这几代卡的容量、带宽和算力如何分化：

![昇腾 910C 与 NVIDIA 三代旗舰的单卡标称规格对照](/img/posts/ai-infra-domestic-gpu/single-chip-gap.svg)

910C 的显存容量高于 H100 的 80 GB 型号，带宽与 H100 接近；到 B200 这一代，算力和带宽又拉开了距离。显存决定模型能否常驻，推理速度还要结合模型精度和 KV cache 占用看。

## 互联

910C 的卡间互联标称 784 GB/s，与 H100 NVLink 4 的 900 GB/s 属同一量级；950DT 规划提升到 2 TB/s。2026 年公布的 Peerium 架构进一步把灵衢互联和跨节点统一编址纳入系统设计，目标是扩大多卡协作的计算域。

## 制程约束

芯片设计之外，制程、HBM 和封装产能共同决定供货。950PR 已少量上市，950DT 的训练超节点仍在测试；这轮产品迭代的推进速度也取决于供应链扩产。

# 超节点

多卡互联把单机箱扩展为计算域；384 卡、1024 卡和 8192 卡分别对应已商用系统、展示实机和产品规划。

## CloudMatrix 384

**Atlas 900 A3 SuperPoD** 把 384 颗 910C 组成超节点，**CloudMatrix 384** 是华为云基于它提供的服务。Atlas 900 A3 的部署量从 2026 年 7 月的 750 多套增长到 9 月的 1000 多套。

SemiAnalysis 在 2025 年对 CloudMatrix 384 和 GB200 NVL72 做了系统级估算：

| 2025 年估算口径 | CloudMatrix 384 | GB200 NVL72 |
| --- | --- | --- |
| 加速芯片数 | 384 × 910C | 72 × GB200 |
| BF16 稠密标称算力 | 约 300 PFLOPS | 约 180 PFLOPS |
| HBM 总量 | 约 48 TB | 约 13.5 TB |
| Scale-up 互联总带宽 | 约 269 TB/s | 约 130 TB/s |
| 系统功耗 | 约 560 kW | 约 145 kW |
| 整机价格 | 约 800 万美元 | 约 300 万美元 |

![2025 年估算的 CloudMatrix 384 与 GB200 NVL72 系统指标](/img/posts/ai-infra-domestic-gpu/supernode-compare.svg)

384 颗对 72 颗：CloudMatrix 用更多芯片换来了更大的总显存和标称算力，也付出更高的功耗与整机成本。这组数字解释的是系统架构取舍；采购时还要比较目标模型的吞吐、能效和机房成本。

## 从 384 卡到 950 超节点

2026 年 7 月展出的 Atlas 950 SuperPoD 实机为 **1024 卡**，华为公布 FP8 1 EFLOPS、FP4 2 EFLOPS 与 256 TB 统一编址空间。单套 **8192 卡、16 PB/s** 是满配规划；华为披露正在部署测试的 **25.6 万卡** 则是多套超节点组成的集群。华为云宣布 950 智算集群服务从 9 月 30 日起在国内商用。

光互联让计算域跨越单柜。CloudMatrix 384 大量使用可插拔光模块；2026 年发布的 Atlas 960E 则采用近封装光学（NPO）方案，规划单套扩展至 4096 卡，使用 5500 个 Hi-ONE 模块。960DT 芯片的计划上市时间是 2027 年一季度。

## P/D 分芯

按第二篇的 roofline 理解，prefill 更吃矩阵算力，单请求 decode 更吃访存带宽。950PR 的 Atlas 350 板卡提供 1.4 TB/s，950DT 规划使用 4 TB/s 的 HiZQ HBM，对应两种不同负载。

![Prefill 与 decode 的瓶颈及 950PR、950DT 产品定位](/img/posts/ai-infra-domestic-gpu/pd-split.svg)

拆分部署时，KV cache 要从 prefill 节点传到 decode 节点；传输成本和请求批量一起决定整套系统的吞吐。

# 软件生态

CANN 社区持续更新，昇腾已进入 PyTorch 加速器后端和 vLLM-Ascend 的支持范围。现在影响落地的具体问题是版本组合、算子覆盖以及大型训练任务的稳定性。

## 软件栈

昇腾与 NVIDIA 软件栈的功能层次对照如下，迁移工作主要落在框架、算子和通信上：

![昇腾软件栈与 NVIDIA 栈的功能对照](/img/posts/ai-infra-domestic-gpu/sw-stack.svg)

PyTorch 通过 `torch_npu` 使用 CANN，集合通信由 HCCL 提供；推理侧可以选择 MindIE 或 vLLM-Ascend。后者已支持部分 Ascend 950 型号、模型与低精度格式，部署时按 HDK、CANN、`torch_npu` 和推理引擎的兼容矩阵选定版本。海光、摩尔线程和沐曦各有自己的软件栈与适配路径。

## 迁移成本

推理侧先检查 attention、MoE 和量化算子，再按相同输入长度与 batch 测首字延迟、逐 token 延迟和显存占用。训练侧还要验证精度、集合通信、检查点恢复与多机长稳。遇到缺失算子，需要移植或重写 kernel，工作量取决于模型使用了多少专用算子。

## 适配进度

vLLM-Ascend 在 2026 年陆续加入 Ascend 950、MXFP8/MXFP4 和更多模型的支持。官方矩阵列出了卡型、模型、精度及对应的软件版本，也标明仍处于实验阶段的组合。选型时可直接用目标配置对照矩阵。

# 获取与选型

## 个人

华为在 2026 年全联接大会推出开发者 **100 NPU-Hour** 计划，适合先试算子和模型。长期使用可租华为云昇腾实例或第三方算力，950 智算集群服务也已宣布在国内商用。想研究数据中心 NPU，租用对应卡型比购买桌面消费卡更直接。

## 企业与集采

企业采购要核对目标模型的精度与吞吐、多卡通信效率、故障恢复时间、供货周期和软件支持。950PR 供货有限，950DT 训练系统仍在测试；沐曦 C600 已量产，C700 仍在开发。交付阶段会直接影响项目排期。

沿用第三篇的显存、带宽、互联与总成本框架，再加上软件迁移和供货计划，就能把不同国产方案放进同一张选型表。

# 结语

Atlas 900 A3 已规模部署，950PR 已少量上市，950DT 训练系统仍在测试。接下来值得观察的是 950DT 的供货、960 路线图的兑现，以及新硬件在长稳训练中的表现。

# 参考资料

- [华为 2025 年昇腾芯片与超节点路线图](https://www.huawei.com/cn/news/2025/9/hc-xu-keynote-speech)
- [华为 2026 年全联接大会芯片路线更新](https://www.huawei.com/en/news/2026/9/hc-wang-keynote)
- [徐直军谈 950PR 供货与 950DT 测试进度](https://www.chinanews.com.cn/cj/2026/10-06/10708509.shtml)
- [上海证券报：Atlas 350 展出板卡 112 GB、1.4 TB/s 规格](https://finance.sina.com.cn/wm/2026-03-21/doc-inhrukzr5698636.shtml)
- [华为 2026 世界人工智能大会披露 384 部署与 950 实机](https://www.huawei.com/cn/news/2026/7/atlas-950-superpod)
- [华为发布 Atlas 960E 与 Hi-ONE 近封装光学方案](https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode)
- [华为云公布 950 集群服务商用时间](https://www.huawei.com/cn/news/2026/9/hc-agentic-infra-industry-ai)
- [华为公布 Ascend C 与 PTO ISA 进展及开发者计划](https://www.huawei.com/en/news/2026/9/hc-agentic-thinkpro-pto-cann)
- [SemiAnalysis 2025 年 CloudMatrix 384 系统估算](https://newsletter.semianalysis.com/p/huawei-ai-cloudmatrix-384-chinas-answer-to-nvidia-gb200-nvl72)
- [寒武纪 2026 年半年报摘要](http://static.cninfo.com.cn/finalpage/2026-08-08/1225464971.PDF)
- [海光信息 2026 年上半年产品与软件栈进展](http://static.cninfo.com.cn/finalpage/2026-08-14/1225472509.PDF)
- [沐曦 C600 量产和 C700 开发进度](https://www.stcn.com/article/detail/4175446.html)
- [2026 年国产算力公司半年报梳理](https://www.tmtpost.com/8138350.html)
- [vLLM-Ascend 的 950 型号适配路线](https://github.com/vllm-project/vllm-ascend/issues/7157)
- [vLLM-Ascend 官方支持矩阵](https://docs.vllm.ai/projects/ascend/en/v0.24.0rc/user_guide/support_matrix/supported_models.html)
