# 夜羽的小作坊

个人技术博客：<https://momoyeyu.github.io>。
基于 [Astro 5](https://astro.build) 与 [Fuwari](https://github.com/saicaca/fuwari) 主题二次开发，部署在 GitHub Pages。
文章是 `src/content/posts/` 下的 Markdown，按「系列」（`category`）组织。

## 常用命令

先装依赖 `pnpm install`，日常操作走 Make：

| 命令 | 作用 |
| --- | --- |
| `make` | 列出全部命令 |
| `make new` | 交互式新建文章（当天日期，`draft: true`） |
| `make dev` | 本地预览 <http://localhost:4321> |
| `make check` | 类型检查 + 单元测试 |
| `make commit` | 提交暂存区（信息为当前时间） |
| `make push` | 推送到 `origin/master` |
| `make deploy` | `check` → `commit` → `push` |
| `make status` | 分支、暂存区与草稿状态 |

`make deploy` 只提交**已暂存**的改动，所以先 `git add` 要发布的内容。

底层脚本：`pnpm check`（仅 `astro check`）、`pnpm test`（Vitest）、`pnpm build`（构建 + 整理 sitemap + 生成 pagefind 搜索索引）、`pnpm lint` / `pnpm lint:fix` / `pnpm format`（Biome）。

## 写作

**字段与流程**

- 文章放在 `src/content/posts/`，文件名用英文小写 + 连字符（`make new` 会校验并生成模板）。
- frontmatter 字段见 `src/content/config.ts`：`title`、`date`、`episode` 必填，`draft: true` 不进生产构建（开发环境照常显示）。不写 `description` 时，列表卡片简介取正文首段。
- 大改已发布文章时补 `updated`：sitemap 的 `lastmod` 取它，缺省回退 `date`。
- 发布流程：正文写完把 `draft` 改成 `false` → `git add` → `make deploy`。

**系列（`category`）**

- 每个 `category` 就是一个系列（合集），没有注册表；归档页按 `episode` 排序并自动生成「本系列 · 上一集/下一集」。
- `episode` 只是排序键：站点按系列内位置编号，所以首篇总是显示 `EP.0`。新系列首篇填 `0`，后续填 `max + 1`，插队用小数（`2.5`）。
- 命名：`category` 用简短名（`LLM`、`AI Infra`、`C++ 进阶`、`随笔` 等），文件名加小写前缀（`llm-`、`cpp-`），正文提及缩写用大写。

**结构与标题**

- 目录收录文中**实际用到的最浅两级标题**（`toc.depth = 2`）：以 `#` 作章节的文章是 h1 + h2，以 `##` 开篇的是 h2 + h3。
- 写在 `# 前言` 之后的 `##` 会缩进成「前言」的子项——前言只放引言，正式章节用 `#`。
- LLM 系列用 `# 前言` → `#` 章节 → `# 结语` → `# 参考资料`；C++ / Python / AI Infra 等旧系列直接以 `##` 开篇，保持原样。

**链接与图片**

- 系列 `/archive/?category=<category>`；同系列文章 `../<slug>/`；其他文章 `/posts/<slug>/`。
- 图片放 `public/img/posts/<slug>/`，正文写 `/img/posts/<slug>/xxx.png`。

**文风**

- 中英文相邻处加空格，CJK 之间不加；术语缩写用大写。
- 属于翻译/释义的中文说法保留中文（「稠密大模型」不改成「稠密 LLM」）。
- 优先 Markdown，少用 HTML，只有 Markdown 表达不了时才用。

## 目录结构

- `src/content/posts/` 文章，`src/content/spec/about.md` 关于页
- `src/pages/` 路由（文章、归档、资源、RSS、robots）
- `src/components/`、`src/layouts/` 组件与页面外壳（含 Svelte 小组件：归档筛选、搜索、主题切换）
- `src/config.ts` 站点配置（导航、个人资料、目录深度、主题）；`src/constants/` 分页大小、Banner 高度、友链与资源数据
- `src/utils/` 内容与系列逻辑、URL 工具；`src/plugins/` remark/rehype 与 Expressive Code 插件
- `src/styles/`、`src/i18n/`、`src/types/` 样式、多语言文案、类型
- `scripts/new-post.js` `make new` 的脚手架；`astro.config.mjs` 集成、Markdown 管线与 sitemap `lastmod`
- `public/` 静态资源（Banner、文章插图）

## 部署

推送到 `master` 后，GitHub Actions 依次执行 `pnpm check` → `pnpm test` → `pnpm build`，通过后把 `dist/` 发布到 GitHub Pages。
