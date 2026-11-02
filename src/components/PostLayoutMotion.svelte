<script lang="ts">
	import { onMount } from "svelte";

	const { selector = "[data-layout-key]" }: { selector?: string } = $props();
	type Snapshot = { rect: DOMRect; clone: HTMLElement | null };

	onMount(() => {
		let before = new Map<string, Snapshot>();
		let frame = 0;
		const animations = new Set<Animation>();
		const ghosts = new Set<HTMLElement>();
		const entered = new WeakSet<HTMLElement>();
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
		const visible = (r: DOMRect) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
		const clear = () => {
			for (const animation of animations) animation.cancel();
			animations.clear();
			for (const ghost of ghosts) ghost.remove();
			ghosts.clear();
		};
		const capture = () => {
			cancelAnimationFrame(frame);
			before = new Map();
			if (!reduced.matches) {
				for (const node of document.querySelectorAll<HTMLElement>(selector)) {
					const rect = node.getBoundingClientRect();
					before.set(node.dataset.layoutKey!, { rect, clone: visible(rect) ? node.cloneNode(true) as HTMLElement : null });
				}
			}
			clear();
		};
		const animate = (node: HTMLElement, keyframes: Keyframe[], duration = 420, remove = false) => {
			const animation = node.animate(keyframes, { duration, easing: "cubic-bezier(.22,1,.36,1)" });
			animations.add(animation);
			animation.finished.then(() => {
				animations.delete(animation);
				if (remove) { node.remove(); ghosts.delete(node); }
			}, () => {});
		};
		const entranceObserver = new IntersectionObserver(entries => {
			const cards = entries.filter(entry => entry.isIntersecting)
				.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
			cards.forEach((entry, index) => {
				const node = entry.target as HTMLElement;
				entranceObserver.unobserve(node);
				if (entered.has(node)) return;
				entered.add(node);
				if (reduced.matches) return;
				const animation = node.animate([
					{ opacity: 0, transform: "translateY(24px) scale(.975)" },
					{ opacity: 1, transform: "none" },
				], { duration: 650, delay: Math.min(index * 90, 270), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
				animations.add(animation);
				animation.finished.then(() => animations.delete(animation), () => {});
			});
		}, { threshold: .08 });
		const observeEntrances = () => {
			entranceObserver.disconnect();
			document.querySelectorAll<HTMLElement>(".grid-post-card").forEach(node => {
				if (!entered.has(node)) entranceObserver.observe(node);
			});
		};
		const play = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				document.dispatchEvent(new Event("post-layout:measure"));
				observeEntrances();
				if (reduced.matches || !before.size) return;
				const nodes = [...document.querySelectorAll<HTMLElement>(selector)];
				if (!nodes.length) return;
				const next = nodes.map(node => ({ node, rect: node.getBoundingClientRect() }));
				const keys = new Set(nodes.map(node => node.dataset.layoutKey));
				for (const { node, rect } of next) {
					const previous = before.get(node.dataset.layoutKey!);
					if (!visible(rect) && !(previous && visible(previous.rect))) continue;
					if (!previous) {
						entered.add(node);
						animate(node, [{ opacity: 0, transform: "translateY(12px) scale(.98)" }, { opacity: 1, transform: "none" }], 280);
						continue;
					}
					const old = previous.rect;
					if (!rect.width || !rect.height) continue;
					if (Math.abs(old.left-rect.left)+Math.abs(old.top-rect.top)+Math.abs(old.width-rect.width)+Math.abs(old.height-rect.height) < 1) continue;
					animate(node, [
						{ transformOrigin: "0 0", transform: `translate(${old.left-rect.left}px, ${old.top-rect.top}px) scale(${old.width/rect.width}, ${old.height/rect.height})` },
						{ transformOrigin: "0 0", transform: "none" },
					]);
				}
				const kinds = new Set(nodes.map(node => node.dataset.layoutKey?.split(":")[0]));
				for (const [key, { rect, clone }] of before) {
					if (keys.has(key) || !clone || !kinds.has(key.split(":")[0])) continue;
					clone.removeAttribute("id");
					clone.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
					clone.removeAttribute("data-layout-key");
					clone.setAttribute("aria-hidden", "true");
					clone.inert = true;
					Object.assign(clone.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none", zIndex: "40", animation: "none" });
					document.body.append(clone);
					ghosts.add(clone);
					animate(clone, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px) scale(.97)" }], 160, true);
				}
				before.clear();
			});
		};
		reduced.addEventListener("change", clear);
		observeEntrances();
		document.addEventListener("post-layout:before", capture);
		document.addEventListener("post-layout:after", play);
		document.addEventListener("swup:visit:start", capture);
		document.addEventListener("swup:page:view", play);
		return () => {
			cancelAnimationFrame(frame);
			entranceObserver.disconnect();
			reduced.removeEventListener("change", clear);
			clear();
			document.removeEventListener("post-layout:before", capture);
			document.removeEventListener("post-layout:after", play);
			document.removeEventListener("swup:visit:start", capture);
			document.removeEventListener("swup:page:view", play);
		};
	});
</script>
