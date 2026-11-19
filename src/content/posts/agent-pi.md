---
title: How Pi Works
date: 2026-11-17
updated: 2026-11-19
description: 从源码拆解 Pi 的整体架构：五种入口共享的 AgentSession、双层 Agent Loop、工具执行 Pipeline、Compaction 与会话树，用六张图讲清这个极简编程 Agent 如何工作。
tags: [Agent, Pi, Harness, 架构]
category: Agent
episode: 1
draft: false
lang: zh_CN
---

# 前言

[Pi](https://github.com/earendil-works/pi) 是一个极简、可扩展的终端 AI 编码 Agent。说它极简，是因为核心只做一件事：把用户输入、模型流式响应和工具执行组织成一个循环；说它可扩展，是因为 MCP、代码执行、工具搜索这些能力全部以扩展的形式挂进同一个运行时，而不是写死在核心里。

本文参考 [main 分支](https://github.com/earendil-works/pi) 的 `1f6f319`，对应 v1.5.2 之后的代码，CLI 包为 `@earendil-works/pi-coding-agent@1.5.2`。依据是源码和官方文档 [how-pi-works](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/how-pi-works.md) 与 [compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)，把最重要的机制画成六张图：一张整体架构，四张核心流程，外加一张记忆通道图。

上一篇 [Super-agent](../agent-super-agent/) 讲的是多任务下如何重新组织会话，Pi 恰好是另一个极端的样本：单机、单入口、极简核心。对照着看，更能看清一个编程 Agent 哪些部分必不可少，哪些部分可以留给扩展。

# 整体架构

![Pi 整体架构：五种入口共享 AgentSession，核心层装配会话、压缩、提示词与工具，下层是 agent loop 与统一模型层，底部是本地持久化](/img/posts/agent-pi/arch-overview.svg)

图的读法是从上到下。最上面是五种入口：交互式 TUI、单次执行的 Print、输出事件流的 JSON、供外部程序驱动的 RPC，以及 TypeScript SDK。它们只做 I/O 适配，解析完参数后统一调用 `createAgentSession`，业务行为完全一致，因为背后都是同一个 `AgentSession`。

`AgentSession` 是唯一的编排核心，负责会话编排、事件订阅与持久化、模型与 thinking 档位切换。它身边挂着几块职责单一的部件：`SessionManager` 维护 JSONL 会话树，`Compaction` 处理上下文压缩，`System Prompt` 拼装基础指令与 AGENTS.md、Skills，`ModelRuntime` 解析认证与模型目录。默认提供 read、bash、edit、write 等八个内置工具，MCP、codemode 这类能力则由 `ExtensionRunner` 以扩展形式装载，和用户自己写的扩展走同一条路径。

每轮对话委托给下层 `pi-agent-core` 的 agent loop，模型调用统一经过 `pi-ai` 这一层，五十多家 provider 共用同一个 `streamFn` 接口。所有工具与扩展都跑在 Pi 进程自己的 OS 权限里，项目设置在加载之前先过信任决策，这是它的安全边界。图底部是本地持久化：`~/.pi/agent/` 下的会话文件、设置与凭据。

图中下部还有一排支撑库：`pi-tui` 是终端 UI 库，`pi-mcp` 是独立的 MCP 客户端，`pi-codemode` 提供只能调用注入工具的沙箱 JS。`chord` 则是跨进程对象运行时，apps 下的 p2、p3 等实验性应用建立在它之上，与 CLI 主线共享 pi-ai 等基础包。

把一次请求放进这张图：用户在 TUI 里输入问题，`AgentSession` 先把 user 消息追加进会话树，随后委托 runLoop；loop 每轮把上下文经 `streamFn` 发给模型，模型要求调工具时走工具执行管线，结果写回后继续下一轮。期间所有事件一边推给 TUI 渲染，一边由 `SessionManager` 追加到 JSONL。回复完成时会话文件里多了几条 entry，这就是一次请求的完整旅程。

# Agent Loop

![Agent Loop 双层循环：内层处理工具调用与 steering 消息，外层在空闲时注入 follow-up；右侧为一个 run 的完整事件序列](/img/posts/agent-pi/agent-loop.svg)

Loop 是一个双层循环。内层每轮先做 `prepareNextTurn`，处理自动压缩、收取用户在 Agent 工作时插入的 steering 消息，然后把上下文流式发给模型；模型若要求调用工具，就执行工具并把结果写回，进入下一轮。外层只在 Agent 即将停下时检查 follow-up 队列，把排队的新任务注入进来。

steering 与 follow-up 的区分很实用：前者是打断式引导，当前 turn 一结束就生效；后者是排队任务，等 Agent 彻底无事可做才注入。中止运行时，队列里的消息会退回编辑器，不会凭空消失。

图中有两处值得停下来看。一是 `stopReason === "length"` 的保护：输出被长度截断时，流式拼出的工具参数可能不完整，整批 toolCall 直接合成错误结果让模型重发，绝不执行。二是工具声明本身也是系统消息：每轮用 `declareToolChanges` 把工具增删写进上下文，扩展中途注册或移除工具，对模型始终一致。模型出错或被中止时 run 直接结束，重试与压缩恢复的决策留在上层，loop 自己保持简单。

loop 也不直接和终端、文件打交道。它把每一步进展封装成 AgentEvent 事件流依次外发：消息开始、流式更新、工具执行、turn 结束。TUI 拿它渲染界面，JSON 与 RPC 模式拿它输出，SessionManager 拿它落盘。同一份事件流，三种消费者。

# Pipeline

![工具执行管线：参数预处理与 schema 校验，beforeToolCall 钩子拦截，顺序或并行执行，afterToolCall 改写结果，最终生成 ToolResultMessage](/img/posts/agent-pi/tool-pipeline.svg)

模型发出的每个 toolCall 都走同一条管线。先检查 `stopReason`：如果是 length，说明流式参数可能被截断，整批合成错误结果，一个也不执行；否则进入 `prepareToolCall`，先做参数预处理，再按工具的 schema 校验。校验通过，才轮到 `beforeToolCall` 钩子，然后是执行与 `afterToolCall` 钩子，最后生成 ToolResultMessage 写回上下文。

这条管线的价值在钩子上。`beforeToolCall` 可以返回 block 直接拦截任意工具，权限控制、审计、自定义确认都在这里实现，MCP 工具、内置工具一视同仁；`afterToolCall` 可以改写结果内容或标记错误。codemode 脚本里嵌套调用工具时，复用的也是同一条管线，钩子一个不少。

执行默认并行，结果按声明顺序落盘；配置了顺序执行或任一工具声明顺序模式时，整批转顺序。中止信号到达时，未完成的调用统一记为 Operation aborted，不留孤儿调用。管线外围还挂着执行事件：`tool_execution_start` 在参数准备之前发出，执行中的 `tool_execution_update` 携带部分结果，bash 的流式输出就靠它传到前台。

# Compaction

![Compaction 流程：阈值、手动、溢出三种触发，选定切割点后由 LLM 生成结构化摘要，追加 CompactionEntry，原文保留在会话树中](/img/posts/agent-pi/compaction.svg)

上下文接近窗口上限时，Pi 把旧消息交给 LLM 做结构化摘要，之后改用「系统提示 + 摘要 + 切割点之后的原文」继续对话。触发有三条路：上下文 token 超过窗口减去预留值时自动触发，用户手动 `/compact`，以及 provider 报溢出或输出被截断时做一次性压缩重试。

两个细节决定了摘要的质量。切割点只能落在 user、assistant、bash 这类消息上，绝不切在 toolResult 中间，否则工具调用会残缺；单个 user span 超预算时还会拆成历史摘要与前缀摘要两份再合并。摘要本身是固定结构：目标、进展、关键决策、下一步、关键上下文，外加一份跨压缩累积的已读与已改文件清单，重复压缩时把上次摘要一并传入迭代。

最容易误解的一点是：压缩不是删除。原始 entry 全部留在会话树里，`CompactionEntry` 只是追加的一个节点；「忘记」发生在读取时的投影，导出、计费、回溯都还能看见原文。

检查时机也不止阈值一处：多轮 run 中，工具批次完成后、下一个 assistant 响应前会检查一次，新 prompt 进来和 run 结束时同样会检查。`reserveTokens` 与 `keepRecentTokens` 可以按模型分别覆盖，分支摘要复用同一套结构化格式与钩子。

# Session 与 Memory

![Session：JSONL 会话树以 parentId 连接，读路径从 leaf 回溯经投影转为 LLM 消息，写路径把 agent 事件追加到会话文件](/img/posts/agent-pi/session.svg)

Pi 没有独立的 memory 模块，它的「记忆」就是会话树。每个 entry 记录 `parentId`，连成一棵 append-only 的树；从任何一条旧 entry 继续对话就产生新分支，`/tree` 可以跳转，fork 与 clone 才把历史复制进新文件。

读路径从当前 leaf 回溯出活动分支，经投影应用 `context_edit` 的省略与替换，再转成 LLM 消息；写路径挂在事件流上，每条消息结束时由 `AgentSession` 自动追加到 JSONL。压缩摘要、系统提示词、模型切换记录，全都是树上的普通 entry。

`context_edit` 值得单独一提：溢出恢复或扩展可以对历史做省略与替换，原始内容仍留在文件里，导出、计费、搜索都看得见。系统提示词与工具声明也作为 entry 存在树上，压缩时随快照保存，回放时保持一致。

![Memory：AGENTS.md、Skills 按需加载、压缩摘要迭代、恢复与分支四条长期记忆通道](/img/posts/agent-pi/memory.svg)

长期记忆由四条通道拼成：AGENTS.md 提供项目指令，Skills 按名称与描述进系统提示词、命中任务时才读取全文，压缩摘要跨轮次滚动传递目标与文件清单，恢复与分支机制让几天前的会话能被重新找到。没有哪一条是数据库，全部是文件加约定。

# 设计取舍

把六张图放在一起，Pi 的取舍很清楚。单一编排核心保证五种入口行为一致，代价是所有功能都要挤进 `AgentSession` 这一个编排点。进程内扩展换来了极低的接入成本，代价是信任边界必须前置到加载之前。append-only 会话树让「忘记」变成可回溯的投影而不是删除，代价是投影逻辑必须处处小心。极简核心则明确把权限确认、自定义工具、记忆策略都留给扩展，而不是内置答案。

# 结语

Pi 证明了一个编程 Agent 的最小内核可以很小：一个编排会话、一个双层循环、一条工具管线、一套压缩机制、一棵会话树。剩下的能力，要么来自模型本身，要么来自扩展。理解了这六张图，也就拿到了读懂它源码的地图。

# 参考资料

- https://github.com/earendil-works/pi
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/how-pi-works.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md
- https://www.npmjs.com/package/@earendil-works/pi-coding-agent
