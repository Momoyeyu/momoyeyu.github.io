import { describe, expect, it } from "vitest";
import { ORDERED_CATEGORIES, isOrderedCategory } from "@constants/categories";

describe("isOrderedCategory", () => {
	it("recognizes registered ordered categories", () => {
		expect(isOrderedCategory("AI Infra")).toBe(true);
		expect(ORDERED_CATEGORIES.has("AI Infra")).toBe(true);
	});

	it("treats unknown / empty / nullish categories as unordered", () => {
		expect(isOrderedCategory("随笔")).toBe(false);
		expect(isOrderedCategory("")).toBe(false);
		expect(isOrderedCategory(null)).toBe(false);
		expect(isOrderedCategory(undefined)).toBe(false);
	});

	it("trims surrounding whitespace before matching", () => {
		expect(isOrderedCategory("  AI Infra  ")).toBe(true);
	});
});
