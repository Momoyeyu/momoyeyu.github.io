import fs from "node:fs"
import path from "node:path"

let _covers: string[] | null = null

function getCovers(): string[] {
  if (_covers) return _covers
  const dir = path.join(process.cwd(), "public/img/covers")
  _covers = fs
    .readdirSync(dir)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map((f) => `/img/covers/${f}`)
    .sort()
  return _covers
}

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function getCover(postId: string, explicitImage?: string): string {
  if (explicitImage) return explicitImage
  const covers = getCovers()
  if (covers.length === 0) return ""
  return covers[hash(postId) % covers.length]
}
