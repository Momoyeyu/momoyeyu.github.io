import type { CollectionEntry } from "astro:content";
import {
	assignSeriesMetadata,
	getSortedPosts,
	getSortedPostsList,
	getTagList,
	getCategoryList,
} from "@utils/content-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const { collectionPosts } = vi.hoisted(() => ({ collectionPosts: [] as unknown[] }));
vi.mock("astro:content", () => ({
	getCollection: async (_name: string, filter: (post: unknown) => boolean) =>
		structuredClone(collectionPosts).filter(filter),
}));

afterEach(() => vi.unstubAllEnvs());

describe("post visibility", () => {
	it.each([true, false])("filters every content query with PROD=%s", async (prod) => {
		vi.stubEnv("PROD", prod);
		collectionPosts.splice(0, collectionPosts.length,
			...[
				{ slug: "public", draft: false },
				{ slug: "legacy" },
				{ slug: "draft", draft: true },
			].map(({ slug, ...flags }, index) => ({
				...makePost(slug, slug, index),
				data: {
					...makePost(slug, slug, index).data,
					date: new Date(2026, 0, index + 1),
					tags: [slug],
					...flags,
				},
			})),
		);
		const expected = prod ? ["legacy", "public"] : ["draft", "legacy", "public"];
		const posts = await getSortedPosts();
		expect(posts.map((post) => post.slug)).toEqual(expected);
		expect((await getSortedPostsList()).map((post) => post.slug)).toEqual(expected);
		expect((await getTagList()).map((tag) => tag.name).sort()).toEqual([...expected].sort());
		expect((await getCategoryList()).map((category) => category.name).sort()).toEqual([...expected].sort());
		if (prod) {
			expect(posts[0].data.prevSlug).toBe("public");
			expect(posts[1].data.nextSlug).toBe("legacy");
		}
	});
});

type Post = CollectionEntry<"posts">;

// Minimal fake with only the fields assignSeriesMetadata reads/writes.
function makePost(
	slug: string,
	category: string | null,
	episode?: number,
): Post {
	return {
		slug,
		data: {
			title: `Title ${slug}`,
			category,
			episode,
			seriesPosition: -1,
			seriesTotal: 0,
			seriesPrevSlug: "",
			seriesPrevTitle: "",
			seriesNextSlug: "",
			seriesNextTitle: "",
		},
	} as unknown as Post;
}

function bySlug(posts: Post[]) {
	return Object.fromEntries(posts.map((p) => [p.slug, p.data]));
}

describe("assignSeriesMetadata", () => {
	it("numbers an ordered-category series by episode and wires prev/next", () => {
		const posts = [
			makePost("c", "AI Infra", 2),
			makePost("a", "AI Infra", 0),
			makePost("b", "AI Infra", 1),
		];

		assignSeriesMetadata(posts);
		const data = bySlug(posts);

		// EP is 0-indexed and follows episode order, not array order.
		expect(data.a.seriesPosition).toBe(0);
		expect(data.b.seriesPosition).toBe(1);
		expect(data.c.seriesPosition).toBe(2);
		expect(data.a.seriesTotal).toBe(3);

		// Middle episode links to both neighbours; ends are open.
		expect(data.b.seriesPrevSlug).toBe("a");
		expect(data.b.seriesNextSlug).toBe("c");
		expect(data.a.seriesPrevSlug).toBe("");
		expect(data.c.seriesNextSlug).toBe("");
	});

	it("treats episode purely as a sort key (fractional slots between)", () => {
		const posts = [
			makePost("first", "AI Infra", 1),
			makePost("mid", "AI Infra", 1.5),
			makePost("last", "AI Infra", 2),
		];

		assignSeriesMetadata(posts);
		const data = bySlug(posts);

		expect(data.first.seriesPosition).toBe(0);
		expect(data.mid.seriesPosition).toBe(1);
		expect(data.last.seriesPosition).toBe(2);
	});

	it("numbers every category as a series", () => {
		const posts = [
			makePost("later", "随笔", 1),
			makePost("earlier", "随笔", 0),
		];

		assignSeriesMetadata(posts);
		const data = bySlug(posts);

		expect(data.earlier.seriesPosition).toBe(0);
		expect(data.later.seriesPosition).toBe(1);
		expect(data.earlier.seriesTotal).toBe(2);
	});

	it("ignores posts without an episode or without a category", () => {
		const posts = [
			makePost("noep", "AI Infra", undefined),
			makePost("nocat", null, 0),
		];

		assignSeriesMetadata(posts);

		expect(posts[0].data.seriesPosition).toBe(-1);
		expect(posts[1].data.seriesPosition).toBe(-1);
	});
});
