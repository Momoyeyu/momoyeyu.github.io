<script lang="ts">
    import { onMount } from "svelte";
    import { balanceColumns } from "../utils/masonry-columns";
    onMount(() => {
        let frame = 0;
        const desktop = matchMedia("(min-width: 768px)");
        const layout = () => {
            frame = 0;
            const enabled = desktop.matches && document.documentElement.dataset.postLayout !== "list";
            for (const feed of document.querySelectorAll<HTMLElement>(".post-feed")) {
                const cards = [...feed.querySelectorAll<HTMLElement>(":scope > .grid-post-card")];
                if (!enabled) {
                    delete feed.dataset.masonry;
                    cards.forEach(card => { card.style.removeProperty("grid-column"); card.style.removeProperty("grid-row"); });
                    continue;
                }
                feed.dataset.masonry = "true";
                const gap = parseFloat(getComputedStyle(feed).getPropertyValue("--masonry-gap")) || 48;
                const heights = cards.map(card => card.offsetHeight);
                const columns = balanceColumns(heights.map(height => height + gap));
                columns.forEach((column, side) => {
                    let row = 1;
                    column.forEach(index => {
                        const span = Math.ceil(heights[index] / 2);
                        const card = cards[index];
                        const placement = `${row} / span ${span}`;
                        if (card.style.gridColumn !== String(side + 1)) card.style.gridColumn = String(side + 1);
                        if (card.style.gridRow !== placement) card.style.gridRow = placement;
                        row += span + Math.ceil(gap / 2);
                    });
                });
            }
        };
        const measure = () => { cancelAnimationFrame(frame); layout(); };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
        const observer = new ResizeObserver(schedule);
        const connect = () => {
            observer.disconnect();
            document.querySelectorAll(".post-feed, .post-feed > .grid-post-card").forEach(node => observer.observe(node));
            schedule();
        };
        connect();
        void document.fonts.ready.then(schedule);
        document.addEventListener("swup:page:view", connect);
        document.addEventListener("post-layout:after", schedule);
        document.addEventListener("post-layout:measure", measure);
        desktop.addEventListener("change", schedule);
        return () => {
            observer.disconnect(); cancelAnimationFrame(frame);
            document.removeEventListener("swup:page:view", connect);
            document.removeEventListener("post-layout:after", schedule);
            document.removeEventListener("post-layout:measure", measure);
            desktop.removeEventListener("change", schedule);
        };
    });
</script>
