import { describe, expect, it } from "vitest";
import {
	followOpeningProgress,
	openingSceneProgress,
} from "./opening-motion";

describe("opening scroll timing", () => {
	it.each([-1, 0, 0.05, 0.10])(
		"holds the complete feather before the ink wash at scroll %s",
		(raw) => expect(openingSceneProgress(raw)).toBe(0),
	);

	it.each([0.90, 0.96, 1, 2])(
		"finishes the dissolve without a second scene at scroll %s",
		(raw) => expect(openingSceneProgress(raw)).toBe(1),
	);

	it("reverses through the same scene rather than replaying an entrance", () => {
		const scroll = [0.10, 0.30, 0.50, 0.70, 0.90];
		const expected = [0, 0.25, 0.5, 0.75, 1];
		for (const index of [0, 1, 2, 3, 4, 3, 2, 1, 0]) {
			expect(openingSceneProgress(scroll[index])).toBeCloseTo(expected[index], 12);
		}
	});

	it("follows a gesture in either direction without overshooting", () => {
		let current = 0.2;
		for (let frame = 0; frame < 20; frame++) {
			const next = followOpeningProgress(current, 0.8, 1 / 60);
			expect(next).toBeGreaterThan(current);
			expect(next).toBeLessThanOrEqual(0.8);
			current = next;
		}
		for (let frame = 0; frame < 20; frame++) {
			const next = followOpeningProgress(current, 0.2, 1 / 60);
			expect(next).toBeLessThan(current);
			expect(next).toBeGreaterThanOrEqual(0.2);
			current = next;
		}
	});

	it("keeps its damping consistent on 60 and 120 Hz screens", () => {
		const advance = (rate: number) => {
			let current = 0.2;
			for (let frame = 0; frame < rate / 2; frame++) {
				current = followOpeningProgress(current, 0.8, 1 / rate);
			}
			return current;
		};
		expect(advance(60)).toBeCloseTo(advance(120), 12);
		expect(advance(60)).toBeGreaterThan(0.77);
		expect(advance(60)).toBeLessThan(0.8);
	});

	it("does not advance when a frame has no elapsed time", () => {
		expect(followOpeningProgress(0.3, 0.8, 0)).toBe(0.3);
		expect(followOpeningProgress(0.3, 0.8, -1)).toBe(0.3);
	});
});

