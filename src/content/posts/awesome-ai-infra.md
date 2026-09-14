---
title: Awesome AI Infra
date: 2026-05-09
description: '搜集的 AI Infra 相关 GitHub 资源，持续更新中。'
tags: [AI Infra, LLM, CUDA]
category: AI Infra
episode: 2
draft: false
image: '/img/posts/awesome-ai-infra/cover.webp'
lang: 'zh_CN'
---

搜集的一些 AI Infra 相关 GitHub 资源，按主题分类。不少是从[子源学长的 Awesome Infra](https://dlog.com.cn/posts/awesomeinfra/awesome/) 那里借鉴的，也有一些自己找的，不一定每个都看过，持续更新中。配上这篇博文的 [AI Infra Roadmap](/posts/ai-infra-roadmap/) 来看会更顺。

## 体系教程

想先建立全局视角，从这两个仓库入手：

- [HuaizhengZhang/AI-Infra-from-Zero-to-Hero](https://github.com/HuaizhengZhang/AI-Infra-from-Zero-to-Hero)：系统视角，从零开始覆盖整个领域。
- [ai-infra-curriculum](https://github.com/ai-infra-curriculum)：一份课程化的学习路线图。
- [AIInfraGuide](https://caomaolufei.github.io/AIInfraGuide/)：偏导航型的 AI Infra 学习指南，适合用来快速建立领域地图。

## CUDA 教程

绕不开的底层。先有 CUDA 心智模型，再看上层的训练 / 推理框架会顺很多：

- [BBuf/how-to-optim-algorithm-in-cuda](https://github.com/BBuf/how-to-optim-algorithm-in-cuda)：算子优化经典，很多人入门 CUDA 优化都看这个。
- [eunomia-bpf/basic-cuda-tutorial](https://github.com/eunomia-bpf/basic-cuda-tutorial)：基础入门。
- [brucefan1983/CUDA-Programming](https://github.com/brucefan1983/CUDA-Programming)：相对系统的程序设计教材。

## 分布式

- [ray-project/ray](https://github.com/ray-project/ray)：分布式计算框架的事实标准之一，做 LLM 训练 / 推理调度都绕不开。

## 精简实现

读源码学不动的时候，找一个把核心抽出来、去掉所有工程细节的 mini 实现，往往比啃完整框架快很多。我个人觉得这一栏的几个仓库最值得花时间：

- [GeeeekExplorer/nano-vllm](https://github.com/GeeeekExplorer/nano-vllm)：极简 vLLM。
- [keith2018/TinyTorch](https://github.com/keith2018/TinyTorch)：微缩 PyTorch。
- [kennysong/minigrad](https://github.com/kennysong/minigrad)：极简自动求导。
- [66RING/tiny-flash-attention](https://github.com/66RING/tiny-flash-attention)：极简 FlashAttention 实现。
- [Tongkaio/CUDA_Kernel_Samples](https://github.com/Tongkaio/CUDA_Kernel_Samples)：CUDA 算子样例集。

后面继续看到顺手的资源会回来补到这里。
