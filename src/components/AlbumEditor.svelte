<script lang="ts">
 import {createEventDispatcher, onMount} from 'svelte';
 import type {PhotoAlbum,PhotoLibrary} from '../types/photos';
 import Field from './ui/Field.svelte';
 import Button from './ui/Button.svelte';
 export let album:PhotoAlbum;
 export let disabled=false;
 let title=album.title,subtitle=album.subtitle,source=album.source;
 let busy=false,error='',message='';
 let ready=false;
 let previous={title:album.title,subtitle:album.subtitle,source:album.source};
 const storageKey=`album-editor:v1:${album.slug}`;
 onMount(()=>{
  try { const cached=JSON.parse(localStorage.getItem(storageKey)||'null'); if(cached){title=cached.title;subtitle=cached.subtitle;source=cached.source;previous=cached.previous;} } catch {}
  ready=true;
 });
 $: if(ready) {
  try { if(dirty)localStorage.setItem(storageKey,JSON.stringify({title,subtitle,source,previous}));else localStorage.removeItem(storageKey); } catch {error='浏览器未能暂存修改，请及时保存。';}
 }

 const dispatch=createEventDispatcher<{saved:PhotoLibrary}>();
 $: dirty=title!==album.title||subtitle!==album.subtitle||source!==album.source;
 async function save(){
  busy=true;error='';message='';
  try{
   const update={slug:album.slug,title,subtitle,source,previous};
   const response=await fetch('/__photo-curation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assignments:[],albumUpdates:[update]})});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'保存失败');
   const saved=(result as PhotoLibrary).albums.find(item=>item.slug===album.slug);
   if(!saved||saved.title!==title||saved.subtitle!==subtitle||saved.source!==source)throw new Error('保存结果不一致，修改已保留，请重试。');
   previous={title,subtitle,source};dispatch('saved',result);message='相册信息已保存';
  }catch(cause){error=cause instanceof Error?cause.message:'保存失败';}finally{busy=false;}
 }
</script>
<section aria-label="相册信息编辑">
 <header><h2>相册信息</h2><span>显示在相册标题下方</span></header>
 <div class="fields"><Field label="相册名称" bind:value={title} maxlength={60} disabled={busy||disabled}/><Field label="相册描述" bind:value={subtitle} maxlength={500} multiline disabled={busy||disabled}/><Field label="来源说明" bind:value={source} maxlength={500} placeholder="例如：2026 年 6 月，云南毕业旅行" disabled={busy||disabled}/></div>
 <footer><p role="status">{error||message||'相册信息单独保存，不会提交照片草稿。'}</p><Button variant="primary" on:click={save} disabled={!dirty||!title.trim()||busy||disabled}>{busy?'保存中…':'保存相册信息'}</Button></footer>
</section>
<style>
section{background:var(--card-bg);padding:1.5rem;margin-bottom:1.5rem}header{display:flex;align-items:baseline;gap:1rem;margin-bottom:1.3rem}h2{font-size:1rem;font-weight:600}header span,footer p{font-size:.75rem;color:var(--text-secondary)}.fields{display:grid;grid-template-columns:1fr 2fr 2fr;gap:1.2rem;align-items:start}footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1rem}@media(max-width:800px){.fields{grid-template-columns:1fr}header,footer{align-items:start;flex-direction:column}}
</style>
