#!/usr/bin/env node
/* Interactive scaffold for a new post: creates src/content/posts/<slug>.md with a
 * complete frontmatter block. Run it with `make new`.
 *
 * Everything it needs is derived from the posts that already exist:
 *   - the category menu and the next `episode` per category
 *   - a filename prefix per category (e.g. C++ -> "cpp", LLM -> "llm")
 * There is no category registry: a category exists as soon as a post uses it. */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

const POSTS_DIR = "src/content/posts";
const DEFAULT_LANG = "zh_CN";

/* ------------------------------- frontmatter ------------------------------ */

function frontmatterOf(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return match ? match[1] : null;
}

function fieldOf(frontmatter, key) {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function loadPosts() {
	return fs
		.readdirSync(POSTS_DIR)
		.filter((file) => /\.mdx?$/.test(file))
		.map((file) => {
			const frontmatter = frontmatterOf(
				fs.readFileSync(path.join(POSTS_DIR, file), "utf-8"),
			);
			if (!frontmatter) return null;
			const episode = Number(fieldOf(frontmatter, "episode"));
			return {
				slug: file.replace(/\.mdx?$/, ""),
				category: (fieldOf(frontmatter, "category") || "").trim(),
				episode: Number.isFinite(episode) ? episode : null,
				tags: (frontmatter.match(/^tags:\s*\[(.*)\]$/m)?.[1] || "")
					.split(",")
					.map((tag) => tag.trim().replace(/^['"]|['"]$/g, ""))
					.filter(Boolean),
			};
		})
		.filter(Boolean);
}

function categoryStats(posts) {
	const stats = new Map();
	for (const post of posts) {
		if (!post.category) continue;
		if (!stats.has(post.category)) {
			stats.set(post.category, {
				name: post.category,
				count: 0,
				slugs: [],
				maxEpisode: -1,
				episodes: new Set(),
			});
		}
		const stat = stats.get(post.category);
		stat.count++;
		stat.slugs.push(post.slug);
		if (post.episode !== null) {
			stat.maxEpisode = Math.max(stat.maxEpisode, post.episode);
			stat.episodes.add(post.episode);
		}
	}
	// Biggest series first, then alphabetical.
	return [...stats.values()].sort(
		(a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"),
	);
}

function longestCommonPrefix(values) {
	if (values.length === 0) return "";
	let prefix = values[0];
	for (const value of values) {
		while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
		if (prefix === "") return "";
	}
	return prefix;
}

/* Filename prefix for a series, taken from the filenames it already has: the
 * slugs sharing the most common first segment vote ("ai-infra-intro" +
 * "ai-infra-roadmap" -> "ai-infra"). Series whose slugs share nothing, like the
 * essays, simply get no suggestion. */
function suggestPrefix(slugs) {
	if (slugs.length === 0) return "";
	if (slugs.length === 1) return slugs[0].split("-").slice(0, -1).join("-");

	const groups = new Map();
	for (const slug of slugs) {
		const head = slug.split("-")[0];
		if (!groups.has(head)) groups.set(head, []);
		groups.get(head).push(slug);
	}
	const winner = [...groups.values()].sort((a, b) => b.length - a.length)[0];
	if (winner.length < 2) return "";
	const prefix = longestCommonPrefix(winner);
	return prefix.endsWith("-") ? prefix.slice(0, -1) : prefix;
}

/* ----------------------------------- yaml --------------------------------- */

// Plain YAML unless the value would be ambiguous, in which case single-quote it.
const NEEDS_QUOTES = /[:#\[\]{}&*!|>'"%@`,\n\t]|^[-?]|^\s|\s$|^-?\d+(\.\d+)?$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

function yamlString(value) {
	const text = String(value).trim();
	const isPlain = text !== "" && !NEEDS_QUOTES.test(text) && !RESERVED.test(text);
	return isPlain ? text : `'${text.replace(/'/g, "''")}'`;
}

function yamlTags(tags) {
	return `[${tags.map(yamlString).join(", ")}]`;
}

/* ---------------------------------- input --------------------------------- */

function localDate() {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

function slugify(title) {
	return title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Line queue instead of rl.question(): a pasted or piped chunk arrives as many
// lines at once, and lines with no question pending would otherwise be dropped.
const pendingLines = [];
const lineWaiters = [];

function nextLine() {
	if (pendingLines.length > 0) return Promise.resolve(pendingLines.shift());
	return new Promise((resolve) => lineWaiters.push(resolve));
}

async function ask(question, fallback = "") {
	const hint = fallback ? ` [${fallback}]` : "";
	process.stdout.write(`${question}${hint}: `);
	const answer = (await nextLine()).trim();
	return answer === "" ? fallback : answer;
}

async function askRequired(question, fallback = "") {
	while (true) {
		const answer = await ask(question, fallback);
		if (answer !== "") return answer;
		console.log("  这一项不能为空，请重新输入。");
	}
}

/* ----------------------------------- main --------------------------------- */

const posts = loadPosts();
const categories = categoryStats(posts);
const tagCounts = new Map();
for (const post of posts) {
	for (const tag of post.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
}
const popularTags = [...tagCounts.entries()]
	.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
	.slice(0, 12)
	.map(([tag]) => tag);

process.on("SIGINT", () => {
	console.log("\n已取消，未创建任何文件。");
	process.exit(130);
});

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: process.stdin.isTTY,
});
rl.on("line", (line) => {
	const waiter = lineWaiters.shift();
	if (waiter) waiter(line);
	else pendingLines.push(line);
});
rl.on("close", () => {
	if (lineWaiters.length > 0) {
		console.log("\n输入已结束，未创建任何文件。");
		process.exit(1);
	}
});

console.log("\n新建文章\n");

const title = await askRequired("标题");

console.log("\n选择分类：");
if (categories.length === 0) {
	console.log("  （还没有任何分类，直接输入一个新分类名）");
} else {
	categories.forEach((category, index) => {
		console.log(
			`  ${String(index + 1).padStart(2)}) ${category.name}  (${category.count} 篇，下一个 EP.${category.maxEpisode + 1})`,
		);
	});
	console.log("   0) 新建分类");
}

let category = "";
while (category === "") {
	const answer = await ask("分类编号或名称", categories.length > 0 ? "1" : "");
	if (answer === "") {
		console.log("  请输入分类编号或名称。");
		continue;
	}
	const picked = Number.parseInt(answer, 10);
	if (
		Number.isInteger(picked) &&
		picked >= 1 &&
		picked <= categories.length &&
		String(picked) === answer
	) {
		category = categories[picked - 1].name;
		continue;
	}
	if (answer === "0") {
		category = await askRequired("新分类名称");
		console.log(`  新分类「${category}」会随这篇文章一起诞生。`);
		continue;
	}
	// Reuse the exact spelling of an existing category instead of a near-duplicate.
	const existing = categories.find(
		(item) => item.name.toLowerCase() === answer.toLowerCase(),
	);
	category = existing ? existing.name : answer;
	if (!existing) console.log(`  新分类「${category}」会随这篇文章一起诞生。`);
}

const known = categories.find((item) => item.name === category);
let prefix = known ? suggestPrefix(known.slugs) : "";
if (!known) {
	prefix = await ask("文件名前缀（可留空，例如 llm）", "");
}

const titleSlug = slugify(title);
const suggestion = [prefix, titleSlug].filter(Boolean).join("-");

let slug = "";
while (slug === "") {
	const answer = await ask(
		`文件名（不含 .md）${suggestion ? "" : "，中文标题请取一个英文短名"}`,
		suggestion,
	);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(answer)) {
		console.log("  只能用英文小写、数字和连字符，例如 attention-math。");
		continue;
	}
	if (fs.existsSync(path.join(POSTS_DIR, `${answer}.md`))) {
		console.log(`  ${answer}.md 已存在，换一个名字。`);
		continue;
	}
	slug = answer;
}

const description = await ask("简介（可留空）", "");
const tags = [
	...new Set(
		(
			await ask(
				`标签（空格或逗号分隔）${popularTags.length ? `，已有：${popularTags.join(" / ")}` : ""}`,
				"",
			)
		)
			.split(/[,，\s]+/)
			.filter(Boolean),
	),
];

const nextEpisode = known ? known.maxEpisode + 1 : 0;
let episode = Number.NaN;
while (!Number.isFinite(episode)) {
	const answer = await ask("EP（回车用默认，也可填 2.5 插队）", String(nextEpisode));
	episode = Number(answer);
	if (!Number.isFinite(episode)) console.log("  EP 需要是一个数字。");
}
if (known?.episodes.has(episode)) {
	console.log(`  注意：${category} 已有 EP.${episode}，两篇会并列，建议换一个。`);
}

const frontmatter = [
	"---",
	`title: ${yamlString(title)}`,
	`date: ${localDate()}`,
	`description: ${yamlString(description)}`,
	`tags: ${yamlTags(tags)}`,
	`category: ${yamlString(category)}`,
	`episode: ${episode}`,
	"draft: true",
	`lang: ${yamlString(DEFAULT_LANG)}`,
	"---",
].join("\n");

const target = path.join(POSTS_DIR, `${slug}.md`);
console.log(`\n即将创建 ${target}\n`);
console.log(frontmatter);
console.log("");

const confirmed = await ask("确认写入？(Y/n)", "Y");
rl.close();
if (!/^y(es)?$/i.test(confirmed)) {
	console.log("已取消，未创建任何文件。");
	process.exit(0);
}

fs.writeFileSync(target, `${frontmatter}\n`);
console.log(`\n✓ 已创建 ${target}`);
console.log(`  分类「${category}」· EP.${episode} · draft: true（暂时不会发布）`);
console.log("\n接下来：写完正文后把 draft 改成 false，然后 make deploy\n");
