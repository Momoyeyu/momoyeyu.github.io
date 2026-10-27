<script lang="ts">
    import { onMount } from "svelte";
    import { clamp, smoothBetween, openingSceneProgress, followOpeningProgress } from "../utils/opening-motion";
    import { createInkWash, type InkWashRenderer } from "../utils/ink-wash";

    export let image: string;
    export let readLabel: string;
    export let copy: { intro: string; scroll: string };
    let runway: HTMLElement, stage: HTMLElement, canvas: HTMLCanvasElement;
    let feather: HTMLImageElement;
    let intro: HTMLDivElement, footer: HTMLDivElement;
    let enhanced = false, fallback = false;

    function readArticles(event: MouseEvent) {
        const articles = document.getElementById("articles");
        if (!articles) return;
        event.preventDefault(); event.stopPropagation();
        articles.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        articles.focus({ preventScroll: true });
    }

    onMount(() => {
        const motion = matchMedia("(prefers-reduced-motion: reduce)");
        const screen = matchMedia("(min-width: 768px) and (min-height: 620px)");
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
        let renderer: InkWashRenderer | null = null;
        let decoded = false, disposed = false, visible = true, frame = 0, previous = 0;
        let current = 0, target = 0;
        let dark = document.documentElement.classList.contains("dark");

        function readProgress() {
            return clamp(-runway.getBoundingClientRect().top / Math.max(1, runway.offsetHeight - stage.offsetHeight));
        }
        function draw(raw: number) {
            const p = openingSceneProgress(raw);
            stage.style.setProperty("--copy-opacity", String(1 - smoothBetween(.22, .75, raw)));
            stage.style.setProperty("--orbit-opacity", String(1 - smoothBetween(.20, .85, raw)));
            stage.style.setProperty("--footer-opacity", String(1 - smoothBetween(.10, .42, raw)));
            intro.setAttribute("aria-hidden", String(raw > .75));
            footer.setAttribute("aria-hidden", String(raw > .42));
            footer.inert = raw > .42;
            stage.dataset.progress = raw.toFixed(4);
            stage.dataset.dissolve = p.toFixed(4);
            stage.dataset.phase = p === 0 ? "feather" : p === 1 ? "clear" : "ink-drops";
            renderer?.render(p);
        }
        function stop() { cancelAnimationFrame(frame); frame = 0; previous = 0; }
        function tick(time: number) {
            frame = 0;
            if (disposed || !enhanced || !visible || document.hidden) return;
            const seconds = Math.min((time - (previous || time)) / 1000, .05);
            previous = time;
            current = followOpeningProgress(current, target, seconds);
            if (Math.abs(current - target) < .001) { current = target; draw(current); previous = 0; return; }
            draw(current); frame = requestAnimationFrame(tick);
        }
        function scroll() {
            if (!enhanced || !visible || document.hidden) return;
            const next = readProgress();
            if (Math.abs(next - target) > .6) { stop(); current = target = next; draw(next); return; }
            target = next;
            if (!frame && Math.abs(current - target) >= .001) frame = requestAnimationFrame(tick);
        }
        function resize() {
            stop();
            if (!enhanced || !renderer) return;
            const plate = stage.getBoundingClientRect(), art = feather.getBoundingClientRect();
            renderer.resize(stage.clientWidth, stage.clientHeight, Math.min(devicePixelRatio || 1, 1.25), {
                left: art.left - plate.left, top: art.top - plate.top, width: art.width, height: art.height,
            });
            current = target = readProgress(); draw(current);
        }
        function resetPresentation() {
            for (const key of ["--copy-opacity", "--orbit-opacity", "--footer-opacity"]) stage.style.removeProperty(key);
            intro.removeAttribute("aria-hidden"); footer.removeAttribute("aria-hidden"); footer.inert = false;
        }
        function preferences() {
            stop();
            document.documentElement.dataset.openingMotion = String(!motion.matches && !connection?.saveData);
            const allowed = screen.matches && !motion.matches && !connection?.saveData;
            if (allowed && decoded && !renderer) {
                renderer = createInkWash(canvas, feather);
                renderer?.setTheme(document.documentElement.classList.contains("dark"));
            }
            enhanced = allowed && !!renderer;
            fallback = !allowed || (decoded && !renderer);
            stage.dataset.renderer = enhanced ? "ink-drops" : "static";
            if (enhanced) requestAnimationFrame(() => { if (!disposed) resize(); });
            else resetPresentation();
        }
        function visibility() {
            if (document.hidden) stop();
            else if (enhanced && visible) { current = target = readProgress(); draw(current); }
        }
        const intersection = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (!visible) stop(); else if (enhanced) { current = target = readProgress(); draw(current); }
        });
        intersection.observe(runway);
        const observer = new ResizeObserver(resize); observer.observe(stage);
        const themeObserver = new MutationObserver(() => {
            const next = document.documentElement.classList.contains("dark");
            if (next === dark) return;
            dark = next; renderer?.setTheme(dark);
            if (enhanced) draw(current);
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        window.addEventListener("scroll", scroll, { passive: true });
        document.addEventListener("visibilitychange", visibility);
        screen.addEventListener("change", preferences); motion.addEventListener("change", preferences);
        const contextLost = (event: Event) => {
            event.preventDefault(); stop(); enhanced = false; fallback = true;
            resetPresentation(); renderer?.dispose(); renderer = null;
            stage.dataset.renderer = "static";
        };
        canvas.addEventListener("webglcontextlost", contextLost);
        preferences();
        feather.decode().then(() => {
            if (disposed) return;
            decoded = true; preferences();
        }).catch(() => { fallback = true; });
        return () => {
            disposed = true; stop(); intersection.disconnect(); observer.disconnect(); themeObserver.disconnect();
            window.removeEventListener("scroll", scroll); document.removeEventListener("visibilitychange", visibility);
            screen.removeEventListener("change", preferences); motion.removeEventListener("change", preferences);
            canvas.removeEventListener("webglcontextlost", contextLost); renderer?.dispose();
        };
    });
