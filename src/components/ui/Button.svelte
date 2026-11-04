<script lang="ts">
 export let variant: 'primary'|'quiet' = 'quiet';
 export let disabled = false;
 export let type: 'button'|'submit'|'reset' = 'button';
</script>
<button {type} {disabled} class:primary={variant==='primary'} on:click><slot /></button>
<style>
button{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.7rem 1rem;min-height:40px;border-radius:6px;background:var(--btn-regular-bg);color:var(--text-primary);font-size:.82rem;white-space:nowrap;transition:background .15s}button:hover{background:var(--btn-regular-bg-hover)}button.primary{background:var(--primary);color:var(--page-bg)}button:disabled{opacity:.4;cursor:not-allowed}button:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
</style>
