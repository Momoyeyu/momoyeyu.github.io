<script lang="ts">
 import {onMount,createEventDispatcher} from 'svelte';
 export let title:string;
 export let wide=false;
 export let busy=false;
 let dialog:HTMLDialogElement;
 const dispatch=createEventDispatcher<{close:void}>();
 onMount(() => {
  const previous = document.activeElement as HTMLElement;
  const overflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  dialog.showModal();
  return () => {
   dialog.close();
   document.documentElement.style.overflow = overflow;
   previous?.focus({ preventScroll: true });
  };
 });
 function close(){if(!busy)dispatch('close');}
</script>
<dialog bind:this={dialog} class:wide aria-label={title} on:cancel={event=>{event.preventDefault();close();}}>
 <header><h2>{title}</h2><button type="button" aria-label="关闭窗口" disabled={busy} on:click={close}>关闭</button></header>
 <div class="body"><slot/></div>
</dialog>
<style>
dialog{position:fixed;inset:0;margin:auto;width:min(620px,calc(100vw - 2rem));max-height:calc(100dvh - 3rem);padding:0;border:0;border-radius:10px;background:var(--page-bg);color:var(--text-primary);box-shadow:0 28px 100px #0007;overflow:auto;overscroll-behavior:contain}dialog.wide{width:min(1200px,calc(100vw - 2rem))}dialog::backdrop{background:rgb(0 0 0 / .72);backdrop-filter:blur(5px)}header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1.2rem 1.5rem;background:var(--card-bg);position:sticky;top:0;z-index:55}h2{font-size:1rem;font-weight:500}header button{color:var(--text-secondary);background:var(--btn-regular-bg);padding:.5rem .8rem;border-radius:5px;font-size:.8rem}header button:focus-visible{outline:2px solid var(--primary);outline-offset:3px}header button:disabled{opacity:.4}.body{padding:1.5rem}@media(max-width:650px){dialog,dialog.wide{width:100%;max-height:100dvh;border-radius:0}.body{padding:1rem}}
</style>
