<script lang="ts">
    import { onMount } from "svelte";
    import I18nKey from "../i18n/i18nKey";
    import { i18n } from "../i18n/translation";
    export let photos: { src: string; title: string; width: number; height: number }[];
    let gallery: HTMLDivElement;
    onMount(() => {
        let disposed = false;
        let lightbox: { destroy(): void } | undefined;
        void import("photoswipe/lightbox").then(({ default: PhotoSwipeLightbox }) => {
            if (disposed) return;
            const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
            const instance = new PhotoSwipeLightbox({
                gallery, children: "a[data-pswp-width]", pswpModule: () => import("photoswipe"),
                showHideAnimationType: reduced ? "none" : "zoom",
            });
            instance.init();
            lightbox = instance;
        });
        return () => { disposed = true; lightbox?.destroy(); };
    });
</script>

<div bind:this={gallery} class="photo-gallery">
    {#each photos as photo (photo.src)}
        <figure>
            <a href={photo.src} data-pswp-width={photo.width} data-pswp-height={photo.height} aria-label={photo.title} data-no-swup>
                <img src={photo.src} alt={photo.title} width={photo.width} height={photo.height} loading="lazy" decoding="async" />
            </a>
            <figcaption>
                <span>{photo.title}</span>
                <a href={photo.src} download aria-label={i18n(I18nKey.downloadPhoto)} title={i18n(I18nKey.downloadPhoto)} data-no-swup>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
                </a>
            </figcaption>
        </figure>
    {/each}
</div>

<style>
.photo-gallery { columns: 3; column-gap: 1.5rem; }
figure { break-inside: avoid; margin-bottom: 1.75rem; }
figure > a { display: block; overflow: hidden; }
img { display: block; width: 100%; height: auto; transition: filter 200ms; }
figure > a:hover img { filter: brightness(1.04); }
figcaption { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding-top: .5rem; color: var(--text-secondary); font-size: .75rem; }
figcaption a { padding: .5rem; flex-shrink: 0; border-radius: 50%; }
figcaption a:hover { color: var(--primary); background: var(--btn-plain-bg-hover); }
@media(max-width: 900px) { .photo-gallery { columns: 2; } }
@media(max-width: 540px) { .photo-gallery { columns: 1; } }
@media(prefers-reduced-motion: reduce) { img { transition: none; } }
</style>
