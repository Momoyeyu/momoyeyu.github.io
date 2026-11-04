<script lang="ts">
    import AlbumEditor from "./AlbumEditor.svelte";
    import Button from "./ui/Button.svelte";
    import Select from "./ui/Select.svelte";
    import Field from "./ui/Field.svelte";
    import { onMount } from "svelte";
    import type { PhotoAlbum, PhotoLibrary } from "../types/photos";
    type Assignment = { album: string; previousAlbum: string; title?: string; note?: string; previousTitle?: string; previousNote?: string };
    type Draft = { assignments: Record<string, Assignment>; albums: PhotoAlbum[] };
    const storageKey = "blog-photo-classification:v1";
    let library: PhotoLibrary | null = null;
    let draft: Draft = { assignments: {}, albums: [] };
    let mode: "pending" | "all" = "all";
    let currentId = "", albumFilter = "", search = "";
    let busy = false, message = "", error = "";
    let newTitle = "", latitude: number | undefined, longitude: number | undefined;
    let creating = false;
    let undoStack: { id: string; previous?: Assignment }[] = [];
    $: albums = [...(library?.albums ?? []), ...draft.albums.filter(album => !library?.albums.some(existing => existing.slug === album.slug))];
    $: photos = (library?.photos ?? []).map(photo => ({ ...photo, ...draft.assignments[photo.id] }));
    $: pending = photos.filter(photo => photo.album === "travel-notes");
    $: queue = (mode === "pending" ? pending : photos).filter(photo => (!albumFilter || photo.album === albumFilter) && `${photo.assetCode} ${photo.title} ${photo.note ?? ""} ${photo.originalFilename ?? ""}`.toLowerCase().includes(search.toLowerCase()));
    $: current = queue.find(photo => photo.id === currentId) ?? queue[0];
    $: albumOptions = albums.map(album => ({value:album.slug,label:album.title}));
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
        assignments[id] = { ...assignments[id], album, previousAlbum: assignments[id]?.previousAlbum ?? original.album };
        draft = { ...draft, assignments };
        message = `已标记：${[...albums, ...draft.albums].find(place => place.slug === album)?.title ?? album}`;
        error = ""; persist();
    }
    function edit(field: "title" | "note", value: string) {
        if (!current || !library || busy) return;
        const original = library.photos.find(photo => photo.id === current.id)!;
        const previous = draft.assignments[current.id];
        undoStack = [...undoStack, { id: current.id, previous }];
        const entry: Assignment = { album: original.album, previousAlbum: original.album, ...previous, [field]: value };
        if (field === "title") entry.previousTitle = previous?.previousTitle ?? original.title;
        else entry.previousNote = previous?.previousNote ?? original.note ?? "";
        draft = { ...draft, assignments: { ...draft.assignments, [current.id]: entry } };
        persist();
    }
    function undo() {
        const last = undoStack.at(-1);
        if (!last || busy) return;
        const assignments = { ...draft.assignments };
        if (last.previous) assignments[last.id] = last.previous;
        else delete assignments[last.id];
        draft = { ...draft, assignments }; undoStack = undoStack.slice(0, -1);
        currentId = last.id; message = "已撤销修改"; persist();
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
            for (const [id, change] of Object.entries(draft.assignments)) {
                const saved = (result as PhotoLibrary).photos?.find(photo => photo.id === id);
                if (!saved || saved.album !== change.album ||
                    (change.title !== undefined && saved.title !== change.title) ||
                    (change.note !== undefined && (saved.note ?? "") !== change.note)) {
                    throw new Error("保存结果与修改不一致，草稿已保留。请重启 dev 服务后重试。");
                }
            }
            library = result; draft = { assignments: {}, albums: [] }; undoStack = [];
            localStorage.removeItem(storageKey); message = "已保存到相册";
        } catch (cause) { error = cause instanceof Error ? cause.message : "保存失败，请重试"; }
        finally { busy = false; }
    }
    let uploadAlbum = "travel-notes", uploadInput: HTMLInputElement;
    async function upload(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const files = Array.from(input.files ?? []); if (!files.length || busy) return;
        const targetAlbum = uploadAlbum;
        busy = true; error = "";
        try {
            for (const [index, file] of files.entries()) {
                message = `上传中 ${index + 1} / ${files.length}`;
                const response = await fetch("/__photo-curation/upload", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg", "x-photo-album": targetAlbum, "x-photo-filename": encodeURIComponent(file.name), "x-photo-title": encodeURIComponent(file.name.replace(/\.[^.]+$/, "")) }, body: file });
                const result = await response.json(); if (!response.ok) throw new Error(result.error || "上传失败");
                library = result;
            }
            message = `已上传 ${files.length} 帧`; mode = targetAlbum === "travel-notes" ? "pending" : "all";
        } catch(cause) { error = cause instanceof Error ? cause.message : "上传失败"; }
        finally { busy = false; input.value = ""; }
    }
    function resetFilters() { mode = "all"; albumFilter = ""; search = ""; }
    onMount(() => {
        let disposed = false;
        void fetch("/__photo-curation").then(async response => {
            if (!response.ok) throw new Error("读取照片失败");
            const result: PhotoLibrary = await response.json(); if (disposed) return;
            library = result;
            try {
                const saved: Draft = JSON.parse(localStorage.getItem(storageKey) || "null");
                if (saved && saved.assignments && Array.isArray(saved.albums)) {
                    const assignments = Object.fromEntries(Object.entries(saved.assignments).filter(([id, value]) => result.photos.some(photo => photo.id === id && (photo.album !== value.album || (value.title !== undefined && photo.title !== value.title) || (value.note !== undefined && (photo.note ?? "") !== value.note)))));
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
  <div><a href="/photos/" data-no-swup>← 返回摄影</a><h1>相册工作台</h1></div>
  <div class="curation-actions"><span class="save-state">{changes ? `${changes} 帧待保存` : '所有修改已保存'}</span><Button on:click={undo} disabled={!undoStack.length || busy}>撤销</Button><Button variant="primary" on:click={save} disabled={!changes || busy}>{busy ? '处理中…' : '保存修改'}</Button></div>
 </header>
 {#if error}<p class="notice" role="alert">{error}</p>{/if}
 <p class="status" aria-live="polite">{message || '选择照片，编辑标题、备注与所属相册。'}</p>
 {#if albumFilter && library?.albums.find(album=>album.slug===albumFilter)}
  {#key albumFilter}<AlbumEditor album={library.albums.find(album=>album.slug===albumFilter)!} disabled={busy} on:saved={event=>{library=event.detail;}}/>{/key}
 {/if}
 <div class="workspace">
  <aside class="library-nav" aria-label="相册导航">
   <h2>素材库 <span>{photos.length}</span></h2>
   <nav><button class:active={mode==='all' && !albumFilter} on:click={resetFilters}>全部照片<span>{photos.length}</span></button><button class:active={mode==='pending'} on:click={()=>{mode='pending';albumFilter='';search='';}}>待归类<span>{pending.length}</span></button></nav>
   <h2 class="section-label">相册</h2>
   <nav>{#each albums.filter(album=>album.slug!=='travel-notes') as album}<button class:active={albumFilter===album.slug} on:click={()=>{mode='all';albumFilter=album.slug;search='';}}>{album.title}<span>{photos.filter(photo=>photo.album===album.slug).length}</span></button>{/each}</nav>
   <div class="import-panel"><h2>导入照片</h2><Select label="上传到相册" bind:value={uploadAlbum} options={(library?.albums ?? []).map(album=>({value:album.slug,label:album.title}))} disabled={busy}/><input class="upload-input" bind:this={uploadInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" multiple on:change={upload} disabled={busy}/><Button on:click={()=>uploadInput.click()} disabled={busy || !library}>＋ 选择照片</Button><p>可多选，每帧最多 30 MB<br/>自动编号并生成 WebP</p></div>
  </aside>
  <main class="contact-sheet">
   <div class="search-row"><Field label="查找素材" bind:value={search} placeholder="编号、标题、备注或原始文件名"/><span>{queue.length} 帧</span></div>
   {#if current}
    <a class="photo-stage" href={current.src} target="_blank" rel="noopener" data-no-swup aria-label={`查看原图：${current.title}`}><img src={current.src} alt={current.title} width={current.width} height={current.height}/></a>
    <div class="photo-caption"><span>{current.title}</span><span>{queue.findIndex(photo=>photo.id===current.id)+1} / {queue.length}</span></div>
    <div class="photo-queue" aria-label="照片列表">{#each queue as photo (photo.id)}<button class:selected={current.id===photo.id} on:click={()=>currentId=photo.id} aria-label={photo.title} aria-pressed={current.id===photo.id}><img src={photo.src} alt="" width="100" height="80" loading="lazy"/><small>{photo.assetCode?.slice(-6)}</small>{#if draft.assignments[photo.id]}<span class="changed" title="未保存">•</span>{/if}</button>{/each}</div>
   {:else}<div class="empty"><h2>{library?'没有匹配的照片':'正在读取照片…'}</h2>{#if library}<Button on:click={resetFilters}>清除筛选</Button>{/if}</div>{/if}
  </main>
  <aside class="inspector" aria-label="照片信息">
   {#if current}
    <header><h2>照片信息</h2><span class="asset-code">{current.assetCode ?? current.id}</span></header>
    <dl><div><dt>尺寸</dt><dd>{current.width} × {current.height}</dd></div><div><dt>原文件</dt><dd>{current.originalFilename ?? current.source}</dd></div></dl>
    <Field label="标题" value={current.title} maxlength={100} disabled={busy} on:input={event=>edit('title',event.detail)}/>
    <div class="album-field"><span>所属相册</span><Select label="所属相册" value={current.album} options={albumOptions} disabled={busy} on:change={event=>stage(event.detail)}/></div>
    <Field label="文字备注" value={current.note ?? ''} multiline disabled={busy} placeholder="记录拍摄地点、故事或素材用途…" on:input={event=>edit('note',event.detail)}/>
    <p class="draft-hint">切换照片会保留修改，点击顶部保存写入相册。</p>
    <Button on:click={()=>creating=!creating} disabled={busy}>{creating?'取消新建':'＋ 新建相册'}</Button>
    {#if creating}<form on:submit={addPlace}><label>相册名称<input bind:value={newTitle} required maxlength="60" placeholder="例如：大阪、丽江"/></label><div class="coordinates"><label>纬度<input type="number" step="any" min="-90" max="90" bind:value={latitude}/></label><label>经度<input type="number" step="any" min="-180" max="180" bind:value={longitude}/></label></div><p>经纬度可选，用于摄影地图定位。</p><Button type="submit" variant="primary">创建并移入</Button></form>{/if}
   {:else}<p>选择一帧照片查看信息。</p>{/if}
  </aside>
 </div>
</section>
<style>
.photo-curator{color:var(--text-primary);padding:0 0 3rem;--workspace-gap:1.5rem}.curation-header{position:sticky;top:4.5rem;z-index:35;background:var(--page-bg);padding:.5rem 0;display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.8rem}.curation-header a{font-size:.8rem;color:var(--text-secondary)}h1{font:1.9rem var(--font-display);margin:.6rem 0}.curation-actions{display:flex;align-items:center;gap:.65rem}.save-state{font-size:.75rem;color:var(--text-secondary);margin-right:.5rem}.status{min-height:1.5rem;font-size:.8rem;color:var(--text-secondary);margin-bottom:1.6rem}.workspace{display:grid;grid-template-columns:180px minmax(0,1fr) 290px;gap:var(--workspace-gap);align-items:start}.library-nav,.inspector{position:sticky;top:12rem;min-width:0}h2{font-size:.9rem;font-weight:600}h2 span{font-size:.75rem;color:var(--text-secondary);font-weight:400;float:right}nav{display:grid;gap:4px;margin-top:.8rem}nav button{display:flex;justify-content:space-between;text-align:left;font-size:.85rem;padding:.7rem .8rem;border-radius:5px;color:var(--text-secondary)}nav button span{font-size:.75rem;opacity:.7}nav button:hover,nav button.active{background:var(--btn-regular-bg);color:var(--text-primary)}.section-label{margin-top:1.8rem}.import-panel{display:grid;gap:.8rem;margin-top:2rem;padding:1rem;background:var(--card-bg)}p{line-height:1.7}.import-panel p,.draft-hint,form p{font-size:.72rem;color:var(--text-secondary)}.upload-input{display:none}.contact-sheet{min-width:0}.search-row{display:flex;align-items:end;gap:1rem;margin-bottom:1rem}.search-row :global(label){flex:1}.search-row>span{font-size:.75rem;white-space:nowrap;color:var(--text-secondary);padding-bottom:.8rem}.photo-stage{height:clamp(280px,48vh,620px);display:grid;place-items:center;background:var(--card-bg);padding:1rem}.photo-stage img{width:100%;height:100%;min-height:0;object-fit:contain}.photo-caption{display:flex;justify-content:space-between;gap:1rem;font-size:.8rem;margin:1rem 0;color:var(--text-secondary)}.photo-queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(85px,1fr));gap:10px;max-height:270px;overflow:auto;padding:4px;overscroll-behavior:contain}.photo-queue button{position:relative;min-width:0;opacity:.7;background:var(--card-bg);text-align:left}.photo-queue button.selected{opacity:1;outline:2px solid var(--primary);outline-offset:2px}.photo-queue button:hover{opacity:1}.photo-queue img{width:100%;height:70px;object-fit:cover}.photo-queue small{display:block;padding:5px 7px;font-size:.65rem;color:var(--text-secondary);font-variant-numeric:tabular-nums}.changed{position:absolute;bottom:0;right:6px;color:var(--primary)}.inspector{display:grid;gap:1.25rem;background:var(--card-bg);padding:1.25rem}.inspector header{display:grid;gap:.6rem}.asset-code{font-size:.8rem;font-variant-numeric:tabular-nums;color:var(--text-secondary)}dl{display:grid;gap:.6rem;font-size:.73rem;color:var(--text-secondary)}dl div{display:grid;grid-template-columns:3rem 1fr;gap:.5rem}dd{overflow-wrap:anywhere}.album-field{display:grid;gap:.55rem;font-size:.8rem;color:var(--text-secondary)}form{display:grid;gap:.8rem}form label{display:grid;gap:.5rem;font-size:.8rem;color:var(--text-secondary)}form input{width:100%;min-width:0;border-radius:6px;padding:.7rem;background:var(--btn-regular-bg);color:var(--text-primary)}.coordinates{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.notice{padding:1rem;background:var(--card-bg);margin-bottom:1rem}.empty{min-height:350px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--primary);outline-offset:3px}@media(min-width:1700px){.workspace{grid-template-columns:210px minmax(0,1fr) 320px;--workspace-gap:2rem}}@media(max-width:1100px){.workspace{grid-template-columns:150px minmax(0,1fr)}.inspector{position:static;grid-column:2}.library-nav{grid-row:span 2}}@media(max-width:650px){.curation-header{align-items:start;flex-direction:column}.curation-actions{width:100%;flex-wrap:wrap}.save-state{flex:1}.workspace{display:flex;flex-direction:column}.library-nav,.contact-sheet,.inspector{position:static;width:100%}.library-nav nav{display:flex;flex-wrap:wrap}.library-nav nav button{gap:.6rem}.import-panel{margin-top:1rem}.section-label{margin-top:1rem}.photo-stage{height:40vh}.inspector{box-sizing:border-box}.photo-queue{max-height:210px}}
</style>
