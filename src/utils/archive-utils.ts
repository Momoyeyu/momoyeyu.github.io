type ArchivePost = {
	data: {
		category?: string | null;
		tags: readonly string[];
	};
};

export function countArchivePosts(posts: readonly ArchivePost[]) {
	const categoryCounts = new Map<string, number>();
	const tagCounts = new Map<string, number>();
	for (const post of posts) {
		const { category, tags } = post.data;
		if (category) {
			categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
		}
		for (const tag of new Set(tags)) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
	}
	return { categoryCounts, tagCounts };
}
