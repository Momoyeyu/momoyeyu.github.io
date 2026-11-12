const STORAGE_KEY = "reload-scroll-position:v1";

type ScrollPosition = {
	url: string;
	x: number;
	y: number;
};

function readPosition(browser: Window): ScrollPosition | null {
	try {
		const raw = browser.sessionStorage.getItem(STORAGE_KEY);
		browser.sessionStorage.removeItem(STORAGE_KEY);
		if (!raw) return null;
		const position = JSON.parse(raw) as ScrollPosition | null;
		if (
			!position ||
			position.url !== browser.location.href ||
			!Number.isFinite(position.x) ||
			!Number.isFinite(position.y) ||
			position.x < 0 ||
			position.y < 0
		) return null;
		return position;
	} catch {
		return null;
	}
}

export function initReloadScrollRestoration(browser: Window = window): void {
	browser.addEventListener("pagehide", () => {
		try {
			browser.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
				url: browser.location.href,
				x: browser.scrollX,
				y: browser.scrollY,
			}));
		} catch {}
	});

	const position = readPosition(browser);
	const navigation = browser.performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	if (navigation?.type !== "reload" || !position) return;

	let frame = 0;
	const inputEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
	const cancel = () => {
		browser.cancelAnimationFrame(frame);
		browser.removeEventListener("load", restore);
		for (const event of inputEvents) browser.removeEventListener(event, cancel);
		browser.document.removeEventListener("swup:visit:start", cancel);
	};
	const restore = () => {
		frame = browser.requestAnimationFrame(() => {
			cancel();
			browser.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
		});
	};

	for (const event of inputEvents) {
		browser.addEventListener(event, cancel, { passive: true });
	}
	browser.document.addEventListener("swup:visit:start", cancel);
	if (browser.document.readyState === "complete") restore();
	else browser.addEventListener("load", restore, { once: true });
}
