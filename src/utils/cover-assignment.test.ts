import { describe, expect, it } from "vitest";
import { allocateCovers } from "./cover-assignment";

describe("balanced cover assignment", () => {
    const covers = Array.from({ length: 56 }, (_, i) => `photo-${i}`);
    it("uses every cover before repeating and keeps total usage within one", () => {
        const ids = Array.from({ length: 1000 }, (_, i) => `post-${i}`);
        const assigned = allocateCovers(ids, covers);
        expect(new Set(ids.slice(0, 56).map(id => assigned.get(id))).size).toBe(56);
        const counts = covers.map(cover => [...assigned.values()].filter(value => value === cover).length);
        expect(Math.max(...counts) - Math.min(...counts)).toBe(1);
    });
    it("reproduces assignments independently of filesystem order", () => {
        const ids = ["a", "b", "c", "d"];
        expect(allocateCovers(ids, covers)).toEqual(allocateCovers(ids, [...covers].reverse()));
        expect(allocateCovers(ids, [])).toEqual(new Map());
    });
});
