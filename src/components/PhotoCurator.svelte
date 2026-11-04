<script lang="ts">
    import Dialog from "./ui/Dialog.svelte";
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
    let panel: "photo" | "album" | "upload" | "create" | "delete" | null = null;
    let albumBusy = false;
    let undoStack: { id: string; previous?: Assignment }[] = [];
    $: albums = [...(library?.albums ?? []), ...draft.albums.filter(album => !library?.albums.some(existing => existing.slug === album.slug))];
    $: photos = (library?.photos ?? []).map(photo => ({ ...photo, ...draft.assignments[photo.id] }));
    $: pending = photos.filter(photo => photo.album === "travel-notes");
    $: queue = (mode === "pending" ? pending : photos).filter(photo => (!albumFilter || photo.album === albumFilter) && `${photo.assetCode} ${photo.title} ${photo.note ?? ""} ${photo.originalFilename ?? ""}`.toLowerCase().includes(search.toLowerCase()));
    $: current = photos.find(photo => photo.id === currentId);
    $: selectedAlbum = albums.find(album => album.slug === albumFilter);
    $: albumOptions = albums.map(album => ({value:album.slug,label:album.title}));
    $: changes = Object.keys(draft.assignments).length + draft.albums.length;
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
    async function addPlace(event: SubmitEvent) {
        event.preventDefault();
        const title = newTitle.trim(); if (!title) return;
        const existing = albums.find(album => album.title === title);
        if (existing) { albumFilter = existing.slug; panel = null; return; }
        const album: PhotoAlbum = { slug: `place-${crypto.randomUUID().slice(0,8)}`, title, subtitle: "", source: title, cover: "" };
        if (latitude !== undefined && longitude !== undefined) album.location = { latitude, longitude };
        busy = true; error = "";
        try {
            const response = await fetch('/__photo-curation', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assignments:[],albums:[album]})});
            const result = await response.json();
            if (!response.ok || !result.albums?.some((item:PhotoAlbum)=>item.slug===album.slug)) throw new Error(result.error || '创建相册失败');
            library = result; albumFilter = album.slug; mode = "all"; search = ""; newTitle = ""; latitude = undefined; longitude = undefined; panel = null; message = '相册已创建';
        } catch(cause) {error = cause instanceof Error ? cause.message : '创建相册失败';}
        finally {busy = false;}
    }
    async function deleteAlbum() {
        if (!selectedAlbum || busy || selectedAlbum.slug === 'travel-notes') return;
        const slug = selectedAlbum.slug;
        busy = true; error = '';
        try {
            const response = await fetch('/__photo-curation', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assignments:[],deleteAlbums:[slug]})});
            const result = await response.json();
            if (!response.ok || result.albums?.some((album:PhotoAlbum)=>album.slug===slug) || result.photos?.some((photo:{album:string})=>photo.album===slug)) throw new Error(result.error || '删除相册失败');
            library = result;
            // Preserve text drafts while rebasing album assignments after deletion.
            draft = {...draft, assignments:Object.fromEntries(Object.entries(draft.assignments).map(([id,change])=>[id,{...change, album:change.album===slug?'travel-notes':change.album,previousAlbum:change.previousAlbum===slug?'travel-notes':change.previousAlbum}]))};
            undoStack = []; persist(); localStorage.removeItem(`album-editor:v1:${slug}`);
            albumFilter = ''; mode = 'pending'; panel = null; message = '相册已删除，照片已移到待归类';
        } catch(cause) {error = cause instanceof Error ? cause.message : '删除相册失败';}
        finally {busy = false;}
    }
    async function save() {
        if (busy || !changes) return;
        busy = true; error = "";
        try {
            const response = await fetch("/__photo-curation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
                assignments: Object.entries(draft.assignments).map(([photoId, value]) => ({ photoId, ...value })),
                albums: draft.albums,
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
            for (const album of draft.albums) {
                if (!(result as PhotoLibrary).albums?.some(saved => saved.slug === album.slug && saved.title === album.title)) throw new Error("新相册未保存，请重试。");
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
            message = `已上传 ${files.length} 帧`; albumFilter = targetAlbum; search = ""; panel = null; mode = targetAlbum === "travel-notes" ? "pending" : "all";
        } catch(cause) { error = cause instanceof Error ? cause.message : "上传失败"; }
        finally { busy = false; input.value = ""; }
    }
    function openPhoto(id:string) {currentId=id;panel="photo";}
    function adjacentPhoto(direction:number) {
        const index=queue.findIndex(photo=>photo.id===currentId);
        const next=queue[index+direction];if(next)currentId=next.id;
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
  <div><a href="/photos/" data-no-swup>返回摄影</a><h1>相册工作台</h1></div>
  <div class="curation-actions">
   {#if changes}<span class="save-state">{changes} 项未保存</span><Button on:click={undo} disabled={!undoStack.length || busy}>撤销</Button><Button variant="primary" on:click={save} disabled={busy}>保存全部修改</Button>{/if}
   <Button on:click={()=>{error="";panel="create";}} disabled={busy}>＋ 新增相册</Button>
   <Button on:click={()=>{uploadAlbum=albumFilter && library?.albums.some(a=>a.slug===albumFilter)?albumFilter:'travel-notes';panel='upload';}} disabled={busy}>导入照片</Button>
  </div>
 </header>
 <div class="workspace">
  <aside class="library-nav" aria-label="相册导航">
   <nav><button class:active={mode==='all' && !albumFilter} on:click={resetFilters}>全部照片<span>{photos.length}</span></button><button class:active={mode==='pending'} on:click={()=>{mode='pending';albumFilter='';search='';}}>待归类<span>{pending.length}</span></button></nav>
   <div class="nav-heading"><h2>相册</h2><button on:click={()=>panel='create'} aria-label="新建相册">＋ 新增</button></div>
   <nav>{#each albums as album}<button class:active={albumFilter===album.slug} on:click={()=>{mode='all';albumFilter=album.slug;search='';}}>{album.title}<span>{photos.filter(photo=>photo.album===album.slug).length}</span></button>{/each}</nav>
  </aside>
  <div class="collection">
   <header class="collection-header"><div><h2>{selectedAlbum?.title ?? (mode==='pending'?'待归类':'全部照片')}<span>{queue.length} 帧</span></h2>{#if selectedAlbum?.subtitle}<p>{selectedAlbum.subtitle}</p>{/if}</div>{#if selectedAlbum && library?.albums.some(a=>a.slug===selectedAlbum.slug)}<div class="album-actions"><Button on:click={()=>panel='album'}>编辑相册</Button>{#if selectedAlbum.slug!=='travel-notes'}<Button on:click={()=>{error='';panel='delete';}}>删除相册</Button>{/if}</div>{/if}</header>
   <div class="search-row"><Field label="查找照片" bind:value={search} placeholder="搜索标题、编号或备注"/></div>
   {#if message}<p class="status" role="status">{message}</p>{/if}
   {#if error}<p class="notice" role="alert">{error}</p>{/if}
   {#if queue.length}<div class="photo-grid" aria-label="照片列表">{#each queue as photo (photo.id)}<button class="photo-tile" on:click={()=>openPhoto(photo.id)} aria-label={`编辑照片：${photo.title}`}><div class="tile-image"><img src={photo.src} alt="" width={photo.width} height={photo.height} loading="lazy"/>{#if draft.assignments[photo.id]}<span class="changed">未保存</span>{/if}</div><span class="tile-title">{photo.title}</span><span class="tile-code">{photo.assetCode}</span></button>{/each}</div>
   {:else}<div class="empty"><h2>{library?'这里还没有照片':'正在读取照片…'}</h2><p>{search?'换个关键词，或清除筛选。':'导入照片，或在照片编辑中调整所属相册。'}</p><Button on:click={resetFilters}>查看全部照片</Button></div>{/if}
  </div>
 </div>
</section>

{#if panel==='photo' && current}
 <Dialog title="编辑照片" wide {busy} on:close={()=>panel=null}>
  <div class="photo-editor">
   <div class="preview-column"><a class="photo-stage" href={current.src} target="_blank" rel="noopener" data-no-swup aria-label={`查看原图：${current.title}`}><img src={current.src} alt={current.title} width={current.width} height={current.height}/></a><div class="photo-navigation"><Button on:click={()=>adjacentPhoto(-1)} disabled={busy||queue.findIndex(p=>p.id===currentId)<=0}>上一帧</Button><span>{queue.findIndex(p=>p.id===currentId)>=0?`${queue.findIndex(p=>p.id===currentId)+1} / ${queue.length}`:'已移出当前筛选'}</span><Button on:click={()=>adjacentPhoto(1)} disabled={busy||queue.findIndex(p=>p.id===currentId)<0||queue.findIndex(p=>p.id===currentId)>=queue.length-1}>下一帧</Button></div></div>
   <div class="inspector">
    <Field label="标题" value={current.title} maxlength={100} disabled={busy} on:input={event=>edit('title',event.detail)}/>
    <div class="album-field"><span>所属相册</span><Select label="所属相册" value={current.album} options={albumOptions} disabled={busy} on:change={event=>stage(event.detail)}/></div>
    <Field label="文字备注" value={current.note ?? ''} multiline disabled={busy} placeholder="拍摄地点、故事或素材用途" on:input={event=>edit('note',event.detail)}/>
    <details class="file-details"><summary>文件信息</summary><dl><div><dt>编号</dt><dd>{current.assetCode ?? current.id}</dd></div><div><dt>尺寸</dt><dd>{current.width} × {current.height}</dd></div><div><dt>原文件</dt><dd>{current.originalFilename ?? current.source}</dd></div></dl></details>
    {#if error}<p class="notice" role="alert">{error}</p>{/if}
    <div class="editor-actions"><span role="status">{busy?'正在保存…':changes?`${changes} 项修改暂存中`:'已保存'}</span><Button variant="primary" on:click={save} disabled={!changes||busy}>保存全部修改</Button></div><p class="draft-hint">关闭窗口或切换照片，未保存的修改会继续保留。</p>
   </div>
  </div>
 </Dialog>
{:else if panel==='album' && selectedAlbum && library}
 <Dialog title="相册设置" busy={albumBusy} on:close={()=>panel=null}><AlbumEditor album={library.albums.find(album=>album.slug===albumFilter)!} disabled={busy} on:busy={event=>albumBusy=event.detail} on:saved={event=>{library=event.detail;message='相册信息已保存';}}/></Dialog>
{:else if panel==='upload'}
 <Dialog title="导入照片" {busy} on:close={()=>panel=null}><div class="upload-panel"><p>选择相册，然后添加照片。</p><Select label="上传到相册" bind:value={uploadAlbum} options={(library?.albums ?? []).map(album=>({value:album.slug,label:album.title}))} disabled={busy}/><input class="upload-input" bind:this={uploadInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" multiple on:change={upload} disabled={busy}/><Button variant="primary" on:click={()=>uploadInput.click()} disabled={busy||!library}>{busy?'正在导入…':'选择照片并导入'}</Button><p class="hint">支持多选，每帧最多 30 MB。照片会自动编号并保存为 WebP。</p><p role="status">{busy?message:''}</p>{#if error}<p role="alert">{error}</p>{/if}</div></Dialog>
{:else if panel==='delete' && selectedAlbum}
 <Dialog title="删除相册" {busy} on:close={()=>panel=null}><div class="delete-panel"><h3>删除“{selectedAlbum.title}”？</h3><p>其中的 {library?.photos.filter(photo=>photo.album===selectedAlbum.slug).length ?? 0} 帧照片会移到“待归类”。图片文件、标题和备注都会保留。</p><div class="album-actions"><Button on:click={()=>panel=null} disabled={busy}>取消</Button><Button variant="primary" on:click={deleteAlbum} disabled={busy}>{busy?'正在删除…':'删除相册并保留照片'}</Button></div>{#if error}<p role="alert">{error}</p>{/if}</div></Dialog>
{:else if panel==='create'}
 <Dialog title="新建相册" {busy} on:close={()=>panel=null}><form on:submit={addPlace}><label>相册名称<input bind:value={newTitle} required maxlength="60" placeholder="例如：大阪、丽江"/></label><details class="file-details"><summary>地图位置，可选</summary><div class="coordinates"><label>纬度<input type="number" step="any" min="-90" max="90" bind:value={latitude}/></label><label>经度<input type="number" step="any" min="-180" max="180" bind:value={longitude}/></label></div></details><Button type="submit" variant="primary" disabled={busy}>{busy?'创建中…':'创建相册'}</Button>{#if error}<p role="alert">{error}</p>{/if}</form></Dialog>
{/if}
<style>
.album-actions{display:flex;gap:.6rem;flex-wrap:wrap}.delete-panel{display:grid;gap:1.5rem}.delete-panel p{color:var(--text-secondary);line-height:1.8}.photo-curator{color:var(--text-primary);padding-bottom:3rem}.curation-header{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin:0 0 2.5rem}.curation-header a{font-size:.8rem;color:var(--text-secondary)}h1{font:1.9rem var(--font-display);margin:.6rem 0}.curation-actions{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap}.save-state{font-size:.75rem;color:var(--text-secondary)}.workspace{display:grid;grid-template-columns:180px minmax(0,1fr);gap:2.5rem;align-items:start}.library-nav{position:sticky;top:6rem;max-height:calc(100dvh - 7rem);overflow:auto}.nav-heading{display:flex;justify-content:space-between;align-items:center;margin:2rem .7rem .7rem}.nav-heading h2{font-size:.75rem;color:var(--text-secondary)}.nav-heading button{font-size:.75rem;padding:.35rem;color:var(--text-primary)}nav{display:grid;gap:4px}nav button{display:flex;justify-content:space-between;text-align:left;font-size:.85rem;padding:.7rem .8rem;border-radius:5px;color:var(--text-secondary);gap:.5rem}nav button span{font-size:.75rem;opacity:.7}nav button:hover,nav button.active{background:var(--btn-regular-bg);color:var(--text-primary)}.collection{min-width:0}.collection-header{display:flex;justify-content:space-between;align-items:start;gap:1rem;margin-bottom:1.5rem}.collection-header h2{font:1.65rem var(--font-display);display:flex;align-items:baseline;gap:1rem}.collection-header h2 span{font: .8rem var(--font-ui);color:var(--text-secondary)}.collection-header p{font-size:.82rem;line-height:1.7;color:var(--text-secondary);margin-top:.6rem}.search-row{max-width:27rem;margin-bottom:1.6rem}.photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.8rem 1.3rem}.photo-tile{text-align:left;min-width:0;display:block}.tile-image{position:relative;background:var(--card-bg);aspect-ratio:4/3;overflow:hidden}.tile-image img{width:100%;height:100%;object-fit:cover;transition:transform .2s}.photo-tile:hover img{transform:scale(1.025)}.tile-title{display:block;margin-top:.7rem;font-size:.9rem;line-height:1.5;color:var(--text-primary)}.tile-code{display:block;margin-top:.3rem;font-size:.65rem;color:var(--text-secondary);font-variant-numeric:tabular-nums}.changed{position:absolute;right:.5rem;bottom:.5rem;font-size:.65rem;background:var(--page-bg);padding:.3rem .5rem;border-radius:4px}.status,.notice{font-size:.8rem;padding:.8rem;background:var(--card-bg);margin-bottom:1rem}.empty{min-height:350px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem}.empty p{font-size:.85rem;color:var(--text-secondary)}.photo-editor{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:1.5rem}.preview-column{min-width:0}.photo-stage{height:min(65dvh,640px);display:grid;place-items:center;background:var(--card-bg)}.photo-stage img{width:100%;height:100%;min-height:0;object-fit:contain}.photo-navigation{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1rem}.photo-navigation span{font-size:.75rem;color:var(--text-secondary)}.inspector{display:grid;align-content:start;gap:1.2rem;min-width:0}.album-field{display:grid;gap:.55rem;font-size:.8rem;color:var(--text-secondary)}.file-details{font-size:.78rem;color:var(--text-secondary)}summary{cursor:pointer;padding:.5rem 0}dl{display:grid;gap:.6rem;margin-top:.6rem}dl div{display:grid;grid-template-columns:3rem 1fr;gap:.5rem}dd{overflow-wrap:anywhere}.editor-actions{display:grid;gap:.8rem}.editor-actions span,.draft-hint,.hint{font-size:.73rem;color:var(--text-secondary);line-height:1.7}.upload-panel,form{display:grid;gap:1.2rem}.upload-input{display:none}.upload-panel>p{font-size:.85rem;color:var(--text-secondary)}form label{display:grid;gap:.5rem;font-size:.8rem;color:var(--text-secondary)}form input{width:100%;min-width:0;border-radius:6px;padding:.7rem;background:var(--btn-regular-bg);color:var(--text-primary)}.coordinates{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--primary);outline-offset:3px}@media(min-width:1800px){.photo-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:1000px){.photo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.workspace{grid-template-columns:145px minmax(0,1fr);gap:1.5rem}}@media(max-width:700px){.curation-header{align-items:start;flex-direction:column;gap:1rem}.workspace{grid-template-columns:1fr}.library-nav{position:static;max-height:none}.library-nav nav{display:flex;overflow:auto;gap:.5rem}.library-nav nav button{flex:none}.nav-heading{margin:1rem 0 .5rem}.photo-editor{grid-template-columns:1fr}.photo-stage{height:38dvh}.collection-header{margin-top:1rem}.tile-title{font-size:.8rem}.photo-grid{gap:1.3rem .8rem}.search-row{max-width:none}.file-details{margin-block:.5rem}}@media(prefers-reduced-motion:reduce){.tile-image img{transition:none}}
</style>
