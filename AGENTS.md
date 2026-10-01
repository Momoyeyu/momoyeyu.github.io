# 框架导览

改功能或界面时照这里定位，不必先扫全仓库。

## 改什么 → 去哪

- 站点配置（标题、导航栏、个人资料、主题色、`toc.depth`、Banner、首页布局）→ `src/config.ts`，类型在 `src/types/config.ts`
- 分页大小、Banner 高度、友链与资源页数据 → `src/constants/`
- 界面文案（多语言）→ `src/i18n/i18nKey.ts` + `src/i18n/languages/*.ts`；共 10 个语言文件，新增文案要全部补齐
- 文章字段 → `src/content/config.ts`（构建时校验）；`frontmatter.json` 是编辑器 schema，目前缺 `episode` / `updated`
- 图标 → `astro.config.mjs` 的 `icon({ include })`；按清单打包，新增图标必须登记，否则不渲染
- Markdown 与代码块渲染（Admonition、Mermaid、KaTeX、Expressive Code）→ `astro.config.mjs` + `src/plugins/`
- 系列、排序、上一集/下一集 → `src/utils/content-utils.ts`；由 `content-utils.test.ts` 覆盖，改逻辑要连测试一起改
- URL 规则 → `src/utils/url-utils.ts`
- sitemap 的 `lastmod` → `astro.config.mjs` 的 `getPostLastmodByPath()`（读 `updated`，回退 `date`）
- 样式与 CSS 变量 → `src/styles/`；主题色、Banner 高度等全局 CSS 变量在 `src/layouts/Layout.astro` 里由 `siteConfig.themeColor` / `src/constants/constants.ts` 注入
- 内容实体 → `src/content/posts/`（文章）、`src/content/spec/about.md`（关于页正文）

## 页面与布局

- `src/layouts/Layout.astro` 是全局外壳：`<html>`/head、favicon、Banner 高度、主题色等全局 CSS 变量
- `src/layouts/MainGridLayout.astro` 是页面骨架：网格、`#right-sidebar`，用 `headings.length > 0` 判断是否文章页
- `src/pages/`：`[...page].astro` 首页列表、`posts/[...slug].astro` 文章页、`archive.astro` 归档、`about.astro` 关于、`friends.astro` 友链（`link.astro` 只是 301 到它）、`resource/index.astro` + `resource/[category]/index.astro` 资源页、`rss.xml.ts`、`robots.txt.ts`

## 组件（`src/components/`）

- 页面级：`Navbar.astro`、`Footer.astro`、`PostPage.astro`、`PostCardGrid.astro`（列表卡片，简介缺省取正文首段）、`PostMeta.astro`、`Mascot.astro`
- 侧栏小部件在 `widget/`：`TOC.astro`（目录）、`Categories.astro`、`Tags.astro`、`Profile.astro`、`SideBar.astro`、`RightSidebar.astro`、`NavMenuPanel.astro`，外壳统一用 `WidgetLayout.astro`
- 需要交互的一律用 Svelte：`Search.svelte`、`ArchivePanel.svelte`（归档筛选）、`LightDarkSwitch.svelte`、`widget/DisplaySettings.svelte`
- 通用件：`control/`（`BackToTop`、`ButtonLink`、`ButtonTag`、`Pagination`）、`misc/`（`ImageWrapper`、`License`、`Markdown`）

## 约定

- 仓库日常操作一律走 Make：新建文章用 `make new`（不要手写 frontmatter），完整指令列表见 `README.md` 与 `Makefile`。
- `make dev` 已带单实例守卫：多个 `astro dev` 共享 `.astro/data-store.json` 会让归档/合集偶发空白，guard 拒绝时先 kill 旧进程，不要绕开它另起 `astro dev`。
- 为测试起的任何服务进程（`astro dev`、`astro preview`、`python -m http.server` 等）用完必须自己杀掉，不留孤儿进程；用户自己在用的 :4321 dev server 不要动。
- 改完自检 `make check`（`astro check` + `vitest run`）。
- 不顺手重构历史代码与历史文章：只做被明确要求的改动。
- 文章正文不用括号做解释性夹注：括号只保留学术式用法，即术语缩写和专有名词对照（如「点对点访问（P2P）」「超节点（SuperPoD）」）；凡是能写成正文句子的内容——解释、举例、规格枚举、补充说明——一律用逗号、破折号或独立句写进正文。写完文章后 grep `（` 逐条自查。
