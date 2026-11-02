<script lang="ts">
    import { onMount } from "svelte";
    import library from "../data/photo-library.json";
    import mapPaths from "../data/travel-map.json";
    type View = "map" | "gallery" | "index";
    let view: View = "map";
    let selected = "yunnan";
    let rail: HTMLDivElement;
    const modes: { id: View; title: string; note: string }[] = [
        { id: "map", title: "旅迹地图", note: "地点选择与相册联动，适合沿着旅行路线浏览。" },
        { id: "gallery", title: "横向展廊", note: "照片占据主角，横向滑动切换目的地。" },
        { id: "index", title: "底片索引", note: "目录与大图并列，选片时同时看到整本相册的气质。" },
    ];
    const coordinates: Record<string, [number, number]> = { yunnan: [100.2,26.8], kansai: [135.5,34.7], toyohashi: [137.4,34.8], tokyo: [139.7,35.7], guangzhou: [113.3,23.1] };
    $: album = library.albums.find(album => album.slug === selected)!;
    $: photos = library.photos.filter(photo => photo.album === selected);
    const count = (slug: string) => library.photos.filter(photo => photo.album === slug).length;
    const pos = (slug: string) => { const [lon,lat] = coordinates[slug]; return { x: (lon-85)/65*100, y: (50-lat)/35*100 }; };
    function chooseView(next: View) { view = next; history.replaceState(null, "", `#${next}`); }
    function slide(direction: number) { rail.scrollBy({ left: direction * rail.clientWidth * .8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
    onMount(() => {
        const syncHash = () => { const hash = location.hash.slice(1); if (modes.some(mode => mode.id === hash)) view = hash as View; };
        syncHash();
        window.addEventListener("hashchange", syncHash);
        return () => window.removeEventListener("hashchange", syncHash);
    });
</script>

<div class="album-prototype">
    <div class="preview-controls">
        <div><p>相册排布预览</p><small>三版沿用现有配色与照片，仅比较布局和交互。</small></div>
        <nav aria-label="相册方案">
            {#each modes as mode}<button class:chosen={view === mode.id} on:click={() => chooseView(mode.id)}>{mode.title}</button>{/each}
        </nav>
    </div>
    <div class="prototype-canvas" data-view={view}>
        {#if view === "map"}
            <div class="map-layout">
                <div class="map-side">
                    <p class="section-caption">行旅相册</p>
                    <h1>走过的地方，<br />留下的片刻。</h1>
                    <div class="travel-map">
                        <svg viewBox="0 0 840 440" aria-label="东亚旅行地点示意图" role="img">
                            {#each mapPaths as path}<path d={path} />{/each}
                            <text x="285" y="180">中国</text><text x="650" y="110">日本</text>
                        </svg>
                        {#each library.albums.filter(album => coordinates[album.slug]) as place}
                            {@const position = pos(place.slug)}
                            <button class="map-pin" class:selected={selected === place.slug} style={`left:${position.x}%;top:${position.y}%`} aria-label={place.title} title={place.title} on:click={() => selected = place.slug}><i></i></button>
                        {/each}
                    </div>
                    <nav class="places" aria-label="地点">
                        {#each library.albums as place}<button class:active={selected === place.slug} on:click={() => selected = place.slug}>{place.title}</button>{/each}
                    </nav>
                </div>
                <div class="map-album">
                    {#key selected}<a class="large-photo reveal" href={`/photos/${album.slug}/`}><img src={album.cover} alt={album.title} /></a>{/key}
                    <div class="album-label"><h2>{album.title}</h2><span>{photos.length} 帧</span></div>
                    <p>{album.subtitle}</p>
                    <div class="mini-strip">{#each photos.slice(0,4) as photo}<img src={photo.src} alt={photo.title} />{/each}</div>
                    <a class="enter-album" href={`/photos/${album.slug}/`}>进入相册 ↗</a>
                </div>
            </div>
        {:else if view === "gallery"}
            <div class="gallery-heading"><div><p class="section-caption">行旅相册</p><h1>沿途，有光。</h1></div><div class="gallery-arrows"><button on:click={() => slide(-1)} aria-label="上一组">←</button><button on:click={() => slide(1)} aria-label="下一组">→</button></div></div>
            <div class="exhibition-rail" bind:this={rail}>
                {#each library.albums as place, index}
                    <a class="exhibition-card" href={`/photos/${place.slug}/`}>
                        <div class="exhibition-image"><img src={place.cover} alt={place.title} draggable="false" /></div>
                        <div class="album-label"><h2>{place.title}</h2><span>{count(place.slug)} 帧</span></div>
                        <p>{place.subtitle}</p>
                        <small>{place.source}</small>
                    </a>
                {/each}
            </div>
            <p class="rail-hint">横向滑动，或使用箭头浏览。</p>
        {:else}
            <div class="index-layout">
                <div class="contact-index">
                    <p class="section-caption">行旅相册</p><h1>沿途的片刻。</h1>
                    <nav aria-label="相册目录">{#each library.albums as place}<button class:active={selected === place.slug} on:click={() => selected = place.slug}><span>{place.title}</span><small>{count(place.slug)} 帧</small></button>{/each}</nav>
                    <p class="index-source">{album.source}</p>
                    <a class="enter-album" href={`/photos/${album.slug}/`}>进入相册 ↗</a>
                </div>
                <div class="contact-images">
                    {#key selected}<a class="contact-main reveal" href={`/photos/${album.slug}/`}><img src={album.cover} alt={album.title} /></a>{/key}
                    <div class="contact-thumbs">{#each photos.slice(0,5) as photo}<img src={photo.src} alt={photo.title} />{/each}</div>
                    <p>{album.subtitle}</p>
                </div>
            </div>
        {/if}
    </div>
    <p class="mode-note">{modes.find(mode => mode.id === view)?.note}</p>
</div>

<style>
.album-prototype { color: var(--text-primary); }
.preview-controls { display: flex; align-items: center; justify-content: space-between; gap: 2rem; margin-bottom: 2rem; }
.preview-controls p { font-size: 1.1rem; margin-bottom: .4rem; }
small,.section-caption,.mode-note,.rail-hint { color: var(--text-secondary); font-size: .75rem; }
.preview-controls nav { display: flex; padding: .25rem; background: var(--btn-regular-bg); border-radius: var(--radius-panel); flex-shrink: 0; }
.preview-controls button { padding: .7rem 1rem; font-size: .85rem; color: var(--text-secondary); border-radius: var(--radius-panel); }
.preview-controls button.chosen { background: var(--card-bg); color: var(--text-primary); }
.prototype-canvas { padding: 2.5rem; background: var(--card-bg); min-height: 700px; }
h1 { font-family: var(--font-display); font-size: clamp(2.1rem,3.5vw,3.4rem); line-height: 1.4; letter-spacing: .01em; margin-block: .75rem 1.5rem; font-weight: 400; }
h2 { font-family: var(--font-display); font-size: 1.7rem; font-weight: 400; }
.map-layout { display: grid; grid-template-columns: 1.25fr 1fr; gap: 3rem; }
.map-side { display: flex; flex-direction: column; justify-content: center; }
.travel-map { position: relative; aspect-ratio: 840/440; width: 100%; margin: 1rem 0; }
.travel-map svg { width: 100%; height: 100%; overflow: hidden; }
.travel-map path { fill: color-mix(in srgb,var(--palette-mist) 18%,var(--card-bg)); stroke: color-mix(in srgb,var(--palette-slate) 27%,transparent); stroke-width: .75; }
.travel-map text { fill: var(--text-secondary); font-size: 14px; opacity: .5; }
.map-pin { position: absolute; transform: translate(-50%,-50%); width: 22px; height: 22px; padding: 6px; border-radius: 50%; display: grid; place-items: center; }
.map-pin i { width: 5px; height: 5px; background: var(--primary); border-radius: 50%; transition: transform 220ms; }
.map-pin.selected { background: color-mix(in srgb,var(--palette-mist) 45%,transparent); }
.map-pin.selected i,.map-pin:hover i { transform: scale(1.5); }
.places { display: flex; gap: .5rem; flex-wrap: wrap; }
.places button { font-size: .8rem; padding: .5rem .75rem; color: var(--text-secondary); border-radius: var(--radius-panel); }
.places button.active { background: var(--btn-regular-bg); color: var(--text-primary); }
.large-photo { display: block; overflow: hidden; aspect-ratio: 4/3; }
.large-photo img,.contact-main img { width: 100%; height: 100%; object-fit: cover; }
.album-label { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-top: 1rem; }
.album-label span { font-size: .75rem; color: var(--text-secondary); }
.map-album > p,.exhibition-card > p,.contact-images > p { color: var(--text-secondary); font-size: .85rem; line-height: 1.8; margin-top: .4rem; }
.mini-strip { display: grid; grid-template-columns: repeat(4,1fr); gap: .5rem; margin-block: 1.5rem; }
.mini-strip img { width: 100%; aspect-ratio: 1; object-fit: cover; }
.enter-album { display: inline-block; font-size: .8rem; color: var(--primary); margin-top: .5rem; padding-block: .5rem; }
.enter-album:hover { text-decoration: underline; text-underline-offset: .3rem; }
.gallery-heading { display: flex; justify-content: space-between; align-items: center; }
.gallery-arrows { display: flex; gap: .5rem; }
.gallery-arrows button { width: 2.5rem; height: 2.5rem; background: var(--btn-regular-bg); border-radius: 50%; }
.exhibition-rail { display: flex; gap: 2rem; overflow-x: auto; scroll-snap-type: x mandatory; padding: .5rem 0 1.5rem; scrollbar-width: thin; }
.exhibition-card { flex: 0 0 36%; min-width: 260px; scroll-snap-align: start; }
.exhibition-image { height: 360px; overflow: hidden; }
.exhibition-image img { width: 100%; height: 100%; object-fit: cover; transition: transform 600ms cubic-bezier(.16,1,.3,1); }
.exhibition-card:hover img { transform: scale(1.035); }
.exhibition-card small { display: block; margin-top: 1rem; line-height: 1.8; }
.rail-hint { margin-top: 1rem; }
.index-layout { display: grid; grid-template-columns: .65fr 1.35fr; gap: 3rem; }
.contact-index h1 { font-size: 2.3rem; max-width: 7em; }
.contact-index nav { display: flex; flex-direction: column; gap: .25rem; margin-block: 2rem; }
.contact-index button { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .8rem; color: var(--text-secondary); font-size: 1.1rem; text-align: left; transition: padding-left 240ms, background-color 240ms; }
.contact-index button.active { color: var(--text-primary); background: var(--btn-regular-bg); padding-left: 1.25rem; }
.index-source { color: var(--text-secondary); font-size: .75rem; line-height: 1.8; }
.contact-main { display: block; aspect-ratio: 4/3; overflow: hidden; }
.contact-thumbs { display: grid; grid-template-columns: repeat(5,1fr); gap: .6rem; margin-top: 1rem; }
.contact-thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; }
.mode-note { margin-block: 1rem 2rem; }
@media(prefers-reduced-motion: no-preference) { .reveal { animation: reveal 420ms both; } @keyframes reveal { from { opacity: .2; clip-path: inset(0 0 6% 0); } to { opacity: 1; clip-path: inset(0); } } }
@media(max-width: 900px) { .map-layout,.index-layout { grid-template-columns: 1fr; } .preview-controls { flex-direction: column; align-items: flex-start; gap: 1rem; } .contact-index nav { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); } .prototype-canvas { padding: 1.5rem; } }
@media(max-width: 540px) { .preview-controls nav { width: 100%; } .preview-controls button { flex: 1; padding: .65rem .4rem; } .prototype-canvas { padding: 1rem; } .exhibition-card { flex-basis: 85%; min-width: 220px; } .exhibition-image { height: 310px; } .map-pin { width: 16px; height: 16px; padding: 4px; } }
@media(prefers-reduced-motion: reduce) { *,*::before,*::after { transition: none !important; animation: none !important; } }
</style>
