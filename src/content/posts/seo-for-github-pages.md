---
title: 刷 SEO
published: 2026-05-15
description: '给 GitHub Pages 博客配置 Google Search Console 和 Bing Webmaster Tools 的完整流程。'
tags: [随笔]
category: 随笔
draft: false
lang: 'zh_CN'
---

博客跑了两年多，SEO 一直没管过。某天搜了一下自己的域名，Google 零收录，Bing 收录了几条但全是 404。于是花了一个晚上系统性地刷了一遍。

在动手之前先确认一件事：你的站点得有一个 sitemap 和一个 robots.txt。Astro 用 `@astrojs/sitemap` 集成就能自动生成，其他框架也都有对应的方案。robots.txt 里要指向你的 sitemap 地址，同时声明哪些路径不希望被爬虫索引。这两个文件是后面所有操作的前提。

## Google Search Console

### 验证站点

1. 打开 [Google Search Console](https://search.google.com/search-console)，点击"添加资源"
2. 选择"网址前缀"，输入你的站点地址（比如 `https://momoyeyu.github.io`）
3. 验证方式选 **HTML 文件**——下载一个类似 `google79f3a1762a79f3c9.html` 的文件
4. 把这个文件放到站点的根目录。Astro 项目放到 `public/` 下，构建时会原样复制到 `dist/`
5. 部署后回到 Search Console 点"验证"

其他验证方式（DNS、HTML 标签、Google Analytics）也可以，但文件验证对静态站点最简单直接。

### 提交 Sitemap

验证通过后，在左侧菜单找到"站点地图"，输入你的 sitemap 地址（比如 `https://momoyeyu.github.io/sitemap.xml`），点提交。

刚提交时状态可能显示"无法抓取"——这是正常的，Google 还没来得及去抓，通常几小时到一两天就会变成"成功"。

### 手动请求索引

如果你希望某些重要页面被优先收录，可以在"URL 检查"工具里输入具体的 URL，然后点"请求编入索引"。Google 会优先抓取这些页面。建议对首页和几篇核心文章都做一次。

### 关注的指标

提交完之后不需要一直盯着，但可以定期回来看：

- **覆盖率报告**：哪些页面被索引了，哪些有问题（404、重定向错误等）
- **搜索效果**：你的页面在搜索结果里出现了多少次、被点了多少次、平均排名
- **核心网页指标**：加载速度、交互延迟等性能数据，影响排名

## Bing Webmaster Tools

### 验证站点

1. 打开 [Bing Webmaster Tools](https://www.bing.com/webmasters)
2. 可以选择"从 Google Search Console 导入"一键完成，也可以手动添加
3. 手动添加的话，验证方式同样选 **XML 文件**——下载 `BingSiteAuth.xml` 放到 `public/` 目录
4. 部署后点验证

### 提交 Sitemap

验证通过后在"配置我的网站" → "Sitemaps"里提交 sitemap 地址，和 Google 一样。

Bing 的索引速度通常比 Google 慢一些，耐心等就好。

## 百度

GitHub Pages 屏蔽了百度爬虫（Baiduspider），这是一个已知的老问题。如果你的读者主要在国内，需要额外部署一份到 Vercel 或 Netlify，再绑自定义域名，然后去[百度站长平台](https://ziyuan.baidu.com)验证和提交 sitemap。流程和 Google、Bing 类似。

如果暂时不打算折腾，可以先跳过。

## 站点自身的准备

搜索引擎能不能正确展示你的页面，取决于你的 HTML 里写了什么。几个对 SEO 影响最大的点：

- **`<link rel="canonical">`**：告诉搜索引擎每个页面的权威地址，避免重复收录
- **`og:image` / `twitter:image`**：社交平台分享时显示的缩略图，没有的话分享出去就是灰色方块
- **`<meta name="description">`**：搜索结果里标题下面那段摘要，空着的话搜索引擎会从正文里自动截取，效果通常不好
- **JSON-LD 结构化数据**：用 schema.org 的 `BlogPosting` 类型告诉搜索引擎这是一篇博客文章，包含标题、作者、发布时间、封面图等，会影响搜索结果的富文本展示
- **Sitemap 的 `lastmod`**：告诉搜索引擎页面的最后修改时间，有助于更频繁地被重新抓取
- **死链处理**：如果改过页面路径，旧路径要做 301 重定向，否则搜索引擎索引到的旧地址会变成 404

## 后续

技术层面能做的基本就这些了。剩下的是等搜索引擎慢慢抓取和索引，快的几天，慢的几周。长期来看，SEO 就两件事：持续写有价值的内容，以及让别人愿意链接你。其他都是锦上添花。
