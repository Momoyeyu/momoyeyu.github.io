---
title: GPU 访存延迟
published: 2026-05-20
description: '从 Grid-Stride Loop 入手，解释 warp 切换、SM 并发与 L1/L2 cache 对 GPU 访存延迟的影响，并复盘一次向量化反而变慢的原因。'
tags: [AI Infra, CUDA, GPU]
category: AI Infra
image: '/img/cover3.jpg'
draft: false
lang: 'zh_CN'
---

最近看了杜子源学长的 [`CUDA学习之路[5]——逐元素操作算子`](https://dlog.com.cn/posts/cuda05/element_wise/)（下称 dlog），产生了一些疑问，本文记录一下思考。

## 什么是访存延迟

所谓访存延迟，本质上就是一次内存访问从发起到数据真正返回之间的等待时间。对 GPU 来说，这段等待往往出现在访问全局内存的时候，而不是寄存器、[`shared memory`](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#gpu-hardware-model) 这种更近的层次。

而当我看到 dlog 在隐藏访存延迟的 section 中提到 `Grid-Stride Loop` 时，我并没有理解。因为我觉得这几种方法看起来要读的数据量都是一样的，在带宽吃满的情况下理论上应该没有区别，那么为什么会说这种策略可以隐藏访存延迟呢？为了探明答案，我思考了以下几个子问题：

- GPU 会不会把待处理的 `N` 个元素一次性 load 到 cache 中？
  - 答案当然是不会，因为 GPU 的 cache 是有限的，无法把所有数据都一次性放进去。
- 如果没有一次性 load，线程进入下一轮循环时，难道不会再次遇到访存延迟吗？
  - 答案通常是会，因为下一轮循环访问的元素很可能不在 cache 中。
- 既然每一轮都还是要读显存，那 `stride` 到底帮了什么？
  - 答案是对同一个线程进行复用，并且通过循环理论上可以支持无限大的数据量。

然而，这些问答依旧没有帮助我真正理解 `Grid-Stride Loop` 的作用。因为要读的数据量没有变，要读的次数看起来也没有变化，访存延迟究竟是在哪个环节隐藏的呢？

把 GPU 比做一个工厂来解释会更好理解：

- 一个工厂对应 GPU 本身
- 一个工厂有多个厂房，每个厂房对应了 GPU 的 [`SM`](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#gpu-hardware-model)
- 每个厂房里同时驻留多个工人小队，每个小队对应了一个 [`warp`](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#warps-and-simt)
- 每个小队由固定数量的工人组成，对应每个 warp 由固定数量的 thread 组成
- 厂房的“工位”在不同时间给不同小队使用，对应 SM 在不同时间调度不同 warp
- 小队在开工前需要把原材料搬到手边，对应 warp 发起 load 等待内存返回数据

![访存延迟隐藏（工厂类比动画）](/img/posts/gpu-mem-latency/factory-latency.svg)

如果沿着这个类比继续往下说，那所谓访存延迟，指的就是小队已经拿到了工位，但原材料还没搬到手边，所以只能等待搬运的那段时间。放到 GPU 上，就是 warp 发起一次 load 之后，到数据真正返回之前的等待时间。

`Grid-Stride Loop` 并不会让某一次访存变快，它更像是在改变“开工方式”：

- 让同一批 thread 在循环里反复处理多个元素，而不是处理一个元素就结束
- 当某个 warp 因为等待内存而 stall 时，SM 可以切换到另一个已经 ready 的 warp 继续执行

这就好比现实世界里工厂会安排两班倒、三班倒：不是让“搬原料”这件事更快，而是让厂房尽量不空转。

### 延迟藏到哪里去了

换句话说，这里的“隐藏”并不是延迟消失了，而是等待内存的这段时间被其他 warp 的执行覆盖掉了。

所以 `Grid-Stride Loop` 真正解决的不是“某一次访存太慢”，而是“一个 warp 在等数据的时候，SM 能不能还有别的活可干”。如果答案是可以，那么从外面看就像这段等待被隐藏起来了。

### 为什么这里一定要有 SM

如果只盯着“线程”这个抽象，很容易想不通调度是怎么发生的。后来我觉得必须引入一个更重要的概念：**工作区，也就是 [SM](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#gpu-hardware-model)**。

在 CUDA 里，更接近真实硬件的分层是：

- `thread`：最小执行单元
- `warp`：32 个线程组成的调度基本单位
- `block`：一组线程的组织单位，会被分配到某个 SM
- `SM`：真正执行 warp、容纳 block、进行调度的工作区
- `grid`：这次 kernel launch 的全部 block 集合

为什么会有多个 warp 之间切换？因为同一个 SM 上本来就会驻留多个 warp。

当某个 warp 发起一次全局内存读取时，它可能需要等待比较久。这时：

- 调度器不会傻等这个 warp
- 而是立刻切到同一个 SM 上另一个 ready 的 warp
- 等绕一圈回来时，前一个 warp 的数据可能已经到了

所以多个 warp 之间切换，不是因为 `Grid-Stride Loop` 临时创造了更多 warp，而是因为：

- GPU 本来就支持一个 SM 上同时驻留多个 warp
- 访存延迟又很长
- 所以必须靠 warp 轮换来填平空档

### 为什么启动参数不是照着 N 开

刚学 CUDA 时，很自然会把启动参数理解成：

- 我有 `N` 个元素
- 每个 block 256 个线程
- 那就开 `ceil(N / 256)` 个 block

这个写法功能上当然没问题，但它体现的是一种“每个线程先只管一个元素”的思路。

而 `Grid-Stride Loop` 对应的思路是：

- 不需要一次性为全部 `N` 个元素都配好线程
- 只要先让每个 SM 上有足够多的 warp 可切换
- 剩下的数据交给同一批线程在循环里继续处理

于是调参的关注点会从“覆盖全部元素”，变成“喂饱硬件并发能力”：

```cpp
int threadsPerBlock = 256;
int blocksPerGrid = k * num_sms;
```

这里 `k` 常取 `2`、`4`、`8`。更准确地说，通常是 block 数量按 SM 数的倍数去选，而不是“线程数量是 SM 的倍数”。

## cache 在这里起什么作用

前面那一部分讲的是“等待是怎么被覆盖掉的”，但这还没有回答另一个问题：数据在回来之前，究竟会经过哪些层次？不同 warp 之间的访存到底是彼此独立，还是会互相影响？

![GPU 内存层次结构示意](/img/posts/gpu-mem-latency/gpu-cache-hierarchy.svg)

### 访存请求是各走各的吗

这个问题如果只用“独立/不独立”二选一来答，其实容易答歪。

更准确的说法是：

- 不同 warp 的访存请求，是各自独立发起的
- 但它们并不是各自独占一套 cache 和带宽
- 它们会在内存层次结构里共享资源，也会互相影响

所以一个更合适的描述是：

- 逻辑上独立发起
- 物理上共享 [`memory hierarchy`](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#memory-hierarchy)

### L1 和 L2 到底在帮什么

用纯 GPU 术语来讲：

- 同一个 SM 上的多个 warp，共享这个 SM 的访存通路和 `L1`
- 不同 SM 上的 warp，不共享 `L1`
- 但整个 GPU 上所有 SM 都共享 `L2`
- 再往下则共享显存带宽

如果继续沿用前面的工厂类比，也可以这样理解：

- `L1` 更像是车间门口的小料架，离 SM 更近，拿起来更快
- `L2` 更像是整个工厂共用的中转仓，容量更大，但距离也更远
- 真正的显存则像总仓库，最远，也最慢

所以 cache 命中解决的是“数据是不是已经在更近的地方”，而 warp 切换解决的是“当前这个 warp 等数据时，SM 会不会闲着”。这两件事都和访存延迟有关，但不是同一层面的机制。

换句话说，前面第一部分讲的是“为什么 GPU 不会傻等”，这一部分讲的是“数据为什么有时候回来得快一点，有时候回来得慢一点”。

## 为什么向量化反而更慢？

### benchmark 里发生了什么

dlog 文章里的 benchmark 结果大概是：

```text
Version 1: 1.83 ms  439.53 GB/s
Version 2: 1.83 ms  439.31 GB/s
Version 3: 1.96 ms  411.71 GB/s
```

这里最容易让人疑惑的是：`Version 3` 明明用了 `float4` 向量化，看起来更“高级”，为什么反而更慢？

如果把前面两部分的心智模型带回来，其实这个结果反而更容易理解：`vector add` 这种 kernel 本来就非常简单，很多时候瓶颈不在算力，而在显存带宽和访存等待。也就是说，`v1/v2` 可能已经把能吃到的主要收益吃得差不多了。

### `float4` 为什么没有想象中那么赚

我目前比较接受的解释是：

- 这个 `vector add` 本来就是非常典型的带宽受限算子
- `Version 1/2` 在这台机器上已经把主要瓶颈吃得差不多了
- `Version 3` 没有真正减少总的搬运成本
- 却额外引入了寄存器压力和实现开销
- 于是收益没吃到，副作用先出现了

所以这部分最值得记住的结论不是“`float4` 没用”，而是：**更高级的写法不一定更快，关键要看它有没有真的击中当前瓶颈。**

## References

- 杜子源，《[CUDA学习之路[5]——逐元素操作算子](https://dlog.com.cn/posts/cuda05/element_wise/)》
- NVIDIA，《[CUDA Programming Guide - Programming Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html)》
- NVIDIA，《[CUDA Programming Guide - GPU Hardware Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#gpu-hardware-model)》
- NVIDIA，《[CUDA Programming Guide - Warps and SIMT](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#warps-and-simt)》
- NVIDIA，《[CUDA C++ Programming Guide - Memory Hierarchy](https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html#memory-hierarchy)》
