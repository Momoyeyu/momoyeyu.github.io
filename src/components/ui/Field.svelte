<script lang="ts">
 import { createEventDispatcher } from 'svelte';
 export let label:string;
 export let value='';
 export let multiline=false;
 export let placeholder='';
 export let maxlength=2000;
 export let disabled=false;
 const dispatch=createEventDispatcher<{input:string}>();
</script>
<label><span>{label}</span>{#if multiline}<textarea bind:value {placeholder} {maxlength} {disabled} rows="5" on:input={()=>dispatch('input',value)} />{:else}<input bind:value {placeholder} {maxlength} {disabled} on:input={()=>dispatch('input',value)} />{/if}</label>
<style>
label{display:grid;gap:.55rem;font-size:.8rem;color:var(--text-secondary)}input,textarea{appearance:none;width:100%;min-width:0;border:0;padding:.8rem .9rem;border-radius:6px;background:var(--btn-regular-bg);color:var(--text-primary);font:inherit;font-size:.88rem;line-height:1.6}textarea{resize:vertical;min-height:7rem}input:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}input:disabled,textarea:disabled{opacity:.4}
</style>
