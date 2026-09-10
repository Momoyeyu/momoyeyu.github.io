/**
 * Resource hub data.
 *
 * A "resource" is anything the site hands out for direct use (a shell script,
 * a config file, a template…). Each entry in `RESOURCE_CATEGORIES` becomes:
 *
 *   - a card on `/resource/`
 *   - a page at `/resource/<slug>/`
 *
 * Adding a new resource type is therefore: append one object here, and (if it
 * ships real files) drop them under `public/resource/<slug>/`. No new route
 * file is needed — `src/pages/resource/[category]/index.astro` renders them all.
 */

export interface ResourceItem {
	/** File name under `public/resource/<slug>/`; also the last URL segment. */
	name: string;
	title: string;
	desc: string;
	details: string[];
	note?: string;
}

export interface ResourceCategory {
	/** Route segment: `/resource/<slug>/`. */
	slug: string;
	name: string;
	/** Iconify name — must also be listed in astro.config.mjs `icon({ include })`. */
	icon: string;
	/** One-liner shown on the hub card. */
	desc: string;
	/** Longer copy shown on the category page. */
	intro?: string;
	/**
	 * How to consume an item, with `{url}` standing in for its file URL.
	 * Omit for categories whose items aren't shell commands.
	 */
	commandTemplate?: string;
	items: ResourceItem[];
}

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
	{
		slug: "script",
		name: "脚本",
		icon: "material-symbols:terminal-rounded",
		desc: "一条 curl 命令就能跑起来的环境初始化与工具链安装脚本。",
		intro:
			"下面的脚本可以直接用 curl 管道执行，适合在新机器上快速初始化环境。执行前建议先看一眼脚本内容，确认没问题再跑。",
		commandTemplate: "curl -fsSL {url} | bash",
		items: [
			{
				name: "setup.sh",
				title: "BASIC · 环境初始化",
				desc: "把一台新机器的基础开发环境一次性配好（macOS / Linux 通用）。",
				details: [
					"Homebrew（macOS）/ apt（Linux）",
					"build-essential、curl、git、zsh",
					"oh-my-zsh + fast-syntax-highlighting + zsh-autosuggestions",
					"git 用户名 / 邮箱（运行时会提示你输入）+ 常用 alias",
					"zsh 别名、PROMPT，并把默认 shell 切成 zsh",
				],
				note: "macOS 上如果弹出 Xcode CLT 安装窗口，装完后重新跑一次即可；中途会提示输入 git 用户名和邮箱（已配置过则直接回车沿用）。",
			},
			{
				name: "dsh.sh",
				title: "DSH · 安装",
				desc: "装好 nvm / Node / pnpm，再全局安装 dsh 与 dsh-tui。",
				details: [
					"nvm + Node 22",
					"pnpm（通过 corepack 激活）",
					"@deepseek-ai/dsh、@deepseek-harness-tui/dsh-tui",
					"把 DEEPSEEK_API_KEY 写入 ~/.dsh/.env",
				],
				note: "运行过程中会提示输入 DEEPSEEK_API_KEY；已配置过则自动跳过。",
			},
		],
	},
];

export function getResourceCategory(
	slug: string,
): ResourceCategory | undefined {
	return RESOURCE_CATEGORIES.find((c) => c.slug === slug);
}
