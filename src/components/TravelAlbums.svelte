<script lang="ts">
    import { onMount } from "svelte";
    import type { PhotoLibrary } from "../types/photos";
    import mapPaths from "../data/travel-map.json";
    import I18nKey from "../i18n/i18nKey";
    import { i18n } from "../i18n/translation";
    import { url } from "../utils/url-utils";
    export let library: PhotoLibrary;
    const albums = library.albums.filter(album => library.photos.some(photo => photo.album === album.slug));
    const albumPhotos = (slug: string) => library.photos.filter(photo => photo.album === slug);
    let current = 0;
    let carousel: HTMLDivElement;
    let requested: number | null = null;
    let frame = 0;
    const position = (location: { longitude: number; latitude: number }) => ({ x: (location.longitude - 85) / 65 * 100, y: (50 - location.latitude) / 35 * 100 });
    function select(index: number) {
        current = Math.max(0, Math.min(albums.length - 1, index));
        requested = current;
        carousel?.scrollTo({ left: current * carousel.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    function keyboard(event: KeyboardEvent) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        select(event.key === "Home" ? 0 : event.key === "End" ? albums.length - 1 : current + (event.key === "ArrowRight" ? 1 : -1));
    }
    onMount(() => {
        const scroll = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const progress = carousel.scrollLeft / Math.max(1, carousel.clientWidth);
                if (requested !== null && Math.abs(progress - requested) < .02) requested = null;
                if (requested === null) current = Math.max(0, Math.min(albums.length - 1, Math.round(progress)));
            });
        };
        const interrupt = () => { requested = null; };
        let width = carousel.clientWidth;
        const observer = new ResizeObserver(() => {
            if (carousel.clientWidth === width) return;
            width = carousel.clientWidth;
            carousel.scrollTo({ left: current * width, behavior: "instant" });
        });
        observer.observe(carousel);
        carousel.addEventListener("scroll", scroll, { passive: true });
        carousel.addEventListener("pointerdown", interrupt);
        carousel.addEventListener("wheel", interrupt, { passive: true });
        return () => {
            cancelAnimationFrame(frame); observer.disconnect();
            carousel.removeEventListener("scroll", scroll);
            carousel.removeEventListener("pointerdown", interrupt);
            carousel.removeEventListener("wheel", interrupt);
        };
    });
</script>

