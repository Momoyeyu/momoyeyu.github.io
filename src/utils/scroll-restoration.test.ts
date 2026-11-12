import { describe, expect, it, vi } from "vitest";
import { initReloadScrollRestoration } from "./scroll-restoration";

const key = "reload-scroll-position:v1";
const url = "https://example.com/posts/paper-moa/";
const position = { url, x: 0, y: 4200 };

function createBrowser(type = "reload", readyState = "loading") {
	const storage = new Map<string, string>();
	const frames = new Map<number, FrameRequestCallback>();
	let frameId = 0;
	const browser = Object.assign(new EventTarget(), {
		document: Object.assign(new EventTarget(), { readyState }),
		location: { href: url },
		performance: { getEntriesByType: () => [{ type }] },
		sessionStorage: {
			getItem: vi.fn((key: string) => storage.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
			removeItem: vi.fn((key: string) => storage.delete(key)),
		},
		scrollX: 0,
		scrollY: 0,
		scrollTo: vi.fn(),
		requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
			frames.set(++frameId, callback);
			return frameId;
		}),
		cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
	});
	return {
		browser,
		storage,
		init: () => initReloadScrollRestoration(browser as unknown as Window),
		load: () => browser.dispatchEvent(new Event("load")),
		flush: () => {
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(0);
		},
	};
}

describe("reload scroll restoration", () => {
	it("saves the current URL and position at pagehide", () => {
		const { browser, storage, init } = createBrowser();
		init();
		browser.location.href = `${url}?preview=1#budget`;
		browser.scrollX = 12;
		browser.scrollY = 6400;
		browser.dispatchEvent(new Event("pagehide"));
		expect(JSON.parse(storage.get(key)!)).toEqual({
			url: browser.location.href,
			x: 12,
			y: 6400,
		});
	});

	it("waits for page load and a layout frame before restoring", () => {
		const { browser, storage, init, load, flush } = createBrowser();
		storage.set(key, JSON.stringify(position));
		init();
		flush();
		expect(browser.scrollTo).not.toHaveBeenCalled();
		load();
		expect(browser.scrollTo).not.toHaveBeenCalled();
		flush();
		expect(browser.scrollTo).toHaveBeenCalledExactlyOnceWith({
			left: 0,
			top: 4200,
			behavior: "instant",
		});
		expect(storage.has(key)).toBe(false);
	});

	it("restores when initialized after page load", () => {
		const { browser, storage, init, flush } = createBrowser("reload", "complete");
		storage.set(key, JSON.stringify(position));
		init();
		flush();
		expect(browser.scrollTo).toHaveBeenCalledOnce();
	});

	it.each(["navigate", "back_forward"])("leaves %s navigation to its existing scroll handling", (type) => {
		const { browser, storage, init, load, flush } = createBrowser(type);
		storage.set(key, JSON.stringify(position));
		init();
		load();
		flush();
		expect(browser.scrollTo).not.toHaveBeenCalled();
		expect(storage.has(key)).toBe(false);
	});

	it.each([`${url}?preview=1`, `${url}#budget`, "https://example.com/posts/paper-mita/"])(
		"does not restore a different URL: %s",
		(href) => {
			const { browser, storage, init, load, flush } = createBrowser();
			storage.set(key, JSON.stringify(position));
			browser.location.href = href;
			init();
			load();
			flush();
			expect(browser.scrollTo).not.toHaveBeenCalled();
		},
	);

	it("restores the last reading position even when the URL has an older heading hash", () => {
		const { browser, storage, init, load, flush } = createBrowser();
		browser.location.href = `${url}#budget`;
		storage.set(key, JSON.stringify({ ...position, url: browser.location.href }));
		init();
		load();
		flush();
		expect(browser.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 4200 }));
	});

	it.each(["wheel", "touchstart", "pointerdown", "keydown"])(
		"does not move the page after the user interacts with %s",
		(event) => {
			const { browser, storage, init, load, flush } = createBrowser();
			storage.set(key, JSON.stringify(position));
			init();
			load();
			browser.dispatchEvent(new Event(event));
			flush();
			expect(browser.scrollTo).not.toHaveBeenCalled();
		},
	);

	it("cancels pending restoration when Swup starts another visit", () => {
		const { browser, storage, init, load, flush } = createBrowser();
		storage.set(key, JSON.stringify(position));
		init();
		browser.document.dispatchEvent(new Event("swup:visit:start"));
		load();
		flush();
		expect(browser.scrollTo).not.toHaveBeenCalled();
	});

	it.each(["invalid", "null", "{}", JSON.stringify({ ...position, y: -1 }), JSON.stringify({ ...position, x: "0" }), JSON.stringify({ ...position, y: null })])(
		"ignores invalid stored positions: %s",
		(raw) => {
			const { browser, storage, init, load, flush } = createBrowser();
			storage.set(key, raw);
			init();
			load();
			flush();
			expect(browser.scrollTo).not.toHaveBeenCalled();
		},
	);

	it("can save and restore the top of a page", () => {
		const { browser, storage, init, load, flush } = createBrowser();
		storage.set(key, JSON.stringify({ ...position, y: 0 }));
		init();
		load();
		flush();
		expect(browser.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
	});

	it("continues without restoration when session storage is unavailable", () => {
		const { browser, init, load, flush } = createBrowser();
		Object.defineProperty(browser, "sessionStorage", {
			get() { throw new Error("Storage blocked"); },
		});
		expect(() => {
			init();
			load();
			flush();
			browser.dispatchEvent(new Event("pagehide"));
		}).not.toThrow();
		expect(browser.scrollTo).not.toHaveBeenCalled();
	});
});
