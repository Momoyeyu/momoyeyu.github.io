---
title: 推理引擎入门
date: 2026-11-23
description: 用 nano-vLLM 走一遍请求从输入到输出的过程，认识推理引擎中的调度、KV 缓存、模型执行与采样。
tags: [nano-vLLM, 推理, KV Cache, CUDA]
category: AI Infra
episode: 10
draft: true
lang: zh_CN
---

# 前言

本文用 [nano-vLLM](https://github.com/GeeeekExplorer/nano-vllm) 走一遍最基本的推理流程。模型已经装进显卡，两条提示词进来之后，怎样一步步变成两条回答？

单看模型，答案是反复做前向，每次预测下一枚 token。但两条请求的输入长度不同，生成也不会同时结束。程序要决定这一轮算谁、把算过的历史存在哪、哪条结束后该归还显存。这些工作合在一起，就是推理引擎。

nano-vLLM 把这些工作拆成了几块容易顺着读的代码。本文以提交 [`bb823b3`](https://github.com/GeeeekExplorer/nano-vllm/tree/bb823b3e06983d71485a8e1f23715ebd87d98ef8) 为例，沿着两条请求走完调度、缓存、前向和采样。

# 整体架构

![房子式总览：顶层处理请求和初始化，CPU 层负责调度与 KV 块管理，执行层负责准备张量、跑模型和采样，底层提供图重放和张量并行](/img/posts/ai-infra-inference-engine/overview.svg)

从屋顶往下读。用户通过 `LLM.generate()` 提交提示词和采样参数，`LLMEngine` 把它们变成序列，再一轮轮推进。启动时还要装模型、划显存，这条路径只在开始时走一次。

中间两层最重要。**调度器回答「算谁」，缓存管理器回答「历史在哪」，执行器和模型回答「怎么算」。** 调度器选一批序列，块管理器提供每条序列的缓存地址。执行器把 Python 对象整理成 GPU 要的张量，模型做前向，采样器选出候选 token。候选再交回调度器，更新序列状态。

最底下两项是运行时机制。CUDA Graph 减少反复启动 GPU 算子的开销，张量并行把同一层的计算拆到多张卡上。理解单卡的一轮推理之后，再回来看它们各改了什么。

# 请求与主循环

![请求从提示词变成 Sequence 进入等待队列，反复调度、执行、回写，最后按输入顺序返回](/img/posts/ai-infra-inference-engine/engine-loop.svg)

假设一次提交 A、B 两条请求。文本先被 tokenizer 编成 token ID，已经是 ID 的输入可以直接用。每条请求封成一个 `Sequence`，它记着输入和生成的 token、已有多少位置算完了 KV，以及这些 KV 对应哪些物理块。

[引擎的主循环](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/llm_engine.py#L43-L90)每次调用 `step()`。一步里先 `schedule()`，再让 `ModelRunner` 执行，最后 `postprocess()`。结束的请求先收进结果表，等两个队列都空了，再按请求序号解码文本。B 即使比 A 先结束，返回列表仍是 A 在前、B 在后。

# 启动与装载

![每张卡先加载本地权重并预热，再根据显存预算分配 KV 池，按配置选择是否捕获解码图](/img/posts/ai-infra-inference-engine/startup.svg)

第一条请求入队前，[ModelRunner](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/model_runner.py#L17-L39) 已经读好模型配置、建好 Qwen3 并从本地 safetensors 装入权重。装载时，原来分别保存的 Q、K、V 权重会填进同一份融合参数，前向时可以用一次投影算出来。

接着用假序列跑一轮 prefill 预热，记录前向的显存峰值。剩余预算用来预分配 KV 池。一个块要给每层存 K 和 V，它的大小由层数、块内位置数、当前 GPU 上的 KV 头数、头维度和数据类型决定。块池一次建好，后续请求领到的是块编号。

# 批次调度

![四轮调度示例：长请求 A 拆成两轮 prefill，随后处理短请求 B，最后两条请求一起 decode](/img/posts/ai-infra-inference-engine/scheduler.svg)

先认识推理的两个阶段。**Prefill** 处理提示词，建立历史缓存，并在输入算完时拿到第一枚输出。**Decode** 把上一轮刚生成的 token 再送进去，沿着已有历史预测下一个。前者一条请求可以送很多 token，后者一轮给每条请求送一个。

[调度器](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/scheduler.py#L25-L79)维护两条队列。需要处理输入的请求在 `waiting`，可以继续生成的请求在 `running`。每轮先从等待队列取任务，能安排 prefill 就跑这一批，这一轮不混入 decode。

图里 A 有 5 个输入 token，B 有 2 个，prefill 每轮最多算 3 个。第一轮算 A 的前 3 个，第二轮补完 A 的后 2 个。虽然第二轮还剩 1 个位置，但这一版只允许把本批的第一条请求拆块，B 要再等一轮。第三轮处理 B，第四轮把 A、B 放到同一批做 decode。

生成到块边界时，调度器还得为新 token 找一块空间。如果空闲块不够，就从运行队列末尾抢占序列，释放其缓存引用，让它回到等待队列。被抢占请求的 token 还在，之后重新进入时，用能命中的块接着算，再补上缺失的 KV。

# KV 块管理

![两条序列的逻辑块表指向同一个前缀块和各自的尾块，写入地址由物理块号和块内偏移共同决定](/img/posts/ai-infra-inference-engine/kv-blocks.svg)

KV 缓存是模型留给后续 token 阅读的历史。想象有两条请求都以同一份说明书开头，后面的提问不同。如果说明书已经被模型算过一次，两条请求就可以共用这一段历史的 K 和 V。

[BlockManager](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/block_manager.py#L28-L120)在 CPU 管块编号和引用数，真正的张量在 GPU。每条序列的块表把自己的第几个逻辑块映射到块池里的物理块，连续的上下文不需要占用连续的物理块。图里每块画 4 个位置，实际默认是 256。物理块号乘以块大小，再加块内偏移，就是这一枚 token 的写入槽位。

只有完整算过的块才登记哈希。哈希串上前一块的哈希，再核对当前块的 token，从开头连续命中才复用。这版总会重新处理序列的最后一块，留出前向来预测下一枚 token。图里 A 和 B 的块表同时指向块 7，所以 GPU 只留一份前缀。最后一个使用者离开后，块回到空闲队列。只要还没被重新分配和覆盖，它仍有机会被下一个请求命中。

# 张量准备

![Prefill 把不同长度的输入片段拼成一条张量并保留边界，decode 每条序列只传最后一个 token 与历史地址](/img/posts/ai-infra-inference-engine/prepare-batch.svg)

调度器给的是序列列表，GPU 要的是可以批量处理的张量。[ModelRunner](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/model_runner.py#L129-L188)负责这层转换。

换一组形状更清楚的例子。某轮 prefill 给 A 算 3 个新位置，给 B 算 2 个，执行器把它们拼成长度为 5 的输入。边界 `[0, 3, 5]` 告诉注意力从哪里切开。假如 A 已经缓存 4 个位置，那么 A 的 query 仍只有 3 个，但可读的 K/V 段长度是 7。B 从头算，段长度是 2。于是 K 的边界是 `[0, 7, 9]`。

Decode 简单一些，每条序列只送上一轮生成的最后一个 token，再带上它的位置、历史长度和块表。两条路径都要准备 `slot_mapping`，告诉注意力层本轮产生的 K/V 应当写到哪一格。

# 模型与注意力

![每层先生成 QKV 并写入新缓存，再按 prefill 或 decode 选择历史读取路径](/img/posts/ai-infra-inference-engine/attention.svg)

输入到 GPU 之后进入 [Qwen3 Decoder](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/models/qwen3.py#L72-L183)。每层投影出 Q、K、V，给 Q 和 K 加上位置编码，然后用注意力读历史。随后经过输出投影和 MLP，把新表示交给下一层。

[注意力层](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/layers/attention.py#L10-L75)先用一个 Triton kernel 按槽位写入本轮的 K/V，再分两条路。首次 prefill 可以直接用这轮算出来的 K/V。若这次接着旧前缀算，则需要通过块表读取缓存。Decode 直接走 KV cache 的 FlashAttention 接口，从每条序列自己的历史里取数据。

这也解释了为什么继续生成时，程序只送一个 token。当前层只需要算这个新位置的 Q、K、V。历史 K/V 已经算过，按地址读回来就行。

# 采样与提交

![词表打分和采样先产出候选，调度器根据输入进度决定是否提交，并在结束时归还块](/img/posts/ai-infra-inference-engine/sampling.svg)

模型最后给出词表分数，也就是 logits。Prefill 时，[LM Head](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/layers/embed_head.py#L56-L66)只取每条片段的最后一行。采样器用每条请求自己的温度调整分布，为它选出一个候选 token。

这里有一个容易看漏的区别：**采样出来，不等于加入输出。** A 的第一段只处理了 3 个输入 token，这时执行器也会返回候选，但 [postprocess](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/scheduler.py#L81-L92) 只推进缓存进度。到了第二轮，A 的输入补齐，才把候选追加成第一枚输出。Decode 每轮正常追加，遇到启用的 EOS 或达到生成上限，就结束请求并释放块。

# 生成实测

把前面的一长一短两条请求放到 `ms33` 上跑一遍。模型用 Qwen3-0.6B，单张 RTX 4090，执行器走 eager 路径。A 的输入长 300 个 token，B 长 268 个，前 256 个完全相同，刚好占一个 KV 块。把每轮 prefill 的预算设成 192 个 token，A 和 B 分别生成 3 个和 2 个 token。

| 轮次 | 阶段 | 本轮送入模型的 token 数 | 累计已提交输出 A / B | 轮末状态 |
| --- | --- | --- | --- | --- |
| 1 | Prefill | A：192 | 0 / 0 | A 仍在等待队列 |
| 2 | Prefill | A：108 | 1 / 0 | A 进入运行队列 |
| 3 | Prefill | B：12 | 1 / 1 | B 命中前缀，进入运行队列 |
| 4 | Decode | A：1，B：1 | 2 / 2 | B 结束，A 继续 |
| 5 | Decode | A：1 | 3 / 2 | A 结束 |

第一轮模型返回了候选 token，但 A 的输入还没处理完，输出数依然是 0。第二轮补完后，A 的第一个块可以复用。第三轮 B 的块表直接指向 A 的前缀块，只送入自己的 12 个尾部 token。第四轮 B 结束后，共享块的引用数从 2 降回 1，A 下一轮还能继续读它。

再用一个新引擎单独跑同样的 B。空缓存下，B 分两轮 prefill，分别处理 192 和 76 个 token。排在 A 后面时，B 一轮只处理 12 个。少算的 **256 个 token**，就是前面块表里那一个共享前缀块。

# CUDA Graph

![直接前向与图重放是两条执行路径，图重放把本轮数据填进固定缓冲区，再重复启动同一套模型操作](/img/posts/ai-infra-inference-engine/cuda-graph.svg)

Decode 的计算步骤高度重复：每一轮都要启动一串 GPU 算子。nano-vLLM [提前捕获](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/model_runner.py#L222-L257)几种批量大小的模型前向。假设这轮有 3 条序列，就选能容纳它们的 4 槽图，把 token 和地址写进固定缓冲区，再重放。填充槽位标成 `-1`，写缓存时跳过。

[路径选择](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/engine/model_runner.py#L195-L212)在执行器里。Prefill、强制 eager 或批量超过 512 时直接前向。图重放只包住模型前向，词表投影和采样仍在图外。

# 张量并行

![主进程将同一批任务通知其他 rank，各 GPU 计算权重分片，通过 NCCL 聚合，最终在 rank 0 采样](/img/posts/ai-infra-inference-engine/tensor-parallel.svg)

有两张 GPU 时，每张卡都是一个 rank，各自装一部分模型权重。这里的分法是**同一个 batch 的同一层，两张卡合起来算**。主进程管理队列，用共享内存写下要执行的调用和序列元数据，再用事件通知其他 rank 开工。

算到需要合并的地方，通过 [NCCL 集合通信](https://github.com/GeeeekExplorer/nano-vllm/blob/bb823b3e06983d71485a8e1f23715ebd87d98ef8/nanovllm/layers/linear.py#L152-L156)聚合张量。最后，每张卡只持有自己的词表分片分数，把它们收集到 rank 0 拼成完整 logits，采样和提交仍回到原来的引擎循环。

# 结语

第一次读推理引擎，可以只盯住这三个东西：**队列、块表、下一枚 token**。队列决定谁能推进，块表给出模型读写历史的地址，下一枚 token 既是本轮结果，也是后续 decode 的输入。

想从源码里走一遍，先开 `LLMEngine.step()`，跟进去看 `Scheduler.schedule()`，再顺着 batch 看到 `ModelRunner.run()`。把选出来的序列、读写的地址和回传的 token 对上，就能把架构图里的模块连回一次真实的生成。以后单独看 FlashAttention，可以从这里留下的问题接着读：当前的 query 拿到历史 K/V 后，GPU 怎样把注意力算出来？

# 参考资料

- https://github.com/GeeeekExplorer/nano-vllm
