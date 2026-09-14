---
title: 初识 AI Infra
date: 2026-05-15
description: '对 AI Infra 这个方向的初步认识：核心命题、和传统应用开发的差异、为什么选它，以及现实风险。'
tags: [AI Infra, LLM, CUDA]
category: AI Infra
episode: 0
draft: false
image: '/img/posts/ai-infra-roadmap/cover.webp'
lang: 'zh_CN'
---

近期接触了一些偏架构层面的工作，发现了 AI Infra 这个方向。碰巧之前在字节实习的团队做的就是成本性能优化，对这块产生了一些兴趣。
在 B 站搜了一下 AI Infra，刷到了 [WhynotTV Podcast #4](https://www.bilibili.com/video/BV1darmBcE4A) 采访翁家翌那期，对 AI Infra 有了初步的认识。

<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; margin: 1.5rem 0; border-radius: 8px;">
  <iframe
    src="https://player.bilibili.com/player.html?bvid=BV1darmBcE4A&page=1&high_quality=1&danmaku=0"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
    scrolling="no"
    frameborder="0"
    allowfullscreen="true">
  </iframe>
</div>

经过几天的调研，以及对学术界、工业界一些人的咨询，我对 AI Infra 有了更多的认识。由于本人对 AI Infra 的理解尚浅，文中可能会有较大的 bias。
但还是想先记录一下当前对 AI Infra 的认知，希望几年后的自己不要嫌弃现在的自己太幼稚。

## AI Infra 是在做什么

个人看来，如果要用一句话概括什么是 AI Infra，我认为就是"让 AI 系统更高效地跑起来"。
具体覆盖训练基础设施、推理基础设施、数据与 Eval Infra、GPU 集群管理，以及近年比较新的 Agent Runtime。

最容易被外界看到的部分是**成本与性能优化**——KV cache、量化、PagedAttention、algorithm-aware kernel 这类硬指标——但这只是其中一个维度。
可靠性、可扩展性、易用性、可观测性同样是 AI Infra 工程师要负责的事，只不过对外不那么"性感"。

我自己最感兴趣的还是性能/成本这一支，所以本系列后续会偏向这个角度。但写在前面，避免给读者"AI Infra = 写 kernel + 抠性能"的错觉。

## 和传统应用开发的差异

真正的区别在于**性能卡点不同**：

- **传统后端 / Agent**：松耦合分布式，通过 RPC、消息队列、CDN 把无状态服务横向扩展。性能瓶颈来自 IO、序列化、网络往返。
- **AI Infra**：紧耦合分布式，通信原语是 NCCL 的 allreduce / allgather / broadcast 这类 collective communication，性能瓶颈是显存带宽、片间互联、通信与计算的重叠。

本质的差异在于**关注的资源不同**：

- 前后端工程师面临性能卡点时，主要手段是做好技术选型——换更快的中间件，加缓存，用更并发的运行时。
- AI Infra 工程师面临的更多是"这台 H100 我只用到了 30%，剩下 70% 怎么压出来"——是对硬件本身的压榨。

不过 AI Infra 上层也并不是纯粹的"非业务"工作。推理框架的请求路由、batch 策略、调度器，本质上都是给上层算法/产品团队提供的平台能力。
只不过这个"业务"的用户是公司内部的工程师而不是终端用户。

## 为什么选 AI Infra

我选 AI Infra 的理由可以分两层：**需求侧**——市场本身有强烈的成本优化诉求；**供给侧**——应用层工程师价值正在被 AI 稀释。两者叠加，构成了选这个方向的核心动机。

先说需求侧。**在 AI 应用开销极大的背景下，成本性能优化本身的价值比以往任何时候都大。** 模型 serving 的 GPU 成本、训练的算力和电费比传统软件高出几个量级——这种开销结构下，单 token 成本哪怕只压下几个百分点，对一家有规模的 AI 公司都是显著的盈亏差异。

尤其是等 AI 市场逐步走向红海，行业本身的增长跟不上成本的增大，光靠"开源"已经不够，还要狠狠地节流。这种环境下，成本性能优化会从"锦上添花"变成"生死线"，AI Infra 工程师的价值也会被进一步放大。

再说供给侧。**在 AI 时代，写应用类代码的工程师价值正在被快速稀释。**

我自己之前在工业界做过一段时间 Agent，体感是它和做前后端没拉开多大距离。

需要说明的是，我并不是要贬低 Agent，也不是说 Agent 就是在后端的基础上加一层模型 API 调用——实际上做 Agent 和做前后端要学的技术几乎完全不同。我说的"没拉开多大距离"，指的是**入门门槛和能构筑的壁垒在同一个数量级**，而不是"技术栈一样"。

可以拿前端和后端来类比：前端用 React、Vue，后端用 SpringBoot、Gin，技术栈几乎没有重叠，难度也不完全一样——后端要懂的东西通常比前端多一些。但这种差异是一个数量级以内的差异，没人会因此把后端摆在比前端"高一阶"的位置上。

Agent 和前后端的关系类似：要学的框架从 http、rpc 换成了 langchain、langgraph，要了解的中间件从 Redis、MySQL 换成了 MCP、Skills、Harness 等上下文工程；门槛确实又比后端高一些，但仍然在同一个数量级里。三者大致排成前端 < 后端 < Agent 的阶梯，但都属于"做应用"这条线——核心都是把具体业务跑通。

而把业务跑通这件事，目前 SOTA 的模型已经非常擅长，甚至比绝大多数初级工程师做得更好。即使有新概念出现，只要把文档塞进上下文，大概率也能跑出可用结果。

需要补充的是，任何方向做到最顶尖都是有壁垒的——最顶尖的前端、后端、Agent 工程师同样很难被 AI 替代。但在 AI 时代，门槛本身或许也是壁垒的一部分：门槛低的赛道，AI 追上从业者中位水平的速度更快，普通玩家被稀释得也越早。所以选方向时，不只是看天花板能到哪里，也要看下限是否够稳。

当然，Agent 工程也有它自己的硬骨头——eval 体系、不确定性管理、context engineering——这些是传统前后端没有的问题。把 Agent 完全等同于前后端会低估它。但从"什么样的工作会更快被 AI 替代"这个角度看，Agent 和前后端一起，都是更靠近应用层的那一侧。

相比之下，**底层优化目前还是模型不太擅长的领域**——至少暂时如此。算子自动生成、编译器自动调优 torch.compile、TVM auto-scheduler、AlphaTensor，甚至[直接用 LLM 直接写 CUDA kernel](https://cuda-agent.github.io/)，这些工作其实一直在推进，AI Infra 的护城河不是永久的。但它会比应用层晚一些被侵蚀，给我留出时间窗口。

## 门槛与技能栈

AI Infra 是个高门槛方向，几个维度都需要补齐：

- **编程语言**：算子 / 编译器 / kernel 那一支必须 C/C++ + CUDA / Triton。但**推理框架上层、调度系统、训练框架的 user-facing API 依然以 Python 为主**——vLLM、SGLang、Megatron 的上层都是 Python。Rust 在 AI Infra 现状下其实比较小众（candle、tch-rs 都不主流），不必为它专门花时间。对 Java、Python 起手的玩家来说，最大的挑战是 C++ 和 CUDA。
- **硬件认知**：GPU 架构（SM、warp、memory hierarchy、tensor core）、片间互联、显存模型，这部分纯软件出身的人确实需要重新学。
- **深度学习与 LLM**：至少要能讲清楚一个 token 是怎么生成的、attention 的计算流程、KV cache 在做什么。

门槛高的另一面是壁垒高。一旦入行，被替代的风险会比应用层小一些。

## 入门方向的选择

AI Infra 内部其实分支不少，入门方向选择影响后续的卷度：

- **推理引擎 + 算子**：最直接也最卷的路线。vLLM / SGLang 是热门，flash-attention 类的 toy project 已经成了 AI Infra 八股。
- **训练基础设施**：DeepSpeed / Megatron 调参、调度系统、checkpoint、容错。相对没那么拥挤，对工程能力的要求更全面。
- **Agent Runtime**：新兴方向，Anthropic 的 Harness / Skills、各家的 agent framework 都属于这一支。不强制要求 CUDA，对 Agent 工程有经验的人切入会比较顺。

我自己当前的 Roadmap 走的是第一条路线，主要是因为它和我感兴趣的"成本/性能优化"重叠度最高。但如果是从 Agent 那边过来想转 Infra，第三条路线可能更顺。

## 一个需要承认的风险

高门槛 = 高壁垒，但也 = **高集中度**。目前国内 AI Infra 的需求主要在头部几家——大模型公司（DeepSeek、月之暗面、智谱、阶跃、MiniMax）和大厂 Infra 团队（字节豆包、阿里通义、腾讯混元）。如果未来模型训练规模见顶，相关岗位会快速收敛到少数几家公司，机会反而比应用层更稀缺。

这是一个高方差选择：选对了路径 + 选对了公司，回报会比应用层好得多；但如果行业景气度下来，或者自己卡在了某个细分赛道里，路径会比应用层窄。值得选，但要明白在赌什么。

## 接下来做什么

先把规划好的 [AI Infra Roadmap](/posts/ai-infra-roadmap/) 走完，验证一下当前的判断。本系列后续每个阶段都会有一些笔记和实践记录。
