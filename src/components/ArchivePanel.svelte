<script lang="ts">
import { onMount, tick } from "svelte";
import SectionParticles from "./SectionParticles.svelte";
import { fly } from "svelte/transition";

import I18nKey from "../i18n/i18nKey";
import { i18n } from "../i18n/translation";
import { getPostUrlBySlug, getTagUrl, url } from "../utils/url-utils";

// Defaulted because the real values are read from URL params in onMount;
// callers (archive.astro) intentionally don't pass tags/categories.
export let tags: string[] = [];
export let categories: string[] = [];
export let sortedPosts: Post[] = [];

const categoryOptions = [...new Set(sortedPosts.map(post => post.data.category).filter((category): category is string => !!category))].sort();
const tagOptions = [...new Set(sortedPosts.flatMap(post => post.data.tags))].sort();
const tagCount = (tag: string) => sortedPosts.filter(post => post.data.tags.includes(tag)).length;
const categoryCount = (category: string) => sortedPosts.filter(post => post.data.category === category).length;
function filterUrl(kind: "category" | "tag", value: string) {
    const next = new URLSearchParams(window.location.search);
    next.delete("uncategorized");
    const active = next.getAll(kind).includes(value);
    next.delete(kind);
    if (!active) next.set(kind, value);
    return url("/archive/") + (next.size ? `?${next}` : "");
}

const params = new URLSearchParams(window.location.search);
tags = params.has("tag") ? params.getAll("tag") : [];
categories = params.has("category") ? params.getAll("category") : [];
const uncategorized = params.get("uncategorized");

interface Post {
	slug: string;
	data: {
		title: string;
		tags: string[];
		category?: string | null;
		episode?: number;
		seriesPosition?: number;
		date: Date;
	};
}

interface Group {
	year: number;
	posts: Post[];
	isSeries?: boolean;
	label?: string;
}

type SortMode = "episode-desc" | "episode-asc" | "date-desc" | "date-asc";

function setSortBasis(basis: "episode" | "date") {
    void setSort(`${basis}-${sortMode.endsWith("asc") ? "asc" : "desc"}` as SortMode);
}
function reverseSort() {
    void setSort(`${sortMode.startsWith("episode") ? "episode" : "date"}-${sortMode.endsWith("asc") ? "desc" : "asc"}` as SortMode);
}
function chapterLabel(position: number) { return i18n(I18nKey.chapterNumber).replace("{n}", String(position + 1)); }

// In dev, astro:data-layer-content can transiently resolve to an empty store
// (cache invalidation race while content files are being saved). The empty
// props get baked into the island, so reload once to re-render with real data.
const EMPTY_RETRY_KEY = "archive:empty-retry";

let groups: Group[] = [];
let filteredPosts: Post[] = [];
let seriesPosts: Post[] = [];
let canUseSeries = false;
let sortMode: SortMode = "date-desc";
let mounted = false;
let isMenuOpen = false;

let activePeriod = "";
function monthKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(date: Date) { return new Intl.DateTimeFormat((document.documentElement.lang || "zh-CN").replace("_", "-"), { month: "short" }).format(date); }
function monthsIn(group: Group) { return [...new Map(group.posts.map(post => [monthKey(post.data.date), post.data.date])).entries()].sort(([a], [b]) => b.localeCompare(a)); }
function jumpToPeriod(event: MouseEvent, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault(); activePeriod = id;
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
}

function formatDate(date: Date) {
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${month}-${day}`;
}

function rebuildGroups() {
	if (sortMode === "episode-desc" || sortMode === "episode-asc") {
		const direction = sortMode === "episode-desc" ? -1 : 1;
		const ordered = [...seriesPosts].sort(
			(a, b) => direction * ((a.data.episode ?? 0) - (b.data.episode ?? 0)),
		);
		groups = [
			{
				year: 0,
				isSeries: true,
				label: categories[0] ?? "",
				posts: ordered,
			},
		];
		return;
	}

	const dateMul = sortMode === "date-desc" ? -1 : 1;
	const datePosts = [...filteredPosts].sort(
		(a, b) => dateMul * (a.data.date.getTime() - b.data.date.getTime()),
	);

	const grouped = datePosts.reduce(
		(acc, post) => {
			const year = post.data.date.getFullYear();
			if (!acc[year]) acc[year] = [];
			acc[year].push(post);
			return acc;
		},
		{} as Record<number, Post[]>,
	);

	const arr = Object.keys(grouped).map((y) => ({
		year: Number.parseInt(y, 10),
		posts: grouped[Number.parseInt(y, 10)],
	}));
	arr.sort((a, b) =>
		sortMode === "date-desc" ? b.year - a.year : a.year - b.year,
	);
	groups = arr;
}

async function setSort(mode: SortMode) {
    isMenuOpen = false;
	document.dispatchEvent(new Event("post-layout:before"));
	sortMode = mode;
	rebuildGroups();
	await tick();
	document.dispatchEvent(new Event("post-layout:after"));
}

function positionSortMenu(node: HTMLDivElement) {
    const trigger = node.parentElement?.querySelector<HTMLButtonElement>(".sort-trigger");
    if (!trigger) return;
    const place = () => {
        const rect = trigger.getBoundingClientRect();
        node.style.width = `${rect.width}px`;
        node.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px`;
        const height = node.offsetHeight;
        node.style.top = `${rect.bottom + height + 6 <= innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`;
    };
    node.showPopover(); place();
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return { destroy() { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); } };
}

