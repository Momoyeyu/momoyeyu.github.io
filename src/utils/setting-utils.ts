import {
	AUTO_MODE,
	DARK_MODE,
	DEFAULT_THEME,
	LIGHT_MODE,
} from "@constants/constants.ts";
import { expressiveCodeConfig } from "@/config";
import type { LIGHT_DARK_MODE } from "@/types/config";

export type COLOR_SCHEME = "minimal" | "tinted" | "glass";
export type WALLPAPER_MODE = "banner" | "overlay" | "none";
export type POST_LAYOUT = "grid" | "list";
export type BANNER_TITLE_MODE = "show" | "hide";

const DEFAULT_COLOR_SCHEME: COLOR_SCHEME = "glass";
const DEFAULT_WALLPAPER_MODE: WALLPAPER_MODE = "banner";
const DEFAULT_POST_LAYOUT: POST_LAYOUT = "grid";
const DEFAULT_BANNER_TITLE: BANNER_TITLE_MODE = "show";
const DEFAULT_ACCENT_CHROMA = 0.16;
const DEFAULT_SURFACE_CHROMA = 0.026;

export function getDefaultHue(): number {
	const fallback = "250";
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseInt(configCarrier?.dataset.hue || fallback, 10);
}

export function getHue(): number {
	const stored = localStorage.getItem("hue");
	return stored ? Number.parseInt(stored, 10) : getDefaultHue();
}

export function setHue(hue: number): void {
	localStorage.setItem("hue", String(hue));
	const r = document.querySelector(":root") as HTMLElement;
	if (!r) {
		return;
	}
	r.style.setProperty("--hue", String(hue));
}

export function getDefaultColorScheme(): COLOR_SCHEME {
	const configCarrier = document.getElementById("config-carrier");
	return (
		(configCarrier?.dataset.colorScheme as COLOR_SCHEME | undefined) ||
		DEFAULT_COLOR_SCHEME
	);
}

export function getColorScheme(): COLOR_SCHEME {
	return (
		(localStorage.getItem("colorScheme") as COLOR_SCHEME | null) ||
		getDefaultColorScheme()
	);
}

export function setColorScheme(scheme: COLOR_SCHEME): void {
	localStorage.setItem("colorScheme", scheme);
	document.documentElement.dataset.colorScheme = scheme;
}

export function getDefaultAccentChroma(): number {
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseFloat(
		configCarrier?.dataset.accentChroma || String(DEFAULT_ACCENT_CHROMA),
	);
}

export function getAccentChroma(): number {
	const stored = localStorage.getItem("accentChroma");
	return stored ? Number.parseFloat(stored) : getDefaultAccentChroma();
}

export function setAccentChroma(chroma: number): void {
	localStorage.setItem("accentChroma", String(chroma));
	document.documentElement.style.setProperty("--accent-chroma", String(chroma));
}

export function getDefaultSurfaceChroma(): number {
	const configCarrier = document.getElementById("config-carrier");
	return Number.parseFloat(
		configCarrier?.dataset.surfaceChroma || String(DEFAULT_SURFACE_CHROMA),
	);
}

export function getSurfaceChroma(): number {
	const stored = localStorage.getItem("surfaceChroma");
	return stored ? Number.parseFloat(stored) : getDefaultSurfaceChroma();
}

export function setSurfaceChroma(chroma: number): void {
	localStorage.setItem("surfaceChroma", String(chroma));
	document.documentElement.style.setProperty(
		"--surface-chroma",
		String(chroma),
	);
}

export function getDefaultWallpaperMode(): WALLPAPER_MODE {
	const configCarrier = document.getElementById("config-carrier");
	return (
		(configCarrier?.dataset.wallpaperMode as WALLPAPER_MODE | undefined) ||
		DEFAULT_WALLPAPER_MODE
	);
}

export function getWallpaperMode(): WALLPAPER_MODE {
	return (
		(localStorage.getItem("wallpaperMode") as WALLPAPER_MODE | null) ||
		getDefaultWallpaperMode()
	);
}

export function setWallpaperMode(mode: WALLPAPER_MODE): void {
	localStorage.setItem("wallpaperMode", mode);
	document.documentElement.dataset.wallpaperMode = mode;
}

export function getDefaultPostLayout(): POST_LAYOUT {
	const configCarrier = document.getElementById("config-carrier");
	return (
		(configCarrier?.dataset.postLayout as POST_LAYOUT | undefined) ||
		DEFAULT_POST_LAYOUT
	);
}

export function getPostLayout(): POST_LAYOUT {
	return (
		(localStorage.getItem("postLayout") as POST_LAYOUT | null) ||
		getDefaultPostLayout()
	);
}

export function setPostLayout(layout: POST_LAYOUT): void {
	localStorage.setItem("postLayout", layout);
	document.documentElement.dataset.postLayout = layout;
}

export function getDefaultBannerTitle(): BANNER_TITLE_MODE {
	const configCarrier = document.getElementById("config-carrier");
	return (
		(configCarrier?.dataset.bannerTitle as BANNER_TITLE_MODE | undefined) ||
		DEFAULT_BANNER_TITLE
	);
}

export function getBannerTitle(): BANNER_TITLE_MODE {
	return (
		(localStorage.getItem("bannerTitle") as BANNER_TITLE_MODE | null) ||
		getDefaultBannerTitle()
	);
}

export function setBannerTitle(mode: BANNER_TITLE_MODE): void {
	localStorage.setItem("bannerTitle", mode);
	document.documentElement.dataset.bannerTitle = mode;
}

export function applyThemeToDocument(theme: LIGHT_DARK_MODE) {
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
	localStorage.setItem("theme", theme);
	applyThemeToDocument(theme);
}

export function getStoredTheme(): LIGHT_DARK_MODE {
	return (localStorage.getItem("theme") as LIGHT_DARK_MODE) || DEFAULT_THEME;
}
