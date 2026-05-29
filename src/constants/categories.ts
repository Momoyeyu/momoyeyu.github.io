// Single source of truth for "ordered" collections (有序合集).
//
// Categories come in two flavors:
//   - Ordered series  (有序): posts MUST have an `episode`; archive sorts by EP.
//   - Unordered groups (无序): plain topical buckets; posts MUST NOT have an
//     `episode`; archive sorts by date.
//
// Unordered is the default — only ordered series need to be registered here.
// To turn a category into an ordered series, add its exact name below.
//
// This list drives:
//   - build-time validation in src/content/config.ts (missing/stray episode → error)
//   - series metadata in src/utils/content-utils.ts (EP numbering, prev/next)
//   - the EP sort toggle in src/components/ArchivePanel.svelte
export const ORDERED_CATEGORIES = new Set<string>([
	"AI Infra",
	"C++ 入门",
	"C++ 进阶",
	"Python 入门",
]);

export const isOrderedCategory = (category?: string | null): boolean =>
	!!category && ORDERED_CATEGORIES.has(category.trim());
