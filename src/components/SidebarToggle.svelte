<script lang="ts">
    import { onMount } from "svelte";

    export let side: "left" | "right";
    export let variant: "icon" | "rail" = "icon";
    export let collapseLabel: string;
    export let expandLabel: string;
    let closed = false;
    let ready = false;

    onMount(() => {
        const root = document.documentElement;
        const sync = () => { closed = root.dataset[`${side}Collapsed`] === "true"; };
        sync(); ready = true;
        const observer = new MutationObserver(sync);
        observer.observe(root, { attributes: true, attributeFilter: [`data-${side}-collapsed`] });
        return () => observer.disconnect();
    });

    function toggle() {
        const root = document.documentElement;
        const next = root.dataset[`${side}Collapsed`] !== "true";
        root.dataset[`${side}Collapsed`] = String(next);
        try { localStorage.setItem(`reading-${side}:v1`, String(next)); } catch { /* Storage is optional. */ }
        document.dispatchEvent(new CustomEvent("reading-sidebar-change"));
        requestAnimationFrame(() => {
            const selector = `.sidebar-toggle-${side}[data-variant="${next ? "rail" : "icon"}"]`;
            document.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
        });
    }
</script>

<button type="button" class="sidebar-toggle sidebar-toggle-{side}" class:ready data-variant={variant}
    aria-label={closed ? expandLabel : collapseLabel} title={closed ? expandLabel : collapseLabel}
    aria-controls={side === "left" ? "sidebar-content" : "right-sidebar-body"} aria-expanded={!closed}
    disabled={!ready} onclick={toggle}>
    {#if variant === "rail"}
        <span class="rail-grip" aria-hidden="true"></span>
    {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path class="edge" d={side === "left" ? "M6 5v14" : "M18 5v14"} />
            <path class="direction" d={side === "left" ? "m14 8-4 4 4 4" : "m10 8 4 4-4 4"} />

        </svg>
    {/if}
</button>

<style>
    .sidebar-toggle { display: none; color: var(--btn-content); border: 0; background: transparent; cursor: pointer; transition: background .18s ease, color .18s ease, opacity .22s ease; }
    .sidebar-toggle:not(.ready) { visibility: hidden; }
    .sidebar-toggle:hover { background: var(--btn-plain-bg-hover); color: var(--primary); }
    .sidebar-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
    .sidebar-toggle[data-variant="icon"] { width: 2rem; height: 2rem; border-radius: 50%; align-items: center; justify-content: center; flex-shrink: 0; }
    svg { width: 1.125rem; height: 1.125rem; }
    .edge { opacity: .4; transition: opacity .2s ease; }
    .direction { transition: transform .2s ease; }
    .sidebar-toggle:hover .edge { opacity: .75; }
    .sidebar-toggle-left:hover .direction { transform: translateX(-2px); }
    .sidebar-toggle-right:hover .direction { transform: translateX(2px); }
    .sidebar-toggle[data-variant="rail"] { position: sticky; top: 5.5rem; width: 100%; height: calc(100svh - 7rem); min-height: 12rem; border-radius: .75rem; align-items: center; justify-content: center; opacity: 0; visibility: hidden; pointer-events: none; }
    .rail-grip { display: block; width: 3px; height: 2.25rem; border-radius: 2px; background: var(--text-muted); opacity: .6; }
    .sidebar-toggle[data-variant="rail"]:hover .rail-grip { opacity: 1; background: var(--primary); }
    @media(min-width: 1024px) {
        :global(html[data-reading="true"]) .sidebar-toggle-left { display: flex; }
        :global(html[data-reading="true"][data-left-collapsed="true"]) .sidebar-toggle-left[data-variant="rail"] { opacity: 1; visibility: visible; pointer-events: auto; }
    }
    @media(min-width: 1280px) {
        :global(html[data-reading="true"]) .sidebar-toggle-right { display: flex; }
        :global(html[data-reading="true"][data-right-collapsed="true"]) .sidebar-toggle-right[data-variant="rail"] { opacity: 1; visibility: visible; pointer-events: auto; }
    }
    @media(prefers-reduced-motion: reduce) { .sidebar-toggle, .edge, .direction { transition: none; } }
</style>
