---
title: macOS 选购与配置
date: 2025-05-13
description: '面向开发者的 Mac 选购建议与软件配置：硬件选型、Homebrew、IDE 与命令行环境。'
tags: [macOS, 工具链]
category: 环境搭建
episode: 0
draft: false
lang: 'zh_CN'
---

这篇笔记写给打算转 Mac 或者刚转过来的 CS 学生和开发者，记一下我在配置上的选择和踩过的坑。涵盖三块：硬件怎么选、软件怎么装、日常用起来的一些小经验。

## 为什么换 Mac

本科前几年我一直用一台联想 Y9000P，性能确实够用，但读研之后开始做 AI Agent 相关的研究，慢慢觉得 Windows 在几个点上拖后腿：

- **Unix 环境**。文件管理、环境变量、包管理这些，Windows 跟 Linux/macOS 不在一个体验上。macOS 没有"分盘"概念，存储是统一的，加上 Homebrew，整套用起来跟 Linux 的 `apt` 很像。
- **工作和娱乐分开**。Windows 那台已经塞了一堆游戏和娱乐软件，开发环境跟它混在一起越来越乱。让 Windows 专心当游戏机、Mac 当干净的开发机，反而双方都舒服。
- **生态成熟度**。Apple Silicon 出来之后，IDE 厂商基本都跟上了——IntelliJ、PyCharm、Cursor、VS Code 都有原生版本，本地跑深度学习也没问题。网上说的"Mac 软件兼容差"在我用下来其实被夸大了。
- **苹果生态联动**。如果你本来就有 iPhone、iPad、AirPods，再加一台 Mac，AirDrop、跨设备切耳机这些日常体验确实顺。
- **便携**。Y9000P 那个砖很难称为便携设备，MacBook 这种轻薄本通勤、出差都没负担。
- **价格**。教育优惠加国补之后，性价比比裸价好看很多。

## 硬件怎么配

我自己用的是 **MacBook Air M4，24GB 内存 + 512GB SSD**。下面按"选哪个型号 / 多少内存 / 多大硬盘"分别说。

### 选 Air 还是 Pro

我选 Air 有两个原因：一是家里已经有一台 Y9000P 顶着重算力的活；二是 Air 更"笔记本"，轻得跟没拿一样。真要算力，SSH 上远端服务器就行。

至于 M4 还是 M3 / M2，新芯片用的年头更长，按"年均成本"算反而划算，所以直接上当时最新的。

### 内存

最低 24GB，预算够上 32GB。macOS 是 unified memory，系统内存同时也是 GPU 显存，多吃一点很值得。本地跑开发环境、本地验证算法再丢到远端跑，内存宽裕用起来差别非常明显。

### 硬盘

256GB 也能用，但 512GB 体验明显更舒服。靠移动硬盘补容量违背了 MacBook 的便携初衷，而且 512GB 留出来的余量能 cover 整个研究生周期。预算紧的话 256GB 配合自律的存储管理也可以接受。

> [!IMPORTANT]
> MacBook Air M4 最低配（16GB + 256GB）会减配——充电器和 GPU 核心都比上一档少。买之前要看清楚。

## 软件配置

下面这些是按算法/后端开发偏好整理的，但对大多数软件工程师也通用。

### 网络

新 Mac 到手第一件事是把网络配好。后面所有装包、下载、登录账号都依赖网络通畅。

### 浏览器

Mac App Store 里东西不全，而且有些 App 比官网下的差——比如 Bilibili 在 App Store 上只有 iOS 版，在 Mac 上跑起来布局很别扭，原生 Mac 版要去 Bilibili 官网下。

浏览器没必要因为换了 Mac 就改用 Safari。Safari 也很好，但换浏览器的学习成本通常不值得，原来用 Chrome 继续用就是了。

### IDE

同理，IDE 也保持原来的偏好。主流 IDE 在 macOS 上基本都有原生版，JetBrains 全家桶、Cursor、VS Code 都可以直接去官网下 `.dmg`。

### 命令行和开发环境

