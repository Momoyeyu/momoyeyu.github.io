/// <reference types="vitest" />
import { getViteConfig } from "astro/config";

// getViteConfig wires up Astro's Vite plugins (virtual modules like
// `astro:content`) and tsconfig path aliases (@utils, @constants, ...), so
// tests can import project modules exactly as the app does.
export default getViteConfig({
	test: {
		include: ["src/**/*.{test,spec}.ts"],
	},
});
