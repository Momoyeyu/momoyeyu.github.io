<script lang="ts">
 import { tick, createEventDispatcher } from 'svelte';
 export let value = '';
 export let options: {value:string;label:string}[] = [];
 export let label: string;
 export let disabled = false;
 let open = false;
 let root: HTMLDivElement;
 let trigger: HTMLButtonElement;
 const dispatch = createEventDispatcher<{change:string}>();
 async function show() { open = !open; if(open) { await tick(); (root.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? root.querySelector<HTMLButtonElement>('[role="option"]'))?.focus(); } }
 function choose(next:string) { value=next; open=false; dispatch('change',next); trigger.focus(); }
 function keyboard(event:KeyboardEvent) {
  if(event.key==='Escape') {open=false;trigger.focus();event.preventDefault();}
  if(!open && ['ArrowDown','ArrowUp'].includes(event.key)) {event.preventDefault();void show();return;}
  if(!open)return;
  const items=Array.from(root.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  const index=items.indexOf(document.activeElement as HTMLButtonElement);
  let target=-1;
  if(event.key==='ArrowDown')target=(index+1)%items.length;
  if(event.key==='ArrowUp')target=(index-1+items.length)%items.length;
  if(event.key==='Home')target=0;
  if(event.key==='End')target=items.length-1;
  if(target>=0){event.preventDefault();items[target]?.focus();}
 }
</script>
<svelte:window on:pointerdown={event=>{if(root&&!root.contains(event.target as Node))open=false;}} />
<div class="select" bind:this={root} on:keydown={keyboard} on:focusout={event=>{if(!root.contains(event.relatedTarget as Node))open=false;}} role="group" aria-label={label}>
 <button bind:this={trigger} type="button" class="trigger" {disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} on:click={show}><span>{options.find(option=>option.value===value)?.label ?? '请选择'}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class:open><path d="m6 9 6 6 6-6"/></svg></button>
 {#if open}<div class="menu" role="listbox" aria-label={label}>{#each options as option}<button type="button" role="option" aria-selected={option.value===value} tabindex="-1" on:click={()=>choose(option.value)}><span>{option.label}</span><span aria-hidden="true">{option.value===value?'✓':''}</span></button>{/each}</div>{/if}
</div>
<style>
.select{position:relative;min-width:0;width:100%;font-size:.85rem}.trigger{display:flex;align-items:center;justify-content:space-between;gap:1rem;width:100%;padding:.75rem .9rem;background:var(--btn-regular-bg);color:var(--text-primary);border-radius:6px;text-align:left}.trigger span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}svg{flex:none;transition:transform .18s}svg.open{transform:rotate(180deg)}.menu{position:absolute;top:calc(100% + 6px);left:0;width:100%;min-width:10rem;z-index:50;padding:5px;background:var(--card-bg);box-shadow:0 12px 40px #0005;border-radius:8px;max-height:240px;overflow-y:auto;overscroll-behavior:contain}.menu button{display:flex;justify-content:space-between;width:100%;text-align:left;padding:.65rem .75rem;color:var(--text-secondary);border-radius:4px}.menu button:hover,.menu button:focus-visible{background:var(--btn-regular-bg-hover);color:var(--text-primary)}.menu button[aria-selected=true]{background:var(--btn-regular-bg);color:var(--text-primary)}button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}button:disabled{opacity:.4;cursor:not-allowed}@media(prefers-reduced-motion:reduce){svg{transition:none}}
</style>
