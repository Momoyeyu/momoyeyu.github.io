<script lang="ts">
    import { onMount } from "svelte";
    import type { PhotoAlbum, PhotoLibrary } from "../types/photos";
    type Assignment = { album: string; previousAlbum: string };
    type Draft = { assignments: Record<string, Assignment>; albums: PhotoAlbum[] };
    const storageKey = "blog-photo-classification:v1";
    let library: PhotoLibrary | null = null;
    let draft: Draft = { assignments: {}, albums: [] };
    let mode: "pending" | "all" = "pending";
    let currentId = "";
    let busy = false, message = "", error = "";
    let newTitle = "", latitude: number | undefined, longitude: number | undefined;
    let creating = false;
    let undoStack: { id: string; previous?: Assignment }[] = [];
    $: albums = [...(library?.albums ?? []), ...draft.albums.filter(album => !library?.albums.some(existing => existing.slug === album.slug))];
    $: photos = (library?.photos ?? []).map(photo => ({ ...photo, album: draft.assignments[photo.id]?.album ?? photo.album }));
    $: pending = photos.filter(photo => photo.album === "travel-notes");
    $: queue = mode === "pending" ? pending : photos;
    $: current = queue.find(photo => photo.id === currentId) ?? queue[0];
    $: changes = Object.keys(draft.assignments).length;
    function persist() {
        try { localStorage.setItem(storageKey, JSON.stringify(draft)); }
        catch { error = "浏览器未能保存草稿，请及时保存到相册。"; }
    }
    function stage(album: string) {
        if (!current || busy || !library) return;
        const id = current.id;
        const original = library.photos.find(photo => photo.id === id)!;
        undoStack = [...undoStack, { id, previous: draft.assignments[id] }];
        const assignments = { ...draft.assignments };
        if (album === original.album) delete assignments[id];
        else assignments[id] = { album, previousAlbum: original.album };
        const index = queue.findIndex(photo => photo.id === id);
        currentId = queue[(index + 1) % queue.length]?.id ?? "";
        draft = { ...draft, assignments };
        message = `已标记：${albums.find(place => place.slug === album)?.title ?? album}`;
        error = ""; persist();
    }
    function undo() {
        const last = undoStack.at(-1);
        if (!last || busy) return;
        const assignments = { ...draft.assignments };
        if (last.previous) assignments[last.id] = last.previous;
        else delete assignments[last.id];
        draft = { ...draft, assignments }; undoStack = undoStack.slice(0, -1);
        currentId = last.id; message = "已撤销上一张的归类"; persist();
    }
    function addPlace(event: SubmitEvent) {
        event.preventDefault();
        const title = newTitle.trim(); if (!title || !current) return;
        const existing = albums.find(album => album.title === title);
        if (existing) { stage(existing.slug); creating = false; return; }
        const album: PhotoAlbum = { slug: `place-${crypto.randomUUID().slice(0,8)}`, title, subtitle: "", source: title, cover: current.src };
        if (latitude !== undefined && longitude !== undefined) album.location = { latitude, longitude };
        draft = { ...draft, albums: [...draft.albums, album] };
        stage(album.slug); newTitle = ""; latitude = undefined; longitude = undefined; creating = false;
    }
    async function save() {
        if (busy || !changes) return;
        busy = true; error = "";
        try {
            const response = await fetch("/__photo-curation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
                assignments: Object.entries(draft.assignments).map(([photoId, value]) => ({ photoId, ...value })),
                albums: draft.albums.filter(album => Object.values(draft.assignments).some(value => value.album === album.slug)),
            }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "保存失败");
            library = result; draft = { assignments: {}, albums: [] }; undoStack = [];
            localStorage.removeItem(storageKey); message = "已保存到相册";
        } catch (cause) { error = cause instanceof Error ? cause.message : "保存失败，请重试"; }
        finally { busy = false; }
    }
    onMount(() => {
        let disposed = false;
        void fetch("/__photo-curation").then(async response => {
            if (!response.ok) throw new Error("读取照片失败");
            const result: PhotoLibrary = await response.json(); if (disposed) return;
            library = result;
            try {
                const saved: Draft = JSON.parse(localStorage.getItem(storageKey) || "null");
                if (saved && saved.assignments && Array.isArray(saved.albums)) {
                    const assignments = Object.fromEntries(Object.entries(saved.assignments).filter(([id, value]) => result.photos.some(photo => photo.id === id && photo.album !== value.album)));
                    draft = { assignments, albums: saved.albums.filter(album => !result.albums.some(existing => existing.slug === album.slug)) };
                    persist();
                }
            } catch { /* A missing draft starts with the current saved library. */ }
        }).catch(cause => { if (!disposed) error = cause.message; });
        return () => { disposed = true; };
    });
</script>

