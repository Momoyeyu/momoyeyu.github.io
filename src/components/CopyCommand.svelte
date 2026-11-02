<script lang="ts">
    import { onDestroy } from "svelte";
    import I18nKey from "../i18n/i18nKey";
    import { i18n } from "../i18n/translation";
    export let command: string;
    let copied = false;
    let timer: ReturnType<typeof setTimeout>;
    async function copy() {
        try { await navigator.clipboard.writeText(command); copied = true; clearTimeout(timer); timer = setTimeout(() => copied = false, 1500); }
        catch { copied = false; }
    }
    onDestroy(() => clearTimeout(timer));
</script>
<div class="command">
    <code>{command}</code>
    <button type="button" on:click={copy} aria-live="polite">{i18n(copied ? I18nKey.commandCopied : I18nKey.copyCommand)}</button>
</div>
<style>
.command { display: flex; align-items: center; gap: .75rem; padding: .85rem 1rem; background: var(--btn-regular-bg); color: var(--text-primary); border-radius: var(--radius-inset); }
code { flex: 1; min-width: 0; font-size: .75rem; overflow-x: auto; white-space: nowrap; }
button { flex-shrink: 0; color: var(--primary); font-size: .75rem; padding: .4rem; border-radius: var(--radius-panel); }
button:hover { background: var(--btn-regular-bg-hover); }
</style>
