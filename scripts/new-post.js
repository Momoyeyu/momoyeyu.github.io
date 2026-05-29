/* This is a script to create a new post markdown file with front-matter */

import fs from "node:fs"
import path from "node:path"

const targetDir = "./src/content/posts/"

function getDate() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

// Read the ordered-series list straight from its source of truth so the
// scaffold and the build-time validation can never drift apart.
function getOrderedCategories() {
  try {
    const src = fs.readFileSync("./src/constants/categories.ts", "utf-8")
    const block = src.match(
      /ORDERED_CATEGORIES\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/,
    )
    if (!block) return []
    return [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
  } catch {
    return []
  }
}

// Next episode number for an ordered series = max existing episode + 1
// (0 for the first post), matching the 0-indexed convention.
function nextEpisode(category) {
  let max = -1
  for (const file of fs.readdirSync(targetDir)) {
    if (!/\.mdx?$/.test(file)) continue
    const fm = fs
      .readFileSync(path.join(targetDir, file), "utf-8")
      .match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!fm) continue
    const cat = fm[1]
      .match(/^category:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "")
    if (cat !== category) continue
    const ep = fm[1].match(/^episode:\s*(.+)$/m)?.[1]?.trim()
    if (ep !== undefined && !Number.isNaN(Number(ep))) {
      max = Math.max(max, Number(ep))
    }
  }
  return max + 1
}

// Parse args: first positional is the filename; --category <name> is optional.
const argv = process.argv.slice(2)
let fileName
let category = ""
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === "--category" || arg === "-c") {
    category = argv[++i] ?? ""
  } else if (arg.startsWith("--category=")) {
    category = arg.slice("--category=".length)
  } else if (!fileName) {
    fileName = arg
  }
}

if (!fileName) {
  console.error(`Error: No filename argument provided
Usage: pnpm new-post -- <filename> [--category "<name>"]`)
  process.exit(1) // Terminate the script and return error code 1
}

// Add .md extension if not present
const fileExtensionRegex = /\.(md|mdx)$/i
if (!fileExtensionRegex.test(fileName)) {
  fileName += ".md"
}

const fullPath = path.join(targetDir, fileName)

if (fs.existsSync(fullPath)) {
  console.error(`Error: File ${fullPath} already exists `)
  process.exit(1)
}

// recursive mode creates multi-level directories
const dirPath = path.dirname(fullPath)
if (!fs.existsSync(dirPath)) {
  fs.mkdirSync(dirPath, { recursive: true })
}

// Ordered-series categories require an `episode`; auto-fill it so the post
// passes the content-collection validation. Unordered categories must NOT
// carry an episode, so it is omitted there.
const isOrdered = category !== "" && getOrderedCategories().includes(category)
// Compute once, before the file exists — recomputing afterwards would count
// the just-created post and report the wrong number.
const episode = isOrdered ? nextEpisode(category) : null
const episodeLine = episode !== null ? `\nepisode: ${episode}` : ""

const title = path.basename(fileName).replace(/\.mdx?$/i, "")

const content = `---
title: ${title}
published: ${getDate()}
description: ''
image: ''
tags: []
category: '${category}'${episodeLine}
draft: false
lang: ''
---
`

fs.writeFileSync(fullPath, content)

console.log(
  `Post ${fullPath} created${episode !== null ? ` (episode ${episode} in "${category}")` : ""}`,
)
