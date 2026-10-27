<script lang="ts">
	import { onMount } from "svelte";
	import type { MascotState } from "@constants/mascot";

	const { states, cornerLabel, interactLabel }: { states: MascotState[]; cornerLabel: string; interactLabel: string } = $props();
	let stateIndex = $state(0);
	let lastInteraction = 0;
	let message = $state("");
	let speaking = $state(false);
	let yielding = $state(false);
	let widget: HTMLElement, button: HTMLButtonElement;
	let resetTimer: ReturnType<typeof setTimeout>;
	let greetingTimer: ReturnType<typeof setTimeout>;
	const current = $derived(states[stateIndex]);

	function showMessage(text: string) {
		clearTimeout(resetTimer);
		message = text;
		speaking = true;
		resetTimer = setTimeout(() => {
			speaking = false;
			stateIndex = 0;
		}, 5200);
	}

	function interact() {
		clearTimeout(greetingTimer);
		lastInteraction = (lastInteraction + 1) % states.length;
		stateIndex = lastInteraction;
		const lines = states[stateIndex].messages;
		showMessage(lines[Math.floor(Math.random() * lines.length)]);
	}

	onMount(() => {
        let frame = 0;
        const yieldToControls = () => {
            frame = 0;
            if (!button || !widget.offsetWidth) return;
            const rect = button.getBoundingClientRect();
            button.style.pointerEvents = "none";
            // Yield only the character's hit area; the artwork remains visible.
            let overlap = false;
            for (const u of [.1, .3, .5, .7, .9]) for (const v of [.05, .15, .25, .35, .45, .55, .65, .75, .85, .95]) {
                const target = document.elementFromPoint(rect.left + rect.width * u, rect.top + rect.height * v);
                if (target?.closest("a,button,input,select,textarea,summary,[role='button']")) overlap = true;
            }
            button.style.removeProperty("pointer-events");
            yielding = overlap;
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(yieldToControls); };
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule, { passive: true });
        document.addEventListener("swup:page:view", schedule);
        schedule();
		if (window.matchMedia("(min-width: 769px)").matches) {
			for (const state of states) {
				const image = new Image();
				image.src = state.image;
			}
			greetingTimer = setTimeout(() => showMessage(states[0].messages[0]), 2000);
		}
		return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            document.removeEventListener("swup:page:view", schedule);
			clearTimeout(resetTimer);
			clearTimeout(greetingTimer);
		};
	});
</script>

<aside bind:this={widget} class="mascot-widget" class:yielding aria-label={cornerLabel} data-pagefind-ignore>
	<div class="mascot-bubble" class:visible={speaking} aria-live="polite" aria-atomic="true">
		{speaking ? message : ""}
	</div>
	<button bind:this={button} type="button" class="mascot-button" onclick={interact}
		aria-label={interactLabel} title={interactLabel}>
		<img src={current.image} alt={current.label} width="104" height="128" draggable="false" />
	</button>
</aside>

<style>
	.mascot-widget {
		position: fixed;
		bottom: 5rem;
		right: 0;
		z-index: 49;
		width: 104px;
		height: 128px;
		pointer-events: none;
	}
	.mascot-widget.yielding .mascot-button { pointer-events: none; }
	.mascot-button {
		display: block;
		position: absolute;
		left: 24px;
		top: 8px;
		width: 56px;
		height: 112px;
		padding: 0;
		border: 0;
		border-radius: 1.5rem;
		background: transparent;
		cursor: pointer;
		pointer-events: auto;
		-webkit-tap-highlight-color: transparent;
		transition: transform 180ms ease;
	}
	.mascot-button img {
		position: absolute;
		left: -24px;
		top: -8px;
		width: 104px;
		height: 128px;
		max-width: none;
		object-fit: contain;
		pointer-events: none;
		user-select: none;
		filter: drop-shadow(0 4px 5px color-mix(in srgb, var(--text-primary) 12%, transparent));
		animation: breathe 5s ease-in-out infinite;
	}
	.mascot-button:hover { transform: translateY(-3px); }
	.mascot-button:active { transform: translateY(1px) scale(0.97); }
	.mascot-button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
	.mascot-bubble {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		right: 0.5rem;
		width: 160px;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--line-color);
		border-radius: 16px 16px 5px 16px;
		background: var(--card-bg);
		color: var(--text-primary);
		font-size: 0.8rem;
		line-height: 1.8;
		box-shadow: 0 5px 20px color-mix(in srgb, var(--text-primary) 8%, transparent);
		opacity: 0;
		transform: translateY(4px);
		transition: opacity 180ms ease, transform 180ms ease;
	}
	.mascot-bubble.visible { opacity: 1; transform: translateY(0); }
	@keyframes breathe {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-3px); }
	}
	@media (max-width: 768px) { .mascot-widget { display: none; } }
	@media (prefers-reduced-motion: reduce) {
		.mascot-button img { animation: none; }
		.mascot-button, .mascot-bubble { transition: none; }
	}
</style>
