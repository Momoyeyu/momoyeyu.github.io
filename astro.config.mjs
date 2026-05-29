import fs from "node:fs";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwind from "@astrojs/tailwind";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import { defineConfig } from "astro/config";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components"; /* Render the custom directive content */
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive"; /* Handle directives */
import remarkGithubAdmonitionsToDirectives from "remark-github-admonitions-to-directives";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import { expressiveCodeConfig } from "./src/config.ts";
import { pluginLanguageBadge } from "./src/plugins/expressive-code/language-badge.ts";
import { AdmonitionComponent } from "./src/plugins/rehype-component-admonition.mjs";
import { GithubCardComponent } from "./src/plugins/rehype-component-github-card.mjs";
import { parseDirectiveNode } from "./src/plugins/remark-directive-rehype.js";
import { remarkExcerpt } from "./src/plugins/remark-excerpt.js";
import { remarkReadingTime } from "./src/plugins/remark-reading-time.mjs";
import { pluginCustomCopyButton } from "./src/plugins/expressive-code/custom-copy-button.js";
import { remarkMermaid } from "./src/plugins/remark-mermaid.mjs";

// Map each post's URL path (`/posts/<slug>/`) to its real last-modified date,
// read from frontmatter `updated` (falling back to `published`). Used by the
// sitemap so a post's <lastmod> reflects when it actually changed, instead of
// the build time — which would otherwise mark every page as "just updated".
function getPostLastmodByPath() {
	const dir = "./src/content/posts";
	const map = {};
	for (const file of fs.readdirSync(dir)) {
		if (!/\.mdx?$/.test(file)) continue;
		const slug = file.replace(/\.mdx?$/, "");
		const raw = fs.readFileSync(`${dir}/${file}`, "utf-8");
		const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (!frontmatter) continue;
		const read = (key) =>
			frontmatter[1]
				.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
				?.trim()
				.replace(/^['"]|['"]$/g, "");
		const date = read("updated") || read("published");
		if (date && !Number.isNaN(new Date(date).getTime())) {
			map[`/posts/${slug}/`] = new Date(date);
		}
	}
	return map;
}

const postLastmodByPath = getPostLastmodByPath();

// https://astro.build/config
export default defineConfig({
	site: "https://momoyeyu.github.io",
	base: "/",
	trailingSlash: "always",
	integrations: [
		tailwind({
			nesting: true,
		}),
		swup({
			theme: false,
			animationClass: "transition-swup-", // see https://swup.js.org/options/#animationselector
			// the default value `transition-` cause transition delay
			// when the Tailwind class `transition-all` is used
			containers: ["main", "#right-sidebar", "#sidebar-sticky"],
			smoothScrolling: true,
			cache: true,
			preload: true,
			accessibility: true,
			updateHead: true,
			updateBodyClass: false,
			globalInstance: true,
		}),
		icon({
			// Only bundle the icons actually referenced in the codebase, instead of
			// pulling in entire icon sets with ["*"]. When adding a new icon, grep the
			// repo for its `set:name` string and keep these lists in sync.
			include: {
				"fa6-brands": ["bilibili", "creative-commons", "github"],
				"fa6-regular": ["address-card"],
				"fa6-solid": [
					"arrow-rotate-left",
					"arrow-up-right-from-square",
					"chevron-right",
					"envelope",
					"thumbtack",
				],
				"material-symbols": [
					"book-2-outline-rounded",
					"calendar-today-outline-rounded",
					"chevron-left-rounded",
					"chevron-right-rounded",
					"copyright-outline-rounded",
					"dark-mode-outline-rounded",
					"edit-calendar-outline-rounded",
					"expand-less-rounded",
					"home-outline-rounded",
					"keyboard-arrow-up-rounded",
					"menu-rounded",
					"more-horiz",
					"notes-rounded",
					"palette-outline",
					"radio-button-partial-outline",
					"schedule-outline-rounded",
					"search",
					"tag-rounded",
					"wb-sunny-outline-rounded",
				],
			},
		}),
		expressiveCode({
			themes: [expressiveCodeConfig.theme, expressiveCodeConfig.theme],
			plugins: [
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				pluginLanguageBadge(),
				pluginCustomCopyButton(),
			],
			defaultProps: {
				wrap: true,
				overridesByLang: {
					shellsession: {
						showLineNumbers: false,
					},
				},
			},
			styleOverrides: {
				codeBackground: "var(--codeblock-bg)",
				borderRadius: "0.75rem",
				borderColor: "none",
				codeFontSize: "0.875rem",
				codeFontFamily:
					"'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
				codeLineHeight: "1.5rem",
				frames: {
					editorBackground: "var(--codeblock-bg)",
					terminalBackground: "var(--codeblock-bg)",
					terminalTitlebarBackground: "var(--codeblock-topbar-bg)",
					editorTabBarBackground: "var(--codeblock-topbar-bg)",
					editorActiveTabBackground: "none",
					editorActiveTabIndicatorBottomColor: "var(--primary)",
					editorActiveTabIndicatorTopColor: "none",
					editorTabBarBorderBottomColor: "var(--codeblock-topbar-bg)",
					terminalTitlebarBorderBottomColor: "none",
				},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250,
				},
			},
			frames: {
				showCopyToClipboardButton: false,
			},
		}),
		svelte(),
		sitemap({
			filter: (page) => !page.includes("/link"),
			serialize(item) {
				// Posts get their real last-modified date; other pages (home,
				// archive, ...) have no post date, so fall back to build time.
				const path = new URL(item.url).pathname;
				const postLastmod = postLastmodByPath[path];
				item.lastmod = (postLastmod ?? new Date()).toISOString();
				return item;
			},
		}),
	],
	markdown: {
		remarkPlugins: [
			remarkMermaid,
			remarkMath,
			remarkReadingTime,
			remarkExcerpt,
			remarkGithubAdmonitionsToDirectives,
			remarkDirective,
			remarkSectionize,
			parseDirectiveNode,
		],
		rehypePlugins: [
			rehypeKatex,
			rehypeSlug,
			[
				rehypeComponents,
				{
					components: {
						github: GithubCardComponent,
						note: (x, y) => AdmonitionComponent(x, y, "note"),
						tip: (x, y) => AdmonitionComponent(x, y, "tip"),
						important: (x, y) => AdmonitionComponent(x, y, "important"),
						caution: (x, y) => AdmonitionComponent(x, y, "caution"),
						warning: (x, y) => AdmonitionComponent(x, y, "warning"),
					},
				},
			],
			[
				rehypeAutolinkHeadings,
				{
					behavior: "append",
					properties: {
						className: ["anchor"],
					},
					content: {
						type: "element",
						tagName: "span",
						properties: {
							className: ["anchor-icon"],
							"data-pagefind-ignore": true,
						},
						children: [
							{
								type: "text",
								value: "#",
							},
						],
					},
				},
			],
		],
	},
	vite: {
		build: {
			rollupOptions: {
				onwarn(warning, warn) {
					// temporarily suppress this warning
					if (
						warning.message.includes("is dynamically imported by") &&
						warning.message.includes("but also statically imported by")
					) {
						return;
					}
					warn(warning);
				},
			},
		},
	},
});
