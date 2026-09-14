import { defineCollection, z } from "astro:content";

// Every category is a series (合集). The archive groups posts by `category`,
// orders them by `episode` and renders series navigation, so `episode` is
// required on every post — there is no "plain category" kind anymore.
const postsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		date: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		pinned: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default(""),
		episode: z.number(),
		lang: z.string().optional().default(""),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
		seriesPrevTitle: z.string().default(""),
		seriesPrevSlug: z.string().default(""),
		seriesNextTitle: z.string().default(""),
		seriesNextSlug: z.string().default(""),
		seriesPosition: z.number().default(-1),
		seriesTotal: z.number().default(0),
	}),
});
const specCollection = defineCollection({
	schema: z.object({}),
});
export const collections = {
	posts: postsCollection,
	spec: specCollection,
};
