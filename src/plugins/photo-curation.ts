import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PhotoLibrary } from "../types/photos";

export class CurationError extends Error { constructor(message: string, public status = 400) { super(message); } }
const fail = (message: string): never => { throw new CurationError(message); };
const text = (value: unknown, max = 100): string => typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : fail("无效的照片或地点信息");

export function applyPhotoClassification(library: PhotoLibrary, input: unknown): PhotoLibrary {
    if (!input || typeof input !== "object") fail("无效的归类内容");
    const payload = input as Record<string, unknown>;
    if (!Array.isArray(payload.assignments) || payload.assignments.length > 200) fail("归类内容过多或格式无效");
    if (payload.albums !== undefined && (!Array.isArray(payload.albums) || payload.albums.length > 32)) fail("地点内容无效");
    const next = structuredClone(library);
    const seen = new Set<string>();
    for (const raw of (payload.albums ?? []) as Record<string, unknown>[]) {
        if (!raw || typeof raw !== "object") fail("地点内容无效");
        const slug = text(raw.slug, 64), title = text(raw.title, 60);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail("地点标识无效");
        const existing = next.albums.find(album => album.slug === slug);
        if (existing) { if (existing.title !== title) throw new CurationError("地点已被修改，请刷新后重试", 409); continue; }
        const album = { slug, title, subtitle: "", source: title, cover: "" } as PhotoLibrary["albums"][number];
        if (raw.location !== undefined) {
            const location = raw.location as { latitude?: unknown; longitude?: unknown };
            if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number" || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) fail("经纬度无效");
            album.location = { latitude: location.latitude as number, longitude: location.longitude as number };
        }
        next.albums.push(album);
    }
    for (const raw of payload.assignments as Record<string, unknown>[]) {
        if (!raw || typeof raw !== "object") fail("照片内容无效");
        const id = text(raw.photoId), slug = text(raw.album, 64), previous = text(raw.previousAlbum, 64);
        if (seen.has(id)) fail("照片归类重复");
        seen.add(id);
        const photo = next.photos.find(photo => photo.id === id);
        if (!photo) throw new CurationError("照片不存在");
        if (!next.albums.some(album => album.slug === slug)) fail("地点不存在");
        if (photo.album !== previous && photo.album !== slug) throw new CurationError("照片已被修改，请刷新后重试", 409);
        photo.album = slug;
    }
    for (const album of next.albums) {
        const photos = next.photos.filter(photo => photo.album === album.slug);
        if (photos.length && !photos.some(photo => photo.src === album.cover)) album.cover = photos[0].src;
    }
    return next;
}

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
export function photoCurationPlugin() {
    return {
        name: "local-photo-curation", apply: "serve" as const,
        configureServer(server: { middlewares: { use: (path: string, handler: Middleware) => void } }) {
            const file = path.resolve("src/data/photo-library.json");
            server.middlewares.use("/__photo-curation", (req, res) => {
                const send = (status: number, data: unknown) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
                void (async () => {
                    const host = req.headers.host ?? "";
                    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) { send(403, { error: "仅供本地照片归类" }); return; }
                    if (req.method === "GET") { send(200, JSON.parse(fs.readFileSync(file, "utf8"))); return; }
                    if (req.method !== "POST") { send(405, { error: "请求方式不支持" }); return; }
                    if (req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) { send(403, { error: "请求来源无效" }); return; }
                    if (!req.headers["content-type"]?.startsWith("application/json")) { send(415, { error: "归类内容需要 JSON 格式" }); return; }
                    let body = "";
                    for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 65536) throw new CurationError("归类内容过大", 413); }
                    const next = applyPhotoClassification(JSON.parse(fs.readFileSync(file, "utf8")), JSON.parse(body));
                    const temp = `${file}.curation-tmp`;
                    fs.writeFileSync(temp, JSON.stringify(next, null, 2) + "\n");
                    fs.renameSync(temp, file);
                    send(200, next);
                })().catch(error => send(error instanceof CurationError ? error.status : 500, { error: error instanceof CurationError ? error.message : "保存失败，请重试" }));
            });
        },
    };
}
