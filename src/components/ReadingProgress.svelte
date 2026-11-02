<script lang="ts">
	import { onMount } from "svelte";

	const { label }: { label: string } = $props();
	let active = $state(false);
	let progress = $state(0);

	onMount(() => {
		let article: HTMLElement | null = null;
		let frame = 0;
		const update = () => {
			frame = 0;
			if (!article?.isConnected) return;
			const rect = article.getBoundingClientRect();
			const headerBottom = document.getElementById("top-row")?.getBoundingClientRect().bottom ?? 0;
			const start = Math.max(0, rect.top + scrollY - headerBottom);
			const end = Math.max(start, rect.bottom + scrollY - innerHeight);
			progress = end > start ? Math.max(0, Math.min(1, (scrollY - start) / (end - start))) : Number(scrollY >= start);
		};
		const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
		const observer = new ResizeObserver(schedule);
		const connect = () => {
			observer.disconnect();
			article = document.querySelector<HTMLElement>("#post-container .markdown-content");
			active = article !== null;
			progress = 0;
			if (article) observer.observe(article);
			schedule();
		};
		const hide = () => { active = false; };
		connect();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule, { passive: true });
		window.addEventListener("pageshow", connect);
		document.addEventListener("swup:visit:start", hide);
		document.addEventListener("swup:page:view", connect);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			window.removeEventListener("pageshow", connect);
			document.removeEventListener("swup:visit:start", hide);
			document.removeEventListener("swup:page:view", connect);
		};
	});
</script>

{#if active}
	<div class="reading-progress" role="progressbar" aria-label={label}
		aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
		<div class="reading-progress-line" style:transform={`scaleX(${progress})`}></div>
	</div>
{/if}

<style>
	.reading-progress { position: fixed; inset: 0 0 auto; height: 3px; z-index: 80; pointer-events: none; }
	.reading-progress-line { width: 100%; height: 100%; background: var(--primary); transform-origin: left center; }
</style>
