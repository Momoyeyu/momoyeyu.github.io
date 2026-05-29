import { type CollectionEntry, getCollection } from "astro:content";
import { isOrderedCategory } from "@constants/categories.ts";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getCategoryUrl } from "@utils/url-utils.ts";

async function getRawSortedPosts() {
	const allBlogPosts = await getCollection("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	const sorted = allBlogPosts.sort((a, b) => {
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});
	return sorted;
}

// Assigns series metadata (position, total, prev/next) to each post in a series.
// A "series" = group of posts under a category registered as an ordered series
// (see src/constants/categories.ts). The displayed EP number is the auto-numbered
// position (1..N) within the series; the raw `episode` value is only used as a
// sort key, so inserting a new article with episode: 2.5 cleanly slots in without
// renumbering siblings.
function assignSeriesMetadata(sorted: CollectionEntry<"posts">[]) {
	const byCategory: Record<string, CollectionEntry<"posts">[]> = {};
	for (const post of sorted) {
		const cat = post.data.category;
		if (!isOrderedCategory(cat)) continue;
		if (typeof post.data.episode !== "number") continue;
		if (!byCategory[cat as string]) byCategory[cat as string] = [];
		byCategory[cat as string].push(post);
	}
	for (const cat of Object.keys(byCategory)) {
		const arr = byCategory[cat]
			.slice()
			.sort((a, b) => (a.data.episode as number) - (b.data.episode as number));
		const total = arr.length;
		for (let i = 0; i < total; i++) {
			// EP is 0-indexed (programmer-style): first episode is EP.0.
			arr[i].data.seriesPosition = i;
			arr[i].data.seriesTotal = total;
			if (i > 0) {
				arr[i].data.seriesPrevSlug = arr[i - 1].slug;
				arr[i].data.seriesPrevTitle = arr[i - 1].data.title;
			}
			if (i < total - 1) {
				arr[i].data.seriesNextSlug = arr[i + 1].slug;
				arr[i].data.seriesNextTitle = arr[i + 1].data.title;
			}
		}
	}
}

export async function getSortedPosts() {
	const sorted = await getRawSortedPosts();

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].slug;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].slug;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	assignSeriesMetadata(sorted);

	// Float pinned posts to the top of the list. Done after prev/next
	// wiring above so chronological navigation on post pages is preserved.
	sorted.sort((a, b) => {
		const pa = a.data.pinned ? 1 : 0;
		const pb = b.data.pinned ? 1 : 0;
		return pb - pa;
	});

	return sorted;
}
export type PostForList = {
	slug: string;
	data: CollectionEntry<"posts">["data"];
};
export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();
	assignSeriesMetadata(sortedFullPosts);

	const sortedPostsList = sortedFullPosts.map((post) => ({
		slug: post.slug,
		data: post.data,
	}));

	return sortedPostsList;
}
export type Tag = {
	name: string;
	count: number;
};

export async function getTagList(): Promise<Tag[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	const countMap: { [key: string]: number } = {};
	allBlogPosts.forEach((post: { data: { tags: string[] } }) => {
		post.data.tags.forEach((tag: string) => {
			if (!countMap[tag]) countMap[tag] = 0;
			countMap[tag]++;
		});
	});

	// sort tags
	const keys: string[] = Object.keys(countMap).sort((a, b) => {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});

	return keys.map((key) => ({ name: key, count: countMap[key] }));
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export async function getCategoryList(): Promise<Category[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});
	const count: { [key: string]: number } = {};
	allBlogPosts.forEach((post: { data: { category: string | null } }) => {
		if (!post.data.category) {
			const ucKey = i18n(I18nKey.uncategorized);
			count[ucKey] = count[ucKey] ? count[ucKey] + 1 : 1;
			return;
		}

		const categoryName =
			typeof post.data.category === "string"
				? post.data.category.trim()
				: String(post.data.category).trim();

		count[categoryName] = count[categoryName] ? count[categoryName] + 1 : 1;
	});

	const lst = Object.keys(count).sort((a, b) => {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});

	const ret: Category[] = [];
	for (const c of lst) {
		ret.push({
			name: c,
			count: count[c],
			url: getCategoryUrl(c),
		});
	}
	return ret;
}
