import {
	AUTO_MODE,
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
} from "@constants/constants.ts";
import { expressiveCodeConfig, siteConfig } from "@/config";
import type { LIGHT_DARK_MODE } from "@/types/config";

export type POST_LAYOUT = "grid" | "list";

const browser = typeof document !== "undefined";

export function getDefaultPostLayout(): POST_LAYOUT {
	return siteConfig.display.defaultPostLayout;
}

export function getPostLayout(): POST_LAYOUT {
	try {
		const stored = browser ? localStorage.getItem("postLayout") : null;
		if (stored === "grid" || stored === "list") return stored;
	} catch { /* Storage is optional. */ }
	return getDefaultPostLayout();
}

export function setPostLayout(layout: POST_LAYOUT): void {
	if (!browser) return;
	const changed = document.documentElement.dataset.postLayout !== layout;
	if (changed) document.dispatchEvent(new Event("post-layout:before"));
	document.documentElement.dataset.postLayout = layout;
	if (changed) document.dispatchEvent(new Event("post-layout:after"));
	try { localStorage.setItem("postLayout", layout); } catch { /* Storage is optional. */ }
}

let themeTransitionTimer: ReturnType<typeof setTimeout> | undefined;

export function applyThemeToDocument(theme: LIGHT_DARK_MODE, animate = false) {
	if (!browser) {
		return;
	}

	const root = document.documentElement;
	const dark = theme === DARK_MODE || (theme === AUTO_MODE && window.matchMedia("(prefers-color-scheme: dark)").matches);
	if (animate && dark !== root.classList.contains("dark") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		clearTimeout(themeTransitionTimer);
		root.classList.add("theme-switching");
		// Install transitions before changing the palette, without a white overlay.
		getComputedStyle(root).backgroundColor;
		themeTransitionTimer = setTimeout(() => root.classList.remove("theme-switching"), 500);
	}
	root.style.colorScheme = dark ? "dark" : "light";

	switch (theme) {
		case LIGHT_MODE:
			document.documentElement.classList.remove("dark");
			break;
		case DARK_MODE:
			document.documentElement.classList.add("dark");
			break;
		case AUTO_MODE:
			if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
				document.documentElement.classList.add("dark");
			} else {
				document.documentElement.classList.remove("dark");
			}
			break;
	}

	// Set the theme for Expressive Code
	document.documentElement.setAttribute(
		"data-theme",
		expressiveCodeConfig.theme,
	);
}

export function setTheme(theme: LIGHT_DARK_MODE): void {
	if (!browser) {
		return;
	}
	try { localStorage.setItem("theme", theme); } catch { /* Storage is optional. */ }
	applyThemeToDocument(theme, true);
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	try {
		const theme = browser ? localStorage.getItem("theme") : null;
		if (theme === LIGHT_MODE || theme === DARK_MODE || theme === AUTO_MODE) return theme;
	} catch { /* Storage is optional. */ }
	return DEFAULT_THEME;
}
