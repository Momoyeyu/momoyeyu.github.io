import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "夜羽的小作坊",
	subtitle: "技术学习与分享",
	lang: "zh_CN",
	themeColor: {
		hue: 24,
		fixed: false,
		defaultScheme: "glass",
		defaultAccentChroma: 0.16,
		defaultSurfaceChroma: 0.026,
	},
	wallpaper: {
		defaultMode: "banner",
		switchable: true,
	},
	display: {
		defaultPostLayout: "grid",
		defaultBannerTitle: true,
	},
	banner: {
		enable: true,
		src: '/img/resources/banner.jpg',
		position: "center",
		credit: {
			enable: false,
			text: "",
			url: "",
		},
	},
	toc: {
		enable: true,
		depth: 2,
	},
	favicon: [],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		{
			name: "友链",
			url: "/friends/",
		},
		LinkPreset.About,
		{
			name: "GitHub",
			url: "https://github.com/momoyeyu",
			external: true,
		},
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "assets/images/avatar.jpg",
	name: "墨末夜羽",
	bio: "Code Is Elegant",
	links: [
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/momoyeyu",
		},
		{
			name: "Bilibili",
			icon: "fa6-brands:bilibili",
			url: "https://space.bilibili.com/171878754",
		},
		{
			name: "Email",
			icon: "fa6-solid:envelope",
			url: "mailto:momoyeyu@outlook.com",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: false,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	theme: "github-dark",
};
