---
title: '打开 Vibe Coding 的黑盒'
date: 2026-09-19
updated: 2026-10-11
description: '开源 Agent Skill：先与人对齐成人确认过的 target，在隔离分支里迭代，最后交付一份你能自己复验的证据包。'
tags: [Agent, 开源]
category: 项目
episode: 2
draft: false
image: 'https://cdn.jsdelivr.net/gh/Momoyeyu/autodev@3c8f4ec9c3d75224d3bbd41589de1995d38894f9/docs/assets/autodev-brand.png'
lang: 'zh_CN'
---

![autodev 三步走：Clarify 对齐、Loop 迭代、Handoff 交付](https://cdn.jsdelivr.net/gh/Momoyeyu/autodev@3c8f4ec9c3d75224d3bbd41589de1995d38894f9/docs/assets/autodev-overview.zh.png)

你说「加上 CSV 导出」，Agent 说「做完了」。你说「把首页调快点」，Agent 说「快多了」。

中间发生了什么？不知道。改了哪些文件、为什么这么改、验证过没有，你手里只有这两句话。Vibe Coding 把写代码变成了黑盒：需求进去，结论出来，过程不可见。

[**autodev**](https://github.com/Momoyeyu/autodev) 就是为打开这个黑盒写的 Agent Skill，仓库简介现在是 **Open the black box of vibe coding**。它的定位能压成一句话：**以 clarify 为核心的 Agent Skill，先与人对齐，在共识内执行，再交付直观的证据。**

> **三个阶段：Clarify · 对齐 → Loop · 迭代 → Handoff · 交付。**
>
> 功能开发交付竣工架构图与流程图，问题修复交付全绿的测试用例组，性能优化交付一张实测过程图。

它面向功能开发、问题修复与性能优化，任何能加载 `SKILL.md` 的 Agent 都能用，复用目标项目已有的工具。协议、保障项和两个真实案例都在[在线文档站](https://momoyeyu.github.io/autodev)上。

## 实战案例

README 里放了两份用这套流程真实跑出来的记录，图是 `autodev_render.py` 从实测数据画的。

**MoE Transformer，英译法翻译模型**，PyTorch 单卡 RTX 4090D。目标是 BLEU ≥ 28.87，取自 dense 模型的参照值；baseline 24.97；只允许修改 `src/train.py`，每次运行固定墙钟预算。为了定下改进余量，benchmark 先在**未改动的源码**上复跑了一遍，同一份代码两次成绩相差 0.62，余量因此定成 0.8。

31 次尝试、30 个思路标签、4 次被保留，最终达到 31.25，verify 复测 30.91。被留下的四个思路是 `top1-n4`、`batch-up`、`dropout-down`、`cosine-sched`。其余试过的 `torch.compile`、EMA、fused AdamW、以及容量与层数变体，测量结果全部低于余量，逐一回滚。

![MoE 优化的分数轨迹：31 次尝试、4 次保留、超过目标](https://cdn.jsdelivr.net/gh/Momoyeyu/autodev@3c8f4ec9c3d75224d3bbd41589de1995d38894f9/docs/assets/autodev-case-moe.svg)

**cann2026，rotary position embedding kernel**，AscendC，CANN 9.0。这次是对同一个 kernel 文件连续跑六轮，初始 baseline 是第 0 点，16 次尝试接着编号，分数从 19.7026 一路走到最终保留的 0.7168。虚线标的是最后一轮的目标 0.680，四轮达到各自目标，第 2、6 轮没达标。

第 6 轮里有 3 个思路测量低于保留阈值，还有 1 次尝试编译失败被判无效并回滚。最后保留的是连续 token 分块优化，拿到 0.7168。到 verify 复测那一步撞上了评测服务宕机，报告里记录的是宕机本身，而不是一个编出来的分数。

![cann2026 六轮连续优化轨迹：baseline 后接 16 次累计尝试，共用固定参考尺度](https://cdn.jsdelivr.net/gh/Momoyeyu/autodev@3c8f4ec9c3d75224d3bbd41589de1995d38894f9/docs/assets/autodev-case-cann2026.svg)

第二个案例值得多看两眼它的横轴。六轮的分数都是拿同一组固定参考耗时重算出来的，共用一条 y 轴，这样跨轮次才可比。跨轮比较得先统一尺子，这件事在这张图上比在文档里更容易看懂。

## 为什么要做 autodev

自然语言上的同意，不保证双方已经理解一致。

Agent 可能实现了错误的行为，改掉你希望保留的流程，或者优化了一个并不代表真实目标的数字。这种偏差要到交付那一刻才暴露，之前写的一切都是返工。

而且模型越强，这种偏差越难察觉。它一口气改十几个文件、跑完构建、顺手修掉报错，再给你一段流畅的总结，你读完还是不知道那个 feature 用起来什么样、优化到底快了多少。

autodev 要做的就是**确保 Agent 与人对齐，降低理解偏差，减少返工次数**。Clarify 发生在实现之前，把意图转化为人确认过的 **target**，也就是 blueprint、通过的那组 test，或者 benchmark 的目标值，再配上实测 baseline 和明确的边界。

它想提高的是产出的**质量、稳定性和综合效率**，以及你对项目的**理解和接管能力**。只有双方对目标达成共识，自主执行才有价值。

## Verifiable · Measurable · Visible

那份共识被拆成了三个词：

| 理念 | 含义 |
|---|---|
| **Verifiable · 易验证** | 确认后的 target、准确的命令和实际执行记录，让人能够复验结果 |
| **Measurable · 可度量** | baseline 与最终结果使用相同验收依据和可比较的条件 |
| **Visible · 够直观** | 功能开发以竣工架构图与流程图交付；问题修复以全绿的测试用例组交付；性能优化以一张实测过程图交付 |

它们是贯穿流程的要求，不是三个独立阶段。偏离真实意图的测试即使通过，或者用虚构数据画出漂亮的图，都不能证明成功。

## 工作流程：Clarify → Loop → Handoff

**User input → Clarify → Loop → Handoff。** 用户输入触发流程，三个阶段是共用的，具体规则按场景区分：

| 阶段 | 功能开发 | 问题修复 | 性能优化 |
|---|---|---|---|
| **Clarify · 对齐** | 绘制 as-is 图；起草 blueprint；提出修改范围；用户审阅整轮结果 | 准备可执行 test；记录 baseline；提出影响范围；用户审阅整轮结果 | 准备唯一的可执行 benchmark；记录 baseline；提出目标、可编辑文件和时间预算；用户审阅整轮结果 |
| **Loop · 迭代** | 实现 blueprint 的每个元素，直到竣工状态与之相符且回归检查通过 | 修复直到确认后的 test 全部通过 | 优化直到达标或时间耗尽 |
| **Handoff · 交付** | 按竣工状态绘制的架构图与流程图，与 blueprint 对照 | 全部通过的测试用例组 | 一张图，展示 baseline、优化尝试和最终结果 |

Clarify 不只是问问题。查代码、画图、维护测试、试运行和测量 baseline，都是建立共识的一部分。human-in-the-loop 的循环套在**整个 Clarify 阶段外层**：agent 跑完一轮，把 target 产物、baseline 和提出的范围一起端上来，你一次审阅全部结果，再决定退回修订还是进入 Loop。

Loop 负责实现共识，而不是边写代码边重新解释成功标准。它在独立的 git worktree 和专用分支上进行，不碰你自己现有的工作区；每次尝试都是一个 commit，优化中被拒绝的尝试直接 reset 回最佳 commit，Handoff 时才把分支合并回来。

这套 keep-best loop 的来路是 karpathy 的 [autoresearch](https://github.com/karpathy/autoresearch)，autodev 补上的是它没有的那一半：在人动手之前先对齐出 target，并留下能复验的证据。

### 功能开发

功能开发由 **blueprint** 驱动。一轮 Clarify 是：从实际代码绘制 as-is 架构图与流程图，这就是 baseline；用 diagram JSON 起草 to-be 的 blueprint，每个元素带稳定 ID 并声明构建依赖；再提出可编辑范围，说明现有 test 默认冻结，还是允许 blueprint 修改。裁决脚本把依赖换算成**构建顺序**，也就是哪些元素先做、哪些可以后做。

这里有个防偷懒的设计。如果 blueprint 的元素 ID 在 as-is 图里全都已经存在，照抄现状就能通过检查，脚本会拒绝。你得真的设计出点新东西。

Loop 按构建顺序逐元素实现，每个检查点都要声明本次实现了哪些元素，依赖还没建好的声明会被拒绝。代码完成后，agent 按**竣工状态**补画 as-built 图。裁决脚本只有在每个元素都已实现、都被 as-built 覆盖、该文件不是照抄的 blueprint、回归检查也通过时，才给出 `handoff`。竣工状态没有真正实现 blueprint，说明开发偏了，那就继续 loop，而不是退出。

Handoff 打开一个自包含的 `handoff.html`，把 blueprint 与 as-built 并排展示，附上每个元素由哪个 commit 实现，以及一张按进度着色的依赖图。

![功能开发流程：as-is 图、blueprint、提出修改范围、用户确认、实现-检查循环、竣工图](https://cdn.jsdelivr.net/gh/Momoyeyu/autodev@3c8f4ec9c3d75224d3bbd41589de1995d38894f9/docs/assets/autodev-development.zh.png)

### 问题修复

bug 报告通常已经指明失败的具体 case，target 因此最容易锁定：**一组通过的 test**。

一轮 Clarify 是：先写在未改动源码上必须失败的复现测试；再查询、删改、补充回归测试；运行整组得到 baseline；最后提出影响范围。

「能执行」不等于「已经全部通过」。如果测试集在未改动的源码上就已经全部通过，裁决脚本会拒绝。修复前不会失败的 target，修复后也证明不了什么；损坏的运行环境同样不算有效证据。

Loop 修复直到约定的 test 全部通过，测试文件逐轮冻结并校验 hash。Handoff 交付的是那一组用例，每个约定用例都带原始输出显示为绿，而不只是「bug 已修」的说法。

![问题修复流程：复现测试、baseline、提出影响范围、用户确认、修复-测试循环、通过的测试用例组](https://cdn.jsdelivr.net/gh/Momoyeyu/autodev@3c8f4ec9c3d75224d3bbd41589de1995d38894f9/docs/assets/autodev-bugfix.zh.png)

### 性能优化

性能优化的 target 是**一项 benchmark、一个分数**，可以是一个可执行的 benchmark，也可以是多个 benchmark 的固定加权和。

工作负载、单位、改善方向、测量方法，以及可能涉及的权重和归一化方式，全部在 baseline 之前固定，由你连同 baseline 和限制一并确认。多个 benchmark 分项仍然只产生**一个分数**，不是多个独立优化目标；分项读数只是诊断。看见谁赢之后再挑权重，就是作弊。

还有一道直接掐住噪声的检查：裁决脚本会在**未改动的源码**上把 benchmark 再跑一遍，要求两次的差距小于改进余量，这样单纯的测量噪声永远不会被当成进步。余量本身也是量出来的，不是拍的，上面那个 MoE 案例里有它怎么定的。

Loop 采用 **do-while** 顺序：先优化、测量并保留已验证的最佳结果，之后才判断是否达标或时间耗尽。就算 baseline 已经达标，也不能跳过第一次尝试；超时结束循环，也不代表目标达成。

每次尝试都要标明测的是哪个思路，在当前 best 下已被否定的思路，不说明新在哪里就不能重试；best 一旦刷新，这些思路全部重新开放。如果最终没验证到提升，或者 baseline 本来就达标，那就如实展示，不虚构一段优化轨迹。

![性能优化流程：数值 benchmark、baseline、提出限制、用户确认、优化-测量循环、过程图](https://cdn.jsdelivr.net/gh/Momoyeyu/autodev@3c8f4ec9c3d75224d3bbd41589de1995d38894f9/docs/assets/autodev-optimization.zh.png)

## 人最终拿到什么

| | 功能开发 | 问题修复 | 性能优化 |
|---|---|---|---|
| **必需产物** | 竣工架构图与流程图，与 blueprint 对照 | 全部通过的测试用例组 | 一张 baseline → 尝试 → 最终结果的过程图 |
| **展示内容** | 约定的目标设计与实际建成的状态逐元素对照 | 同一套确认后的 test 的结果，包含汇总和未解决失败 | 唯一分数随尝试次数或时间的变化、目标、保留的结果和停止状态 |
| **复验依据** | blueprint 与 as-built 图、元素覆盖表、每个元素对应的 commit、重跑命令 | 测试与源码版本、原始结果、重跑命令 | benchmark 与源码版本、真实历史、尝试过的思路及结果、测量条件、重跑命令 |

`report` 把三个场景的产物都写进契约目录里一个自包含的 `handoff.html`，并打印绝对路径和打开命令。这个页面是给人审阅的证据包，不是交付宣言，合并回分支要等人批准，由 `approve` 记录下来。文件只需要浏览器，不依赖任何渲染工具。

**产物形式本身就是约定的一部分：** 文字总结不能代替竣工图或全绿的测试用例组，表格或者一个最终数字也不能代替优化过程图。图必须展示记录下来的过程，而不只是两个好看的端点；失败或超时的尝试不能被伪造为某个分数。

如果意图、target 的含义或允许的范围发生变化，应该回到 Clarify，并建立可比较的新 baseline，不能把不同 baseline 的结果拼成一次提升。如果你对交付不满意，做法是再起一轮 autodev，通常按问题修复场景针对具体问题，而不是续跑已经结束的 loop。

## 长期规矩：项目宪法

有些规矩对项目里每个任务都成立：永远不能动的路径、永远不能坏的检查、优化最多能跑多久。把它们写进 `.autodev/constitution.json` 一次，每一轮都会自动继承：

```json
{
  "frozen": ["migrations/", ".github/"],
  "guard_cmd": "pytest -q",
  "budget": {"default_minutes": 30, "max_minutes": 120, "reserve_minutes": 5}
}
```

宪法是底线。单轮可以冻结更多、给更少的时间，但不能放松；要放松，只能由人改这个文件。`guard_cmd` 在所有场景的每次尝试前都会运行，失败即判该次尝试无效，所以优化不能拿正确性换速度。

这个文件只属于本机 clone：`init` 会把 `.autodev/` 写进 `.git/info/exclude`，judge 每轮重算它的 hash，而不是要求它被提交。要与团队共享得显式 `git add -f`，不是默认。文字约定写在项目的 `AGENTS.md` 里。

## 接管运行中的 loop

loop 知道的一切都在它的契约目录和分支里，而不在对话里。新的 session 或者另一个 agent 找到 `autodev/<task>` worktree，跑一下 `status`，就能拿到当前进度、有没有未提交或未裁决的工作、日志里已经排除了什么，以及一句话的下一步。

## 约束由什么保障

autodev 是一套协议加一个小型裁决脚本。Markdown 告诉 agent 该做什么，随 skill 一起安装的 `autodev/scripts/autodev_verify.py` 把其中能机械检查的部分变成每一轮真正执行的检查，并保留原始输出。

| 阶段 | 命令 |
|---|---|
| Clarify | `init` |
| Loop | `start` / `attempt` / `status` |
| Handoff | `verify` / `report` |

`start` 会先故意改一个冻结文件、再加一个范围外文件，要求两者都被拒绝，用这种方式证明检查真的生效。`init` 里还有一道**负对照**：每个 target 都得能被判出不合格，才算一个合格的 target。问题修复的测试要在修复前失败，benchmark 的噪声要小于改进余量，blueprint 要包含 as-is 图里没有的元素。

那些图都是 agent 可读写的纯 JSON，由 `autodev_render.py` 渲染成自包含 HTML 供人直接打开。渲染结果由工具从源生成，不可能和检查过的源脱节。

能机械化的都交给了脚本，剩下这些只能靠人：blueprint 是不是正确的设计、test 量的是不是对的东西、提出的影响范围是否合理、as-built 图与 blueprint 是否真的一致、思路标签是否如实区分了不同的想法、契约本身是否被认可。产物有没有被看过、分支要不要合并回来，也在你手上。

所以安装这个 skill 本身并不保证 agent 一定遵守。它保证的是另一件事：留下一个契约目录，让你可以逐轮核对「规则是否真的被执行」，而不是只能看「规则有没有被写下来」。

## 快速开始

安装只有一行：

```bash
npx skills add Momoyeyu/autodev -g
```

然后像平常一样描述任务就行：

```text
为筛选后的交易列表增加 CSV 导出。
```

```text
客户姓名里带逗号时，CSV 导出会丢行。
```

```text
把 API 的 p95 延迟降到 200 ms 以下。实现修改仅限 src/api/，优化时间预算为 20 分钟。
```

第一个需求从 as-is 图和 blueprint 的对齐开始，第二个从一条在未改动源码上必须失败的复现测试开始，第三个先确认 benchmark 并测量 baseline。你在需求里已经写明的限制会被直接复用，不会重复询问。

## Skill 结构

skill 本体是渐进式披露的：一份入口 `SKILL.md` 讲目的、理念、三个场景和三阶段约定；另有七份按需加载的 reference，分别对应项目宪法、Clarify 总则、三条场景分支、Loop 和 Handoff。只读当前阶段和当前场景的那一份，不预加载后续阶段。

对 Agent 来说上下文也是预算，写 skill 和写 prompt 一样，每一行都在花它的注意力。

仓库分发的是 skill 和那个裁决脚本，不附带测试运行器或评测套件。target 由你和 agent 在使用 skill 的目标项目里约定，脚本只执行约定的命令并记录裁决，所以它**不绑定测试工具，也不绑框架**。框架专用模板是有意排除的：一旦这个 skill 认识了 Jest，它就不再适用于 Rust 了。

## 求 star

仓库：[**github.com/Momoyeyu/autodev**](https://github.com/Momoyeyu/autodev) · [在线文档站](https://momoyeyu.github.io/autodev) · MIT 协议

任何能加载 `SKILL.md` 的 Agent 都能用，Claude Code、Cursor、Codex CLI、OpenCode，以及你自己的 Agent 都算。

如果你也想：

- 把 Vibe Coding 的黑盒打开，拿到的不是一句「做完了」，而是一份能自己复验的证据
- 让「对齐」发生在写代码之前，而不是返工之后
- 看看一个 Agent Skill 能把约定写多细，七份 reference 各自只在需要时加载

那来给个 star、提个 issue、丢个 PR。尤其欢迎**真实的 loop 运行记录**，包括 Agent 试图糊弄自己 benchmark 的那种。