function toggleMenu() {
	isMenuOpen = !isMenuOpen;
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape" && isMenuOpen) {
		isMenuOpen = false;
	}
}

function clickOutside(node: HTMLElement) {
	const handler = (event: MouseEvent) => {
		if (isMenuOpen && !node.contains(event.target as Node)) {
			isMenuOpen = false;
		}
	};
	document.addEventListener("click", handler);
	return {
		destroy() {
			document.removeEventListener("click", handler);
		},
	};
}

onMount(() => {
	if (import.meta.env.DEV && sortedPosts.length === 0) {
		if (!sessionStorage.getItem(EMPTY_RETRY_KEY)) {
			sessionStorage.setItem(EMPTY_RETRY_KEY, "1");
			setTimeout(() => window.location.reload(), 300);
		} else {
			sessionStorage.removeItem(EMPTY_RETRY_KEY);
		}
		return;
	}

	let pool: Post[] = sortedPosts;

	if (tags.length > 0) {
		pool = pool.filter(
			(post) =>
				Array.isArray(post.data.tags) &&
				post.data.tags.some((tag) => tags.includes(tag)),
		);
	}

	if (categories.length > 0) {
		pool = pool.filter(
			(post) => post.data.category && categories.includes(post.data.category),
		);
	}

	if (uncategorized) {
		pool = pool.filter((post) => !post.data.category);
	}

	filteredPosts = pool;
	seriesPosts = filteredPosts.filter((p) => typeof p.data.episode === "number");

	const singleCategory =
		categories.length === 1 && tags.length === 0 && !uncategorized;
	// Every category is a series, so the EP sort is offered as soon as the list is
	// narrowed down to a single category. Series mode shows the episode posts;
	// date mode shows everything.
	canUseSeries = singleCategory && seriesPosts.length >= 1;

	sortMode = canUseSeries ? "episode-desc" : "date-desc";
	rebuildGroups();
	mounted = true;
	void tick().then(() => document.dispatchEvent(new Event("post-layout:after")));
});
</script>


<svelte:window on:keydown={handleKeydown} />

