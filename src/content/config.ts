import { defineCollection, z } from "astro:content";
import { isOrderedCategory } from "@constants/categories.ts";

const postsCollection = defineCollection({
	schema: z
		.object({
			title: z.string(),
			published: z.date(),
			updated: z.date().optional(),
			draft: z.boolean().optional().default(false),
			pinned: z.boolean().optional().default(false),
			description: z.string().optional().default(""),
			image: z.string().optional().default(""),
			tags: z.array(z.string()).optional().default([]),
			category: z.string().optional().nullable().default(""),
			episode: z.number().optional(),
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
		})
		.superRefine((data, ctx) => {
			// Keep the ordered/unordered invariant honest at build time:
			// ordered series require an episode; unordered groups forbid one.
			const ordered = isOrderedCategory(data.category);
			const hasEpisode = typeof data.episode === "number";
			if (ordered && !hasEpisode) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["episode"],
					message: `Category "${data.category}" is an ordered series; "episode" is required.`,
				});
			}
			if (!ordered && hasEpisode) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["episode"],
					message: `Category "${data.category || "(uncategorized)"}" is not an ordered series; remove "episode" or register the category in src/constants/categories.ts.`,
				});
			}
		}),
});
const specCollection = defineCollection({
	schema: z.object({}),
});
export const collections = {
	posts: postsCollection,
	spec: specCollection,
};
