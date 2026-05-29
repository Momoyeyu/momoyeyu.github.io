<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@iconify/svelte";
import {
	getAccentChroma,
	getBannerTitle,
	getColorScheme,
	getDefaultAccentChroma,
	getDefaultBannerTitle,
	getDefaultColorScheme,
	getDefaultHue,
	getDefaultPostLayout,
	getDefaultSurfaceChroma,
	getDefaultWallpaperMode,
	getHue,
	getPostLayout,
	getSurfaceChroma,
	getWallpaperMode,
	setAccentChroma,
	setBannerTitle,
	setColorScheme,
	setHue,
	setPostLayout,
	setSurfaceChroma,
	setWallpaperMode,
	type BANNER_TITLE_MODE,
	type COLOR_SCHEME,
	type POST_LAYOUT,
	type WALLPAPER_MODE,
} from "@utils/setting-utils";

let hue = getHue();
let colorScheme: COLOR_SCHEME = getColorScheme();
let accentChroma = getAccentChroma();
let surfaceChroma = getSurfaceChroma();
let wallpaperMode: WALLPAPER_MODE = getWallpaperMode();
let postLayout: POST_LAYOUT = getPostLayout();
let bannerTitle: BANNER_TITLE_MODE = getBannerTitle();

const defaultHue = getDefaultHue();
const defaultColorScheme = getDefaultColorScheme();
const defaultAccentChroma = getDefaultAccentChroma();
const defaultSurfaceChroma = getDefaultSurfaceChroma();
const defaultWallpaperMode = getDefaultWallpaperMode();
const defaultPostLayout = getDefaultPostLayout();
const defaultBannerTitle = getDefaultBannerTitle();

const huePresets = [
	{ name: "枫叶红", hue: 24, accent: 0.16, surface: 0.026 },
	{ name: "朱砂", hue: 18, accent: 0.17, surface: 0.024 },
	{ name: "琥珀", hue: 56, accent: 0.15, surface: 0.022 },
	{ name: "松石", hue: 178, accent: 0.12, surface: 0.02 },
	{ name: "靛蓝", hue: 254, accent: 0.13, surface: 0.02 },
];

const schemeOptions: {
	label: string;
	value: COLOR_SCHEME;
	description: string;
}[] = [
	{
		label: "玻璃",
		value: "glass",
		description: "更接近 DLog，卡片会受主题色染色",
	},
	{ label: "染色", value: "tinted", description: "强化页面和卡片的色彩统一" },
	{
		label: "克制",
		value: "minimal",
		description: "降低卡片染色，只保留重点色",
	},
];

const wallpaperOptions: { label: string; value: WALLPAPER_MODE }[] = [
	{ label: "横幅", value: "banner" },
	{ label: "全屏", value: "overlay" },
	{ label: "纯色", value: "none" },
];

const postLayoutOptions: { label: string; value: POST_LAYOUT }[] = [
	{ label: "网格", value: "grid" },
	{ label: "列表", value: "list" },
];

const bannerTitleOptions: { label: string; value: BANNER_TITLE_MODE }[] = [
	{ label: "显示", value: "show" },
	{ label: "隐藏", value: "hide" },
];

function resetStyle() {
	hue = defaultHue;
	colorScheme = defaultColorScheme;
	accentChroma = defaultAccentChroma;
	surfaceChroma = defaultSurfaceChroma;
	wallpaperMode = defaultWallpaperMode;
	postLayout = defaultPostLayout;
	bannerTitle = defaultBannerTitle;
}

function usePreset(preset: (typeof huePresets)[number]) {
	hue = preset.hue;
	accentChroma = preset.accent;
	surfaceChroma = preset.surface;
}

$: isDefault =
	hue === defaultHue &&
	colorScheme === defaultColorScheme &&
	Number(accentChroma) === Number(defaultAccentChroma) &&
	Number(surfaceChroma) === Number(defaultSurfaceChroma) &&
	wallpaperMode === defaultWallpaperMode &&
	postLayout === defaultPostLayout &&
	bannerTitle === defaultBannerTitle;

$: if (hue || hue === 0) {
	setHue(Number(hue));
}

$: setColorScheme(colorScheme);
$: setAccentChroma(Number(accentChroma));
$: setSurfaceChroma(Number(surfaceChroma));
$: setWallpaperMode(wallpaperMode);
$: setPostLayout(postLayout);
$: setBannerTitle(bannerTitle);
</script>

