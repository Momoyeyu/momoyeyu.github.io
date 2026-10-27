<script lang="ts">
    import { onMount } from "svelte";

    // The controls live in the sidebar headers and rails; this persistent island
    // keeps layout and accessibility in sync when Swup replaces either sidebar.
    onMount(() => {
        const root = document.documentElement;
        const desktop = matchMedia("(min-width: 1024px)");
        const wide = matchMedia("(min-width: 1280px)");
        const accessibility = () => {
            for (const side of ["left", "right"] as const) {
                const content = document.getElementById(side === "left" ? "sidebar-content" : "right-sidebar-body");
                if (!content) continue;
                const collapsed = root.dataset.reading === "true" && root.dataset[`${side}Collapsed`] === "true"
                    && (side === "left" ? desktop.matches : wide.matches);
                content.inert = collapsed;
                if (collapsed) content.setAttribute("aria-hidden", "true");
                else content.removeAttribute("aria-hidden");
            }
        };
        const sync = () => {
            const reading = String(document.getElementById("swup-container")?.dataset.article === "true");
            const home = String(!!document.querySelector("#home-opening [data-opening]"));
            if (root.dataset.reading !== reading) root.dataset.reading = reading;
            if (root.dataset.home !== home) root.dataset.home = home;
            const hasToc = !!document.querySelector("#right-sidebar table-of-contents");
            document.getElementById("main-grid")?.classList.toggle("has-rsb", hasToc);
            accessibility();
        };
        sync();
        document.addEventListener("swup:content:replace", sync);
        document.addEventListener("reading-sidebar-change", accessibility);
        desktop.addEventListener("change", accessibility);
        wide.addEventListener("change", accessibility);
        return () => {
            document.removeEventListener("swup:content:replace", sync);
            document.removeEventListener("reading-sidebar-change", accessibility);
            desktop.removeEventListener("change", accessibility);
            wide.removeEventListener("change", accessibility);
        };
    });
</script>