<section class="travel-albums" aria-label={i18n(I18nKey.photography)}>
    <div class="map-side">
        <p class="map-caption">{i18n(I18nKey.photoAlbums)}</p>
        <h1>{i18n(I18nKey.photoMotto)}</h1>
        <div class="travel-map">
            <svg viewBox="0 0 840 440" role="img" aria-label={i18n(I18nKey.photography)}>
                {#each mapPaths as path}<path d={path} />{/each}
            </svg>
            {#each albums as album, index}
                {#if album.location}
                    {@const point = position(album.location)}
                    <button class="map-pin" class:selected={current === index} style={`left:${point.x}%;top:${point.y}%`} aria-label={album.title} aria-pressed={current === index} title={album.title} on:click={() => select(index)}><i></i></button>
                {/if}
            {/each}
        </div>
        <nav class="places" aria-label={i18n(I18nKey.photoAlbums)}>
            {#each albums as album, index}<button class:active={current === index} aria-pressed={current === index} on:click={() => select(index)}>{album.title}</button>{/each}
        </nav>
    </div>
    <div class="exhibition">
        <div class="album-rail" bind:this={carousel} tabindex="0" role="region" aria-label={i18n(I18nKey.photoAlbums)} on:keydown={keyboard}>
            {#each albums as album, index}
                {@const photos = albumPhotos(album.slug)}
                <article class="album-slide" inert={index !== current} aria-hidden={index !== current}>
                    <a class="large-photo" href={url(`/photos/${album.slug}/`)} aria-label={`${i18n(I18nKey.enterAlbum)} · ${album.title}`}>
                        <img src={album.cover} alt={album.title} width="800" height="600" loading={index === 0 ? "eager" : "lazy"} draggable="false" />
                    </a>
                    <div class="album-label"><h2>{album.title}</h2><span>{photos.length} {i18n(I18nKey.photoCount)}</span></div>
                    {#if album.subtitle}<p class="album-description">{album.subtitle}</p>{/if}
                    <div class="mini-strip">{#each photos.slice(0,4) as photo}<img src={photo.src} alt={photo.title} width={photo.width} height={photo.height} loading="lazy" draggable="false" />{/each}</div>
                    <a class="enter-album" href={url(`/photos/${album.slug}/`)}>{i18n(I18nKey.enterAlbum)} <span aria-hidden="true">↗</span></a>
                </article>
            {/each}
        </div>
        <div class="exhibition-controls">
            <span aria-live="polite">{albums[current]?.title} <span class="slide-count">{current + 1} / {albums.length}</span></span>
            <div><button disabled={current === 0} on:click={() => select(current - 1)} aria-label={i18n(I18nKey.previousAlbum)}>←</button><button disabled={current === albums.length - 1} on:click={() => select(current + 1)} aria-label={i18n(I18nKey.nextAlbum)}>→</button></div>
        </div>
    </div>
</section>

<style>
.travel-albums { display: grid; grid-template-columns: 1.15fr 1fr; gap: clamp(2rem,4vw,4rem); align-items: center; margin-block: 2rem 4rem; color: var(--text-primary); }
.map-caption { color: var(--text-secondary); font-size: .8rem; }
h1 { font-family: var(--font-display); font-weight: 400; font-size: clamp(2.2rem,3.6vw,3.6rem); line-height: 1.45; max-width: 9em; text-wrap: balance; margin-block: 1rem 2rem; }
.travel-map { position: relative; aspect-ratio: 840/440; margin-block: 1rem 1.5rem; }
.travel-map svg { width: 100%; height: 100%; overflow: hidden; }
.travel-map path { fill: color-mix(in srgb,var(--palette-mist) 15%,var(--page-bg)); stroke: color-mix(in srgb,var(--primary) 28%,transparent); stroke-width: .9; }
.map-pin { position: absolute; transform: translate(-50%,-50%); width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; }
.map-pin i { width: 5px; height: 5px; background: var(--primary); border-radius: 50%; transition: transform 200ms; }
.map-pin.selected { background: color-mix(in srgb,var(--primary) 20%,transparent); }
.map-pin.selected i,.map-pin:hover i { transform: scale(1.5); }
.places { display: flex; gap: .4rem; flex-wrap: wrap; }
.places button { padding: .55rem .75rem; border-radius: var(--radius-panel); font-size: .8rem; color: var(--text-secondary); transition: background-color 200ms,color 200ms; }
.places button.active { background: var(--btn-regular-bg); color: var(--text-primary); }
.exhibition { min-width: 0; }
.album-rail { display: flex; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; }
.album-rail::-webkit-scrollbar { display: none; }
.album-slide { flex: 0 0 100%; min-width: 0; scroll-snap-align: start; scroll-snap-stop: always; padding: 0 1px; }
.large-photo { display: block; aspect-ratio: 4/3; overflow: hidden; }
.large-photo img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 600ms cubic-bezier(.16,1,.3,1); }
.large-photo:hover img { transform: scale(1.025); }
.album-label { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-top: 1.2rem; }
h2 { font-family: var(--font-display); font-weight: 400; font-size: 1.8rem; }
.album-label > span,.album-description { font-size: .8rem; color: var(--text-secondary); line-height: 1.8; }
.album-description { margin-top: .3rem; min-height: 1.8em; }
.mini-strip { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: .5rem; margin-block: 1.25rem; }
.mini-strip img { width: 100%; aspect-ratio: 1; height: auto; object-fit: cover; }
.enter-album { display: inline-flex; align-items: center; gap: .6rem; padding-block: .5rem; font-size: .8rem; color: var(--primary); }
.enter-album:hover { text-decoration: underline; text-underline-offset: .25rem; }
.exhibition-controls { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-top: 1rem; font-size: .75rem; color: var(--text-secondary); }
.exhibition-controls > div { display: flex; gap: .5rem; }
.exhibition-controls button { width: 2.5rem; height: 2.5rem; border-radius: 50%; background: var(--btn-regular-bg); color: var(--primary); font-size: 1rem; }
.exhibition-controls button:disabled { opacity: .35; cursor: default; }
.slide-count { margin-left: .75rem; opacity: .7; }
@media(max-width: 900px) { .travel-albums { grid-template-columns: 1fr; gap: 2rem; } .map-side { max-width: 42rem; } h1 { font-size: 2.4rem; max-width: 12em; } .travel-map { max-width: 38rem; } }
@media(max-width: 540px) { h1 { font-size: 2rem; } .travel-map { margin-block: .5rem 1rem; } .places button { padding: .5rem .65rem; } }
@media(prefers-reduced-motion: reduce) { .large-photo img,.places button,.map-pin i { transition: none; } }
</style>
