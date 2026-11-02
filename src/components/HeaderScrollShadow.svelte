<script lang="ts">
	import { onMount } from "svelte";

	const { targetId = "navbar" }: { targetId?: string } = $props();

	onMount(() => {
		const header = document.getElementById(targetId);
		if (!header) return;
		let frame = 0;
		const update = () => {
			frame = 0;
			header.style.setProperty("--header-elevation", String(Math.max(0, Math.min(1, window.scrollY / 32))));
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("pageshow", schedule);
		document.addEventListener("swup:page:view", schedule);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("pageshow", schedule);
			document.removeEventListener("swup:page:view", schedule);
			header.style.removeProperty("--header-elevation");
		};
	});
</script>