{#if !categories.length && !tags.length && !uncategorized}
<div class="archive-discovery">
    <section class="archive-collections card-base">
        <header><h2>{i18n(I18nKey.categories)}</h2><a class="archive-reset" href={url('/archive/')} aria-current={!categories.length && !tags.length && !uncategorized ? "true" : undefined}>{i18n(I18nKey.allPosts)} <span>{sortedPosts.length}</span></a></header>
        <nav class="archive-categories" aria-label={i18n(I18nKey.categories)}>
            {#each categoryOptions as category}
                <a href={filterUrl("category", category)} class:active={categories.includes(category)} aria-current={categories.includes(category) ? "true" : undefined}>{category}<span>{categoryCount(category)}</span></a>
            {/each}
        </nav>
    </section>
    <SectionParticles />
    <section class="archive-tag-panel card-base">
        <header><h2>{i18n(I18nKey.tags)}</h2><span>{tagOptions.length}</span></header>
        <nav class="archive-tag-cloud" aria-label={i18n(I18nKey.tags)}>
            {#each tagOptions as tag, index}
                <a href={filterUrl("tag", tag)} class:active={tags.includes(tag)} aria-current={tags.includes(tag) ? "true" : undefined}
                    style={`--tag-size: ${.78 + Math.min(.48, Math.log2(tagCount(tag) + 1) * .1)}rem; --tag-rise: ${(index % 3 - 1) * 3}px; --tag-turn: ${(index % 5 - 2) * .8}deg; --tag-delay: ${Math.min(index * 12, 240)}ms`}>#{tag}</a>
            {/each}
        </nav>
    </section>
</div>
<SectionParticles />
<header class="timeline-heading"><h2>{i18n(I18nKey.timelineArchive)}</h2><span>{sortedPosts.length} {i18n(I18nKey.postsCount)}</span></header>
{:else}
<header class="archive-selection"><a href={url('/archive/')}>{i18n(I18nKey.allPosts)} ↗</a><h1>{[...categories, ...tags.map(tag=>`#${tag}`)].join(' · ') || i18n(I18nKey.uncategorized)}</h1></header>
{/if}

{#if mounted && filteredPosts.length > 1}
    <div class="archive-sort-toolbar" use:clickOutside>
        <div class="sort-basis">
            <button type="button" class="sort-trigger" class:open={isMenuOpen} disabled={!canUseSeries}
                aria-haspopup={canUseSeries ? "listbox" : undefined} aria-expanded={canUseSeries ? isMenuOpen : undefined}
                aria-label={i18n(I18nKey.sortBasis)} on:click={toggleMenu}>
                <svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    {#if sortMode.startsWith("episode")}<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4zM13 7a3 3 0 0 1 3-3h4v14h-3a4 4 0 0 0-4 3" />{:else}<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16" />{/if}
                </svg>
                <span>{i18n(sortMode.startsWith("episode") ? I18nKey.chapters : I18nKey.sortByTime)}</span>
                {#if canUseSeries}<svg class="chevron" class:flip={isMenuOpen} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7 10 5 5 5-5" /></svg>{/if}
            </button>
            {#if isMenuOpen && canUseSeries}
                <div class="sort-menu" popover="manual" use:positionSortMenu role="listbox" aria-label={i18n(I18nKey.sortBasis)} transition:fly={{ y: -4, duration: 130 }}>
                    <button type="button" class="sort-item" class:selected={sortMode.startsWith("episode")} role="option" aria-selected={sortMode.startsWith("episode")} on:click={() => setSortBasis("episode")}>{i18n(I18nKey.chapters)}</button>
                    <button type="button" class="sort-item" class:selected={sortMode.startsWith("date")} role="option" aria-selected={sortMode.startsWith("date")} on:click={() => setSortBasis("date")}>{i18n(I18nKey.sortByTime)}</button>
                </div>
            {/if}
        </div>
        <button type="button" class="sort-direction" on:click={reverseSort}
            aria-label={i18n(sortMode.endsWith("asc") ? I18nKey.sortDescending : I18nKey.sortAscending)}
            title={i18n(sortMode.endsWith("asc") ? I18nKey.sortAscending : I18nKey.sortDescending)}>
            <svg class:ascending={sortMode.endsWith("asc")} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 4v16m-5-5 5 5 5-5" /></svg>
        </button>
    </div>
{/if}
<div class="archive-browser" class:with-index={sortMode.startsWith("date")}>
    <nav class="archive-index" aria-label={i18n(I18nKey.archiveIndex)} aria-hidden={sortMode.startsWith("episode")} inert={sortMode.startsWith("episode")}>
        {#if groups.some(group => !group.isSeries)}
        {#each groups.filter(group => !group.isSeries) as group}
            <div class="index-year">
                <a class:active={activePeriod === `archive-year-${group.year}`} href={`#archive-year-${group.year}`} data-no-swup on:click={event => jumpToPeriod(event, `archive-year-${group.year}`)}>{group.year}</a>
                <div>{#each monthsIn(group) as [key, date]}
                    <a class:active={activePeriod === `archive-month-${key}`} href={`#archive-month-${key}`} data-no-swup on:click={event => jumpToPeriod(event, `archive-month-${key}`)}>{monthLabel(date)}</a>
                {/each}</div>
            </div>
        {/each}
        {/if}
    </nav>
<div class="archive-timeline card-base px-6 md:px-8 py-6">

    {#each groups as group (group.isSeries ? "series" : group.year)}
        <section id={`archive-year-${group.year}`} tabindex="-1" class="archive-period">
            <div class="flex flex-row w-full items-center h-[3.75rem]">
                <div class="w-[15%] md:w-[10%] transition text-2xl font-bold text-right text-75 whitespace-nowrap overflow-hidden overflow-ellipsis">
                    {group.isSeries ? group.label : group.year}
                </div>
                <div class="w-[15%] md:w-[10%]">
                    <div
                            class="h-3 w-3 bg-none rounded-full outline outline-[var(--primary)] mx-auto
                  -outline-offset-[2px] z-50 outline-3"
                    ></div>
                </div>
                <div class="w-[70%] md:w-[80%] transition text-left text-50">
                    {group.posts.length} {i18n(group.posts.length === 1 ? I18nKey.postCount : I18nKey.postsCount)}
                </div>
            </div>

            {#each group.posts as post, index (post.slug)}
                {#if !group.isSeries && (index === 0 || monthKey(post.data.date) !== monthKey(group.posts[index - 1].data.date))}
                    <div id={`archive-month-${monthKey(post.data.date)}`} tabindex="-1" class="archive-month archive-period">{monthLabel(post.data.date)}</div>
                {/if}
                <div data-layout-key={`archive:${post.slug}`} class="flex items-center h-10 w-full rounded-lg hover:bg-[var(--btn-plain-bg-hover)] transition">
                    <a href={getPostUrlBySlug(post.slug)} aria-label={post.data.title}
                       class="group flex items-center h-full w-full md:w-[85%] rounded-lg">
                        <!-- date or episode -->
                        <div class="w-[15%] md:w-[11.765%] transition text-sm text-right text-50">
                            {#if group.isSeries && typeof post.data.seriesPosition === "number" && post.data.seriesPosition >= 0}
                                {chapterLabel(post.data.seriesPosition)}
                            {:else}
                                {formatDate(post.data.date)}
                            {/if}
                        </div>

                        <!-- dot and line -->
                        <div class="w-[15%] md:w-[11.765%] relative dash-line h-full flex items-center">
                            <div
                                    class="transition-all mx-auto w-1 h-1 rounded group-hover:h-5
                       bg-[oklch(0.5_0.05_var(--hue))] group-hover:bg-[var(--primary)]
                       outline outline-4 z-50
                       outline-[var(--card-bg)]
                       group-hover:outline-[var(--btn-plain-bg-active)]"
                            ></div>
                        </div>

                        <!-- post title -->
                        <div
                                class="w-[70%] md:w-[76.47%] text-left font-bold
                     group-hover:translate-x-1 transition-all group-hover:text-[var(--primary)]
                     text-75 pr-8 whitespace-nowrap overflow-ellipsis overflow-hidden"
                        >
                            {post.data.title}
                        </div>
                    </a>

                    <!-- tag list -->
                    <div class="hidden md:flex md:w-[15%] gap-1 text-left text-sm whitespace-nowrap overflow-x-auto hide-scrollbar text-30">
                        {#each post.data.tags as tag}
                            <a href={getTagUrl(tag)} aria-label={`${i18n(I18nKey.tags)} · ${tag}`}
                               class="shrink-0 hover:text-[var(--primary)] hover:underline transition">#{tag}</a>
                        {/each}
                    </div>
                </div>
            {/each}
        </section>
    {/each}
</div>

</div>

<style>
.archive-sort-toolbar {display:flex;align-items:center;gap:.4rem;margin-bottom:1.25rem;width:max-content;max-width:100%;color:var(--text-primary);}
.sort-basis {position:relative;min-width:7rem;}
.sort-trigger,.sort-direction {display:flex;align-items:center;justify-content:center;gap:.6rem;background:var(--btn-regular-bg);color:var(--text-secondary);height:2.4rem;border:0;border-radius:.7rem;font-size:.8rem;white-space:nowrap;transition:background-color 180ms,color 180ms;}
.sort-trigger {width:100%;padding-inline:.75rem;}
.sort-trigger:disabled {cursor:default;}
.sort-trigger:not(:disabled):hover,.sort-trigger.open,.sort-direction:hover {background:var(--btn-regular-bg-hover);color:var(--text-primary);}
.sort-icon {width:1rem;height:1rem;flex-shrink:0;}
.chevron {width:.8rem;height:.8rem;margin-left:auto;transition:transform 180ms;}.chevron.flip{transform:rotate(180deg)}
.sort-direction {width:2.4rem;flex-shrink:0;}
.sort-direction svg {width:1.1rem;height:1.1rem;transition:transform 220ms;}.sort-direction svg.ascending{transform:rotate(180deg)}
.sort-menu {box-sizing:border-box;position:fixed;margin:0;min-width:0;padding:.25rem;display:flex;flex-direction:column;gap:.15rem;background:var(--card-bg);color:var(--text-primary);border:0;border-radius:.7rem;box-shadow:0 8px 24px color-mix(in srgb,var(--palette-ink) 20%,transparent);}
.sort-item {width:100%;padding:.7rem .55rem;border:0;border-radius:.45rem;text-align:left;font-size:.8rem;white-space:nowrap;cursor:pointer;color:var(--text-secondary);transition:background-color 150ms,color 150ms;}
.sort-item:hover {background:var(--btn-regular-bg);color:var(--text-primary)}.sort-item.selected{background:var(--primary);color:var(--page-bg)}
@media(prefers-reduced-motion:reduce){.sort-trigger,.sort-direction,.sort-direction svg,.chevron,.sort-item{transition:none}}
</style>
