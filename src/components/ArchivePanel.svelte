<script lang="ts">
import { onMount } from "svelte";
import { fly } from "svelte/transition";

import I18nKey from "../i18n/i18nKey";
import { i18n } from "../i18n/translation";
import { getPostUrlBySlug } from "../utils/url-utils";

// Defaulted because the real values are read from URL params in onMount;
// callers (archive.astro) intentionally don't pass tags/categories.
export let tags: string[] = [];
export let categories: string[] = [];
export let sortedPosts: Post[] = [];
// Names of categories that are ordered series (see src/constants/categories.ts).
export let orderedCategories: string[] = [];

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
		published: Date;
	};
}

interface Group {
	year: number;
	posts: Post[];
	isSeries?: boolean;
	label?: string;
}

type SortMode = "episode-desc" | "episode-asc" | "date-desc" | "date-asc";

const SORT_META: Record<SortMode, { label: string; hint: string }> = {
	"episode-desc": { label: "EP 倒序", hint: "最新一集在前" },
	"episode-asc": { label: "EP 正序", hint: "第一集在前" },
	"date-desc": { label: "日期 倒序", hint: "最近发布在前" },
	"date-asc": { label: "日期 正序", hint: "最早发布在前" },
};

let groups: Group[] = [];
let filteredPosts: Post[] = [];
let seriesPosts: Post[] = [];
let canUseSeries = false;
let sortMode: SortMode = "date-desc";
let mounted = false;
let isMenuOpen = false;

