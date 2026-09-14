---
title: Mascot Anything
date: 2026-05-13
description: '开源网页桌宠工具：用 AI 生成角色立绘，一行 script 嵌入任意网页。'
tags: [深度学习, 开源]
category: 项目
episode: 1
draft: false
pinned: true
image: '/img/posts/mascot-anything/cover.webp'
lang: 'zh_CN'
---

看到右下角的小鞠了吗？她是我用一行 Python 命令"画"出来、再用一行 `<script>` 塞到这个网页里的——整个过程加起来不到一分钟。

这是 [**Mascot Anything**](https://github.com/momoyeyu/mascot-anything)，一个开源的网页桌宠生成 + 嵌入工具。

> **把任意角色变成可以贴在任何网页右下角的 AI 桌宠。**
>
> 一份 YAML 写好角色设定与参考图 → 调用图像模型生成透明 PNG 立绘 → 用一行 `<script>` 嵌进任意前端项目。不挑框架，不挑后端，不挑模型。

## 为什么要再造一个轮子

桌宠这种东西社区里早有不少方案了——比如 [流萤桌宠](https://github.com/PYmili/MyFlowingFireflyWife) 这种本地 App 做得很完整。但我想做的事，现成方案没一个能满足：

| 现成方案 | Mascot Anything |
|---|---|
| 桌面 App，跑不进网页 | 单文件 `mascot.js`，一行 `<script>` 嵌任意前端项目 |
| 角色固定，换人就要重画整套立绘 | 一张参考图 + 一段 prompt，AI 生成一整套表情 |
| 绑定特定厂商或 SDK | OpenAI-compatible 接口，任意供应商都能用 |

简单说：**我想要的桌宠是"我自己挑的角色 + 嵌在我自己的网页里 + 用我手头的模型 endpoint"**——三件事现有方案都没做齐，那就自己做一个。

## 30 秒看效果

**写一个 YAML**，描述角色和你想要的表情：

```yaml
character:
  name: "Komari"
  prompt: |
    短发少女，校服，平静表情……

references:
  - { label: "character", path: "./refs/character.jpg" }

sprites:
  - { name: "normal", prompt: "standing upright, calm" }
  - { name: "happy",  prompt: "soft smile, hand raised" }
  - { name: "pouty",  prompt: "pouting" }
```

**跑一行命令**：

```bash
python3 scripts/generate.py -c examples/komari/mascot.yaml
```

拿到一整套透明 PNG 立绘，背景自动去掉（用了 `rembg`），风格由参考图决定。

**塞进任意网页**：

```html
<script src="/mascot.js"
        data-mascot-position="bottom-right"
        data-mascot-size="120"></script>
```

完事。

## 三件事

- 🎨 **角色端 · AI 生成立绘** — YAML 描述角色 + 表情，一张参考图就能拉出整套表情立绘，风格统一、背景透明。换角色不用重画，写新 YAML 就行。
- 🪶 **嵌入端 · 零依赖单文件** — `mascot.js` 一个文件、纯原生 JS、零框架依赖。Astro / Next.js / 纯 HTML 都能塞。
- 🔌 **模型端 · OpenAI-compatible** — 不绑供应商。OpenAI 官方、OpenRouter、自部署 endpoint，写个 base_url 就能切。

## 已经在跑的地方

这个博客本身就是真实用例。右下角的小鞠、5 张表情、点击切换、台词气泡、移动端自动隐藏，全部来自仓库 demo 配置，没做任何自定义改造。

```text
public/mascot/sprites/
├── normal.png       # 平静
├── pouty.png        # 嘟嘴
├── embarrassed.png  # 脸红
├── happy.png        # 微笑
└── phone.png        # 打手机
```

仓库里附带了一个 `Mascot.astro` 组件，把 sprites 复制过去就能在自己的 Astro 博客里直接用。

## 路线图

后面想做的事还排着：

- 表情切换的过渡动画（淡入淡出 / 移动）
- 鼠标 / 滚动 / 时间事件驱动的状态机
- 更多模型 provider 的 preset 配置

有想看的功能、想跑的角色，欢迎开 issue 一起聊。

## 求 star

仓库：[**github.com/Momoyeyu/mascot-anything**](https://github.com/momoyeyu/mascot-anything) · MIT 协议

如果你也想：

- 给自己博客 / 文档站加个会动的小可爱
- 把自己喜欢的角色变成屏幕右下角的常驻嘉宾
- 折腾 OpenAI-compatible 图像生成 API 的实际玩法

那来给个 star、提个 issue、丢个 PR——任何一种都会让我有动力继续把它做下去。
