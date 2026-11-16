import { describe, expect, it } from "vitest";
import { countArchivePosts } from "./archive-utils";

describe("archive counts", () => {
	it("counts articles rather than repeated occurrences of a tag", () => {
		const { categoryCounts, tagCounts } = countArchivePosts([
			{ data: { category: "LLM", tags: ["Attention", "Attention", "GPU"] } },
			{ data: { category: "LLM", tags: ["GPU"] } },
			{ data: { category: "Math", tags: ["Attention"] } },
		]);
		expect([...categoryCounts]).toEqual([["LLM", 2], ["Math", 1]]);
		expect([...tagCounts]).toEqual([["Attention", 2], ["GPU", 2]]);
	});

	it("preserves category and tag names without trimming or merging their case", () => {
		const { categoryCounts, tagCounts } = countArchivePosts([
			{ data: { category: "LLM", tags: ["GPU", ""] } },
			{ data: { category: "llm", tags: ["gpu"] } },
			{ data: { category: " LLM ", tags: [" GPU "] } },
			{ data: { category: "__proto__", tags: ["constructor"] } },
		]);
		expect([...categoryCounts.keys()]).toEqual(["LLM", "llm", " LLM ", "__proto__"]);
		expect([...tagCounts.keys()]).toEqual(["GPU", "", "gpu", " GPU ", "constructor"]);
	});

	it("keeps tags on uncategorized articles while omitting empty categories", () => {
		const { categoryCounts, tagCounts } = countArchivePosts([
			{ data: { tags: ["GPU"] } },
			{ data: { category: null, tags: ["GPU"] } },
			{ data: { category: "", tags: [] } },
		]);
		expect(categoryCounts.size).toBe(0);
		expect(tagCounts.get("GPU")).toBe(2);
	});

	it("returns empty counts for an empty collection", () => {
		const { categoryCounts, tagCounts } = countArchivePosts([]);
		expect(categoryCounts.size).toBe(0);
		expect(tagCounts.size).toBe(0);
	});

	it("matches the previous filter-based calculation across varied collections", () => {
		const categories = [undefined, null, "", "LLM", "Math", "llm"];
		const tags = ["Attention", "GPU", "GPU", "", "gpu"];
		for (let length = 0; length <= 60; length++) {
			const posts = Array.from({ length }, (_, i) => ({
				data: {
					category: categories[i % categories.length],
					tags: Array.from({ length: i % 5 }, (_, j) => tags[(i + j) % tags.length]),
				},
			}));
			const before = structuredClone(posts);
			const { categoryCounts, tagCounts } = countArchivePosts(posts);
			const expectedCategories = [...new Set(posts.map(post => post.data.category).filter((category): category is string => !!category))].sort();
			const expectedTags = [...new Set(posts.flatMap(post => post.data.tags))].sort();
			expect([...categoryCounts.keys()].sort()).toEqual(expectedCategories);
			expect([...tagCounts.keys()].sort()).toEqual(expectedTags);
			for (const category of expectedCategories) {
				expect(categoryCounts.get(category)).toBe(posts.filter(post => post.data.category === category).length);
			}
			for (const tag of expectedTags) {
				expect(tagCounts.get(tag)).toBe(posts.filter(post => post.data.tags.includes(tag)).length);
			}
			expect(posts).toEqual(before);
		}
	});

	it("reads each article's metadata once regardless of the number of tags", () => {
		let categoryReads = 0;
		let tagReads = 0;
		const posts = Array.from({ length: 100 }, (_, index) => ({
			data: {
				get category() { categoryReads++; return "LLM"; },
				get tags() { tagReads++; return [`tag-${index}`, "GPU"]; },
			},
		}));
		const { categoryCounts, tagCounts } = countArchivePosts(posts);
		expect(categoryCounts.get("LLM")).toBe(100);
		expect(tagCounts.get("GPU")).toBe(100);
		expect(tagCounts.size).toBe(101);
		expect(categoryReads).toBe(100);
		expect(tagReads).toBe(100);
	});
});