function formatDate(date: Date) {
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${month}-${day}`;
}

function formatTag(tagList: string[]) {
	return tagList.map((t) => `#${t}`).join(" ");
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
		(a, b) =>
			dateMul * (a.data.published.getTime() - b.data.published.getTime()),
	);

	const grouped = datePosts.reduce(
		(acc, post) => {
			const year = post.data.published.getFullYear();
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

function setSort(mode: SortMode) {
	sortMode = mode;
	isMenuOpen = false;
	rebuildGroups();
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
	// EP sort is offered only for categories explicitly registered as ordered
	// series. Series mode shows the episode posts; date mode shows everything.
	const isOrderedCategory =
		singleCategory && orderedCategories.includes(categories[0]);
	canUseSeries = isOrderedCategory && seriesPosts.length >= 1;

	sortMode = canUseSeries ? "episode-desc" : "date-desc";
	rebuildGroups();
	mounted = true;
});
</script>

<svelte:window on:keydown={handleKeydown} />

{#if mounted && filteredPosts.length > 1}
    <div class="flex justify-start mb-3" use:clickOutside>
        <div class="relative">
            <button
                type="button"
                class="sort-trigger"
                class:open={isMenuOpen}
                aria-haspopup="listbox"
                aria-expanded={isMenuOpen}
                aria-label="切换排序方式"
                on:click={toggleMenu}
            >
                <svg class="sort-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M3 7h13v2H3zm0 4h10v2H3zm0 4h7v2H3zm14-2v6l-3-3zm0-2V5l3 3z" />
                </svg>
                <span class="trigger-label">{SORT_META[sortMode].label}</span>
                <svg class="chevron" class:flip={isMenuOpen} viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                </svg>
            </button>

            {#if isMenuOpen}
                <div
                    class="sort-menu"
                    role="listbox"
                    transition:fly={{ y: -4, duration: 130 }}
                >
                    {#if canUseSeries}
                        <button
                            type="button"
                            class="sort-item"
                            class:selected={sortMode === "episode-desc"}
                            role="option"
                            aria-selected={sortMode === "episode-desc"}
                            on:click={() => setSort("episode-desc")}
                        >
                            <span class="item-label">{SORT_META["episode-desc"].label}</span>
                            <span class="item-hint">{SORT_META["episode-desc"].hint}</span>
                        </button>
                        <button
                            type="button"
                            class="sort-item"
                            class:selected={sortMode === "episode-asc"}
                            role="option"
                            aria-selected={sortMode === "episode-asc"}
                            on:click={() => setSort("episode-asc")}
                        >
                            <span class="item-label">{SORT_META["episode-asc"].label}</span>
                            <span class="item-hint">{SORT_META["episode-asc"].hint}</span>
                        </button>
                        <div class="divider"></div>
                    {/if}
                    <button
                        type="button"
                        class="sort-item"
                        class:selected={sortMode === "date-desc"}
                        role="option"
                        aria-selected={sortMode === "date-desc"}
                        on:click={() => setSort("date-desc")}
                    >
                        <span class="item-label">{SORT_META["date-desc"].label}</span>
                        <span class="item-hint">{SORT_META["date-desc"].hint}</span>
                    </button>
                    <button
                        type="button"
                        class="sort-item"
                        class:selected={sortMode === "date-asc"}
                        role="option"
                        aria-selected={sortMode === "date-asc"}
                        on:click={() => setSort("date-asc")}
                    >
                        <span class="item-label">{SORT_META["date-asc"].label}</span>
                        <span class="item-hint">{SORT_META["date-asc"].hint}</span>
                    </button>
                </div>
            {/if}
        </div>
    </div>
{/if}

<div class="card-base px-6 md:px-8 py-6">
    {#each groups as group}
        <div>
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

            {#each group.posts as post}
                <a
                        href={getPostUrlBySlug(post.slug)}
                        aria-label={post.data.title}
                        class="group btn-plain !block h-10 w-full rounded-lg hover:text-[initial]"
                >
                    <div class="flex flex-row justify-start items-center h-full">
                        <!-- date or episode -->
                        <div class="w-[15%] md:w-[10%] transition text-sm text-right text-50">
                            {#if group.isSeries && typeof post.data.seriesPosition === "number" && post.data.seriesPosition >= 0}
                                EP.{post.data.seriesPosition}
                            {:else}
                                {formatDate(post.data.published)}
                            {/if}
                        </div>

                        <!-- dot and line -->
                        <div class="w-[15%] md:w-[10%] relative dash-line h-full flex items-center">
                            <div
                                    class="transition-all mx-auto w-1 h-1 rounded group-hover:h-5
                       bg-[oklch(0.5_0.05_var(--hue))] group-hover:bg-[var(--primary)]
                       outline outline-4 z-50
                       outline-[var(--card-bg)]
                       group-hover:outline-[var(--btn-plain-bg-hover)]
                       group-active:outline-[var(--btn-plain-bg-active)]"
                            ></div>
                        </div>

                        <!-- post title -->
                        <div
                                class="w-[70%] md:max-w-[65%] md:w-[65%] text-left font-bold
                     group-hover:translate-x-1 transition-all group-hover:text-[var(--primary)]
                     text-75 pr-8 whitespace-nowrap overflow-ellipsis overflow-hidden"
                        >
                            {post.data.title}
                        </div>

                        <!-- tag list -->
                        <div
                                class="hidden md:block md:w-[15%] text-left text-sm transition
                     whitespace-nowrap overflow-ellipsis overflow-hidden text-30"
                        >
                            {formatTag(post.data.tags)}
                        </div>
                    </div>
                </a>
            {/each}
        </div>
    {/each}
</div>

<style>
.sort-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.65rem 0.3rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: 9999px;
    background: var(--btn-regular-bg);
    color: var(--btn-content);
    transition:
        background 0.18s ease,
        color 0.18s ease;
    cursor: pointer;
    border: none;
    line-height: 1;
}
.sort-trigger:hover {
    background: var(--btn-regular-bg-hover);
    color: var(--primary);
}
.sort-trigger.open {
    background: var(--btn-regular-bg-active);
    color: var(--primary);
}
.sort-trigger .sort-icon {
    width: 0.85rem;
    height: 0.85rem;
    opacity: 0.7;
}
.sort-trigger:hover .sort-icon,
.sort-trigger.open .sort-icon {
    opacity: 1;
}
.sort-trigger .trigger-label {
    line-height: 1;
}
.sort-trigger .chevron {
    width: 0.65rem;
    height: 0.65rem;
    opacity: 0.6;
    transition: transform 0.2s ease;
}
.sort-trigger .chevron.flip {
    transform: rotate(180deg);
}

.sort-menu {
    position: absolute;
    top: calc(100% + 0.35rem);
    left: 0;
    min-width: 10.5rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 0.7rem;
    padding: 0.25rem;
    box-shadow:
        0 3px 10px rgba(0, 0, 0, 0.05),
        0 10px 24px rgba(0, 0, 0, 0.08);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
}
:global([data-theme="dark"]) .sort-menu {
    box-shadow:
        0 3px 10px rgba(0, 0, 0, 0.3),
        0 10px 24px rgba(0, 0, 0, 0.45);
}

.sort-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.05rem;
    padding: 0.35rem 0.55rem;
    background: transparent;
    border: none;
    border-radius: 0.45rem;
    color: var(--btn-content);
    text-align: left;
    cursor: pointer;
    transition:
        background 0.15s ease,
        color 0.15s ease;
    width: 100%;
}
.sort-item:hover {
    background: var(--btn-regular-bg);
    color: var(--primary);
}
.sort-item.selected {
    background: var(--primary);
    color: white;
}
:global([data-theme="dark"]) .sort-item.selected {
    color: rgba(0, 0, 0, 0.85);
}
.sort-item .item-label {
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.1;
}
.sort-item .item-hint {
    font-size: 0.625rem;
    opacity: 0.7;
    line-height: 1.2;
}

.divider {
    height: 1px;
    background: rgba(0, 0, 0, 0.08);
    margin: 0.2rem 0.35rem;
}
:global([data-theme="dark"]) .divider {
    background: rgba(255, 255, 255, 0.1);
}
</style>
