import { getCollection } from "astro:content";
import { allocateCovers } from "./cover-assignment";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

let _covers: string[] | null = null;

function getCovers(): string[] {
	if (_covers && !import.meta.env.DEV) return _covers;
	const dir = path.join(process.cwd(), "public/img/covers");
	_covers = fs
		.readdirSync(dir)
		.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
		.map((f) => `/img/covers/${f}`)
		.sort();
	return _covers;
}

let assignmentCache: { key: string; assignments: Map<string, string> } | undefined;

export async function getCover(postId: string, explicitImage?: string): Promise<string> {
    if (explicitImage) return explicitImage;
    const covers = getCovers();
    if (!covers.length) return "";
    const posts = (await getCollection("posts", ({ data }) =>
        (!import.meta.env.PROD || !data.draft) && !data.image
    )).sort((a, b) => Number(b.data.pinned) - Number(a.data.pinned)
        || b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
    const ids = posts.map(post => post.id);
    const key = JSON.stringify([ids, covers]);
    if (assignmentCache?.key !== key) assignmentCache = { key, assignments: allocateCovers(ids, covers) };
    return assignmentCache.assignments.get(postId) ?? covers[0];
}

const aspectCache = new Map<string, Promise<number>>();

export function getCoverAspect(src: string): Promise<number> {
    if (!src.startsWith("/img/")) return Promise.resolve(1.6);
    let aspect = aspectCache.get(src);
    if (!aspect) {
        aspect = sharp(path.join(process.cwd(), "public", src)).metadata()
            .then(({ width, height }) => width && height ? width / height : 1.6)
            .catch(() => 1.6);
        aspectCache.set(src, aspect);
    }
    return aspect;
}
