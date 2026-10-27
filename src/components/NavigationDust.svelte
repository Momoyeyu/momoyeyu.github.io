<script lang="ts">
    import { onMount } from "svelte";
    let canvas: HTMLCanvasElement;

    onMount(() => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const reduced = matchMedia("(prefers-reduced-motion: reduce)");
        let frame = 0;
        let origin = { x: innerWidth / 2, y: 40 };
        const rememberOrigin = (event: MouseEvent) => {
            if ((event.target as Element)?.closest("a[href]")) {
                origin = event.detail ? { x: event.clientX, y: event.clientY } : { x: innerWidth / 2, y: 40 };
            }
        };
        const clear = () => { cancelAnimationFrame(frame); ctx.clearRect(0, 0, canvas.width, canvas.height); };
        const scatter = () => {
            clear();
            if (reduced.matches || document.hidden) return;
            const ratio = Math.min(devicePixelRatio || 1, 1.5);
            canvas.width = innerWidth * ratio;
            canvas.height = innerHeight * ratio;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            const color = getComputedStyle(document.documentElement).getPropertyValue("--primary");
            const points = Array.from({ length: 28 }, () => ({
                angle: Math.random() * Math.PI * 2,
                distance: 16 + Math.random() * 82,
                size: .6 + Math.random() * 1.2,
            }));
            const start = performance.now();
            const draw = (time: number) => {
                const t = Math.min((time - start) / 620, 1);
                ctx.clearRect(0, 0, innerWidth, innerHeight);
                ctx.fillStyle = color;
                ctx.globalAlpha = (1 - t) * .7;
                for (const p of points) {
                    const travel = 1 - Math.pow(1 - t, 3);
                    const x = origin.x + Math.cos(p.angle) * p.distance * travel;
                    const y = origin.y + Math.sin(p.angle) * p.distance * travel - 16 * t;
                    ctx.beginPath(); ctx.arc(x, y, p.size * (1 - t * .5), 0, Math.PI * 2); ctx.fill();
                }
                if (t < 1) frame = requestAnimationFrame(draw);
                else clear();
            };
            frame = requestAnimationFrame(draw);
        };
        document.addEventListener("click", rememberOrigin, { capture: true, passive: true });
        document.addEventListener("swup:visit:start", scatter);
        reduced.addEventListener("change", clear);
        document.addEventListener("visibilitychange", clear);
        return () => {
            clear();
            document.removeEventListener("click", rememberOrigin, true);
            document.removeEventListener("swup:visit:start", scatter);
            reduced.removeEventListener("change", clear);
            document.removeEventListener("visibilitychange", clear);
        };
    });
</script>

<canvas bind:this={canvas} class="navigation-dust" aria-hidden="true"></canvas>

<style>
    .navigation-dust { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 80; }
    @media(prefers-reduced-motion: reduce) { .navigation-dust { display: none; } }
</style>
