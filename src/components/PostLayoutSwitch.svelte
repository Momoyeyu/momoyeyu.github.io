<script lang="ts">
import { onMount } from "svelte";
import {
	getPostLayout,
	setPostLayout,
	type POST_LAYOUT,
} from "../utils/setting-utils";

const { labels }: { labels: { grid: string; list: string } } = $props();
let layout: POST_LAYOUT = $state("grid");
let ready = $state(false);

onMount(() => {
	layout = getPostLayout();
	ready = true;
});

function selectLayout(nextLayout: POST_LAYOUT) {
	if (layout === nextLayout) return;
	layout = nextLayout;
	setPostLayout(nextLayout);
}
</script>

<div class="post-layout-switch text-75" class:ready>
	<button
		type="button"
		aria-label={labels.grid}
		title={labels.grid}
		disabled={!ready}
		aria-pressed={layout === "grid"}
		onclick={() => selectLayout("grid")}
	>
		<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
			<rect x="3" y="3" width="5" height="5" rx="1" />
			<rect x="12" y="3" width="5" height="5" rx="1" />
			<rect x="3" y="12" width="5" height="5" rx="1" />
			<rect x="12" y="12" width="5" height="5" rx="1" />
		</svg>
	</button>
	<button
		type="button"
		aria-label={labels.list}
		title={labels.list}
		disabled={!ready}
		aria-pressed={layout === "list"}
		onclick={() => selectLayout("list")}
	>
		<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
			<path d="M8 4h9M8 10h9M8 16h9" />
			<path d="M3 4h1M3 10h1M3 16h1" stroke-width="2.5" />
		</svg>
	</button>
</div>

<style>
	.post-layout-switch {
		visibility: hidden;
		display: flex;
		flex-shrink: 0;
		gap: 0.125rem;
		padding: 0.125rem;
		border: 1px solid var(--line-color);
		border-radius: 0.75rem;
	}
	.post-layout-switch.ready { visibility: visible; }
	@media(max-width: 767px) { .post-layout-switch { display: none; } }
	button {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.5625rem;
		color: inherit;
		opacity: 0.55;
		transition: color 150ms ease, background-color 150ms ease, opacity 150ms ease;
	}
	button:hover {
		opacity: 1;
		background: var(--btn-plain-bg-hover);
	}
	button[aria-pressed="true"] {
		color: var(--primary);
		background: var(--btn-regular-bg);
		opacity: 1;
	}
	button:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		button { transition: none; }
	}
</style>