<section class="photo-curator">
    <header class="curation-header">
        <div><a href="/photos/" data-no-swup>← 摄影</a><h1>照片归类</h1><p>选择地点后自动移到下一张；完成后保存到相册。草稿会保留在浏览器中。</p></div>
        <div class="curation-actions"><button on:click={undo} disabled={!undoStack.length || busy}>撤销上一张</button><button class="save" on:click={save} disabled={!changes || busy}>{busy ? "保存中…" : `保存到相册${changes ? ` · ${changes}` : ""}`}</button></div>
    </header>
    <div class="curation-toolbar"><div><button class:active={mode === "pending"} on:click={() => { mode = "pending"; currentId = ""; }}>待归类 {pending.length}</button><button class:active={mode === "all"} on:click={() => { mode = "all"; currentId = ""; }}>全部照片 {photos.length}</button></div><p aria-live="polite">{message}</p></div>
    {#if error}<p class="curation-error" role="alert">{error}</p>{/if}
    {#if current}
        <div class="curation-body">
            <div class="curation-viewer">
                <a class="photo-stage" href={current.src} target="_blank" rel="noopener" data-no-swup><img src={current.src} alt={current.title} width={current.width} height={current.height} /></a>
                <div class="photo-caption"><span>{current.title}</span><span>{current.source} · {albums.find(album => album.slug === current.album)?.title}</span></div>
                <div class="photo-queue" aria-label="待整理照片">{#each queue as photo}<button class:selected={current.id === photo.id} on:click={() => currentId = photo.id} title={photo.title} aria-label={photo.title}><img src={photo.src} alt="" width="80" height="80" loading="lazy" />{#if draft.assignments[photo.id]}<span>✓</span>{/if}</button>{/each}</div>
            </div>
            <aside class="place-choices card-base">
                <h2>这张照片在哪里？</h2>
                <div class="place-buttons">{#each albums.filter(album => album.slug !== "travel-notes") as album}<button class:active={current.album === album.slug} on:click={() => stage(album.slug)} disabled={busy}>{album.title}</button>{/each}</div>
                <button class="new-place" on:click={() => creating = !creating} disabled={busy}>{creating ? "收起" : "＋ 新建地点"}</button>
                {#if creating}<form on:submit={addPlace}>
                    <label>地点名称<input bind:value={newTitle} required maxlength="60" placeholder="例如：大阪、丽江" /></label>
                    <details><summary>地图位置，可选</summary><div class="coordinates"><label>纬度<input type="number" step="any" min="-90" max="90" bind:value={latitude} /></label><label>经度<input type="number" step="any" min="-180" max="180" bind:value={longitude} /></label></div></details>
                    <button type="submit" class="save">创建并归入此地点</button>
                </form>{/if}
            </aside>
        </div>
    {:else if library}<div class="curation-done"><h2>待归类照片已整理完</h2><p>{changes ? "点击上方“保存到相册”应用这些归类。" : "可以切换到全部照片，继续调整其他照片的地点。"}</p><button on:click={() => mode = "all"}>查看全部照片</button></div>
    {:else if !error}<p>正在读取照片…</p>{/if}
</section>

<style>
.photo-curator { color: var(--text-primary); padding-bottom: 3rem; }
.curation-header { display: flex; align-items: center; justify-content: space-between; gap: 2rem; margin-block: 1rem 2rem; }
h1 { font-family: var(--font-display); font-size: 2rem; margin-block: .5rem; }
h2 { font-family: var(--font-display); font-size: 1.2rem; margin-bottom: 1.25rem; }
p,.curation-header a,.photo-caption { font-size: .8rem; color: var(--text-secondary); line-height: 1.8; }
.curation-actions,.curation-toolbar,.curation-toolbar > div { display: flex; align-items: center; gap: .75rem; }
button { border-radius: var(--radius-panel); padding: .65rem .9rem; font-size: .8rem; color: var(--text-secondary); background: var(--btn-regular-bg); }
button:hover { background: var(--btn-regular-bg-hover); }
button.save { color: var(--page-bg); background: var(--primary); }
button:disabled { opacity: .4; cursor: default; }
.curation-toolbar { justify-content: space-between; margin-bottom: 1.5rem; }
.curation-toolbar button.active { color: var(--text-primary); background: var(--btn-regular-bg-hover); }
.curation-body { display: grid; grid-template-columns: minmax(0,1fr) 18rem; gap: 2rem; align-items: start; }
.photo-stage { display: grid; place-items: center; height: min(65svh,650px); background: var(--card-bg); }
.photo-stage img { width: 100%; height: 100%; object-fit: contain; min-height: 0; }
.photo-caption { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-block: .8rem 1.25rem; flex-wrap: wrap; }
.photo-queue { display: flex; flex-wrap: wrap; gap: .5rem; }
.photo-queue button { position: relative; padding: 0; width: 72px; height: 72px; border-radius: 0; opacity: .65; }
.photo-queue button.selected { opacity: 1; outline: 2px solid var(--primary); outline-offset: 2px; }
.photo-queue img { width: 100%; height: 100%; object-fit: cover; }
.photo-queue span { position: absolute; bottom: 2px; right: 2px; border-radius: 50%; background: var(--page-bg); padding: .1rem .3rem; }
.place-choices { padding: 1.5rem; position: sticky; top: 6rem; }
.place-buttons { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .5rem; }
.place-buttons button.active { color: var(--text-primary); background: var(--btn-regular-bg-hover); }
.new-place { margin-top: 1rem; width: 100%; }
form { display: grid; gap: 1rem; margin-top: 1rem; }
label { display: grid; gap: .5rem; font-size: .8rem; color: var(--text-secondary); }
input { width: 100%; min-width: 0; padding: .65rem; border-radius: var(--radius-inset); background: var(--page-bg); color: var(--text-primary); }
summary { font-size: .75rem; cursor: pointer; color: var(--text-secondary); }
.coordinates { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-top: .75rem; }
.curation-error { padding: .75rem 1rem; background: var(--btn-regular-bg); margin-block: 1rem; color: var(--text-primary); }
.curation-done { padding: 3rem 2rem; background: var(--card-bg); }
.curation-done button { margin-top: 1.25rem; }
@media(max-width: 900px) { .curation-body { grid-template-columns: 1fr; } .place-choices { position: static; grid-row: 1; } .place-buttons { grid-template-columns: repeat(3,minmax(0,1fr)); } .curation-header { flex-direction: column; align-items: flex-start; gap: 1rem; } .photo-stage { height: 55svh; } }
</style>