先装 [Homebrew](https://brew.sh/)，先确保网络通畅，因为有些包在境外服务器。装完之后在 `~/.zshrc`（macOS 上等价于 Linux 的 `~/.bashrc`）里加：

```bash
export PATH="/usr/local/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"
```

然后 `source ~/.zshrc` 让它生效。

> [!TIP]
> macOS 上装软件尽量走默认路径。这边不像 Windows 要分系统盘和数据盘，默认路径方便后面排查问题。

Homebrew 装好之后，常用工具基本一行命令搞定，比如 Maven、Node.js、JDK：

```bash
brew install maven
mvn --version
```

如果是要常驻后台、开机自启的服务（MySQL、PostgreSQL 之类），用 Homebrew 自带的 services 管：

```bash
brew install mysql
brew services start mysql
brew services list
```

### Python 环境

推荐用 [uv](https://docs.astral.sh/uv/)，底层 Rust 实现，安装快、体积小、依赖解析速度比 pip/conda 快一个数量级。

```bash
brew install uv
```

创建项目和虚拟环境：

```bash
uv init my-project && cd my-project
uv venv                  # 创建 .venv
source .venv/bin/activate
uv add torch numpy jupyter
```

`uv` 同时管理 Python 版本和依赖，不需要额外装 pyenv 或 conda。如果需要特定 Python 版本：

```bash
uv python install 3.12
uv venv --python 3.12
```

装 Jupyter 之类的全局工具用 `uv tool`，不污染项目环境：

```bash
uv tool install jupyter
```

### 学术工具链

我常用的一套：

- **Zotero**：文献管理。配合浏览器插件 *Zotero Connector* 和 *Translate for Zotero*，抓取和翻译都顺。缺点：吃内存（见下面的 Known Issues）。
- **Notion**：跨平台云笔记，网页版在 Mac 上跟在 Windows 上没什么差别。
- **Obsidian**：本地 Markdown 笔记。Mac 的内存管理很适合同时开一堆文档，加上没有"在哪个盘"的烦恼。
- **Overleaf**：在线 LaTeX，浏览器里写，免装。

### GitBook 坑提示

装 GitBook 想用来整理笔记的话有几个坑：

- **NVM 不要用 `brew install nvm`**。容易出现 `nvm ls-remote N/A` 和镜像配不上的问题。改用 curl 安装脚本，然后单独配镜像。
- **`cb.apply` 错误**：GitBook 安装常见问题，需要单独处理。

## 日常小经验

### 触控板

Mac 触控板真的好用，绝大多数场景可以替代鼠标。两个推荐改的设置：开启 **轻点来点按**（tap to click）和 **三指拖移**（three-finger drag）。具体手势直接问 AI 最快——"Mac 上怎么 XXX"，比翻文档高效。

### 快捷键

macOS 的快捷键体系覆盖很全，但要全背下来不现实。需要的时候问 AI 最快，告诉它你在用 Mac、要完成什么操作就行。系统自带的"快捷指令" App 也能帮着发现可用动作。

## Known Issues

1. **Office 兼容**。Mac 版 Office 跟 Windows 版有差别，字体兼容、授权都是事。Apple 自家的 Pages / Keynote 也能用，但涉及严格格式的文档（如基金申报）最好回 Windows 验一遍再交。
2. **Zotero 吃内存**。Zotero 7 启动就 500MB，开 PDF 之后能涨到 2GB 甚至 4GB。看下来跟一些第三方插件（如 *Ethereal Style*）的资源回收有关，关掉非必需插件能缓解。
3. **`.DS_Store` 文件**。Spotlight 或 Finder 浏览过目录之后会留下 `.DS_Store`，不影响功能，但容易混进 Git 仓库。加进 `.gitignore` 是好习惯。
4. **配件**。触控板足够日常用，但精细操作（如 Word 选字）配鼠标更顺手。USB-C 扩展坞和电脑包也建议备一份。

## 写在最后

Mac 不是非买不可，关键看自己的需求和预算。型号、内存、硬盘按自己情况选就好。这几年 macOS 生态越来越成熟，对 CS 学生和开发者来说，它已经是一台够格的主力开发机了。