</script>

<section bind:this={runway} class="home-opening" class:enhanced class:static-opening={fallback} data-opening>
    <div bind:this={stage} class="opening-stage">
        <div class="opening-orbit" aria-hidden="true"></div>
        <div class="opening-art" aria-hidden="true">
            <img bind:this={feather} class="opening-feather" src={image} alt="" fetchpriority="high" decoding="async" />
        </div>
        <canvas bind:this={canvas} aria-hidden="true"></canvas>
        <div class="opening-copy">
            <div bind:this={intro} class="opening-intro">
                <h1 class="hero-lettering">Code Is Elegant</h1>
                <p class="opening-description">{copy.intro}</p>
            </div>
        </div>
        <div bind:this={footer} class="opening-footer">
            <span class="opening-scroll"><i aria-hidden="true"></i>{copy.scroll}</span>
            <a href="#articles" onclick={readArticles} class="opening-read">{readLabel}<span aria-hidden="true">↘</span></a>
        </div>
    </div>
</section>

<style>
    .home-opening { position: relative; height: 100svh; isolation: isolate; }
    @media(min-width: 768px) and (min-height: 620px) and (prefers-reduced-motion: no-preference) {
        :global(html[data-opening-motion="true"]) .home-opening:not(.static-opening) { height: 190svh; }
    }
    .opening-stage { position: sticky; top: 0; height: 100svh; width: 100%; overflow: hidden; background: var(--page-bg); color: var(--text-primary); }
    .opening-orbit { position: absolute; width: 70vw; height: 70vw; top: 50%; right: -10vw; transform: translateY(-50%); border-radius: 50%; background: radial-gradient(ellipse, var(--art-halo), transparent 65%); pointer-events: none; opacity: var(--orbit-opacity, 1); }
    .opening-art { position: absolute; right: 1vw; top: 50%; transform: translateY(-50%); width: min(56vw, 80svh); aspect-ratio: 1; }
    .opening-feather { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; }
    .enhanced .opening-feather { opacity: 0; }
    .enhanced canvas { opacity: 1; }
    .opening-copy { position: absolute; left: max(var(--site-gutter), calc((100vw - var(--page-width))/2 + var(--site-gutter))); top: 50%; transform: translateY(-50%); width: 39%; opacity: var(--copy-opacity, 1); }
    .hero-lettering { font-family: "Cormorant Motto", Georgia, serif; font-style: italic; font-weight: 500; font-size: clamp(4.5rem, 7.2vw, 7.5rem); letter-spacing: -.035em; line-height: .98; max-width: 6em; text-wrap: balance; text-shadow: none; color: var(--text-primary); }
    .opening-description { font-family: var(--font-display); font-size: 1rem; letter-spacing: .10em; line-height: 1.95; color: var(--text-secondary); margin-top: 2rem; max-width: 24em; }
    .opening-footer { position: absolute; left: max(var(--site-gutter), calc((100vw - var(--page-width))/2 + var(--site-gutter))); bottom: 2.75rem; right: max(var(--site-gutter), calc((100vw - var(--page-width))/2 + var(--site-gutter))); display: flex; align-items: center; justify-content: space-between; font-size: .8rem; color: var(--text-secondary); opacity: var(--footer-opacity, 1); }
    .opening-scroll { display: flex; align-items: center; gap: 1rem; }
    .opening-scroll i { display: block; height: 2.2rem; width: 1px; background: var(--line-color); }
    .opening-read { display: flex; align-items: center; gap: 1.5rem; min-height: 2.75rem; border-bottom: 1px solid var(--line-color); padding: .25rem .1rem; }
    .opening-read:hover { color: var(--text-primary); border-color: var(--text-primary); }
    @media(min-width: 768px) and (max-width: 1050px) {
        .opening-copy { left: 5vw; width: 43%; }
        .hero-lettering { font-size: 8vw; }
        .opening-art { width: 59vw; right: -3vw; }
        .opening-description { font-size: .85rem; }
    }
    @media(max-width: 767px) {
        .home-opening, .opening-stage { height: 100svh; min-height: 44rem; }
        .opening-art { width: min(95vw, 27rem); right: -2vw; top: 57%; }
        .opening-copy { width: 90%; top: 9.5rem; left: 7vw; transform: none; }
        .hero-lettering { font-size: clamp(3.6rem, 14vw, 5rem); max-width: 6.5em; }
        .opening-description { margin-top: 1.1rem; font-size: .85rem; }
        .opening-footer { bottom: 1.5rem; }
        .opening-scroll { font-size: .7rem; }
    }
</style>