<div id="display-setting" class="float-panel float-panel-closed absolute transition-all w-[22rem] right-4 px-4 py-4">
    <div class="flex flex-row gap-2 mb-4 items-center justify-between">
        <div class="flex gap-2 font-bold text-lg text-neutral-900 dark:text-neutral-100 transition relative ml-3
            before:w-1 before:h-4 before:rounded-md before:bg-[var(--primary)]
            before:absolute before:-left-3 before:top-[0.33rem]"
        >
            外观设置
            <button aria-label="Reset to Default" class="btn-regular w-7 h-7 rounded-md active:scale-90 will-change-transform"
                    class:opacity-0={isDefault} class:pointer-events-none={isDefault} on:click={resetStyle}>
                <div class="text-[var(--btn-content)]">
                    <Icon icon="fa6-solid:arrow-rotate-left" class="text-[0.875rem]"></Icon>
                </div>
            </button>
        </div>
        <div id="hueValue" class="transition bg-[var(--btn-regular-bg)] px-2 min-w-12 h-7 rounded-md flex justify-center
            font-bold text-sm items-center text-[var(--btn-content)]">
            {hue}
        </div>
    </div>

    <section class="space-y-2 mb-4">
        <div class="setting-label">推荐配色</div>
        <div class="grid grid-cols-5 gap-2">
            {#each huePresets as preset}
                <button type="button" class="preset-swatch" aria-label={preset.name} title={preset.name}
                        class:preset-active={hue === preset.hue && Number(accentChroma) === preset.accent}
                        style={`--swatch-hue: ${preset.hue}; --swatch-chroma: ${preset.accent}`}
                        on:click={() => usePreset(preset)}>
                    <span></span>
                </button>
            {/each}
        </div>
    </section>

    <section class="space-y-2 mb-4">
        <div class="flex items-center justify-between">
            <div class="setting-label">{i18n(I18nKey.themeColor)}</div>
            <span class="setting-value">Hue</span>
        </div>
        <div class="w-full h-6 px-1 bg-[oklch(0.80_0.10_0)] dark:bg-[oklch(0.70_0.10_0)] rounded select-none">
            <input aria-label={i18n(I18nKey.themeColor)} type="range" min="0" max="360" bind:value={hue}
                   class="slider" id="colorSlider" step="1" style="width: 100%">
        </div>
    </section>

    <section class="grid grid-cols-2 gap-3 mb-4">
        <label class="space-y-2">
            <div class="setting-label">强调强度</div>
            <input aria-label="Accent intensity" type="range" min="0.08" max="0.22" bind:value={accentChroma}
                   step="0.005" class="compact-slider">
        </label>
        <label class="space-y-2">
            <div class="setting-label">卡片染色</div>
            <input aria-label="Surface tint" type="range" min="0" max="0.06" bind:value={surfaceChroma}
                   step="0.002" class="compact-slider">
        </label>
    </section>

    <section class="space-y-2 mb-4">
        <div class="setting-label">配色范围</div>
        <div class="grid grid-cols-3 gap-2">
            {#each schemeOptions as option}
                <button type="button" class="segmented-btn" class:segmented-active={colorScheme === option.value}
                        title={option.description} on:click={() => colorScheme = option.value}>
                    {option.label}
                </button>
            {/each}
        </div>
    </section>

    <section class="space-y-2 mb-4">
        <div class="setting-label">背景模式</div>
        <div class="grid grid-cols-3 gap-2">
            {#each wallpaperOptions as option}
                <button type="button" class="segmented-btn" class:segmented-active={wallpaperMode === option.value}
                        on:click={() => wallpaperMode = option.value}>
                    {option.label}
                </button>
            {/each}
        </div>
    </section>

    <section class="grid grid-cols-2 gap-3">
        <div class="space-y-2">
            <div class="setting-label">文章布局</div>
            <div class="grid grid-cols-2 gap-2">
                {#each postLayoutOptions as option}
                    <button type="button" class="segmented-btn" class:segmented-active={postLayout === option.value}
                            on:click={() => postLayout = option.value}>
                        {option.label}
                    </button>
                {/each}
            </div>
        </div>
        <div class="space-y-2">
            <div class="setting-label">横幅标题</div>
            <div class="grid grid-cols-2 gap-2">
                {#each bannerTitleOptions as option}
                    <button type="button" class="segmented-btn" class:segmented-active={bannerTitle === option.value}
                            on:click={() => bannerTitle = option.value}>
                        {option.label}
                    </button>
                {/each}
            </div>
        </div>
    </section>
</div>

<style lang="stylus">
    #display-setting
      .setting-label
        font-size 0.78rem
        font-weight 700
        color var(--btn-content)
        transition color 0.2s ease
      .setting-value
        font-size 0.7rem
        font-weight 700
        color rgba(0, 0, 0, 0.38)
      :global(.dark) & .setting-label
        color var(--primary)
      :global(.dark) & .setting-value
        color rgba(255, 255, 255, 0.42)

      input[type="range"]
        -webkit-appearance none
        height 1.5rem
        border-radius 0.375rem
        background-image var(--color-selection-bar)
        transition background-image 0.15s ease-in-out

        &::-webkit-slider-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          background rgba(255, 255, 255, 0.75)
          box-shadow 0 0 0 1px rgba(0, 0, 0, 0.18)
          &:hover
            background rgba(255, 255, 255, 0.88)
          &:active
            background rgba(255, 255, 255, 0.65)

        &::-moz-range-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          border-width 0
          background rgba(255, 255, 255, 0.75)
          box-shadow 0 0 0 1px rgba(0, 0, 0, 0.18)

      .compact-slider
        height 0.5rem
        background var(--setting-track-bg)
        &::-webkit-slider-thumb
          width 0.9rem
          height 0.9rem
          border-radius 999px
          background var(--primary)
        &::-moz-range-thumb
          width 0.9rem
          height 0.9rem
          border-radius 999px
          background var(--primary)

      .preset-swatch
        height 2rem
        border-radius 0.55rem
        padding 0.2rem
        background var(--btn-regular-bg)
        transition transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease
        &:hover
          transform translateY(-1px)
        &.preset-active
          box-shadow 0 0 0 2px var(--primary)
        span
          display block
          width 100%
          height 100%
          border-radius 0.4rem
          background linear-gradient(135deg, oklch(0.72 var(--swatch-chroma) var(--swatch-hue)), oklch(0.82 0.08 calc(var(--swatch-hue) + 38)))

      .segmented-btn
        height 2rem
        border-radius 0.5rem
        font-size 0.82rem
        font-weight 700
        color var(--btn-content)
        background var(--btn-regular-bg)
        transition background 0.15s ease, color 0.15s ease, transform 0.15s ease
        &:hover
          background var(--btn-regular-bg-hover)
        &:active
          transform scale(0.96)
        &.segmented-active
          color white
          background linear-gradient(135deg, var(--primary), oklch(0.72 var(--accent-chroma) calc(var(--hue) + 26)))
</style>
