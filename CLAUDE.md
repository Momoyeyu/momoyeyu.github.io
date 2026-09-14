# Repository guide

Personal blog built on Astro. Posts live in `src/content/posts/*.md`.
Day-to-day work goes through Make targets — run `make` for the list.

## Posts & categories

**Every category is a series (合集)** — there is no "plain category" kind, and no
category registry to maintain. A category exists as soon as a post uses it.

Each post must set both `category` and `episode`:

- `episode` is an ordering key, not a display number. The archive numbers a
  series by position, so a series' first post renders as `EP.0` whatever its raw
  `episode` value is.
- New post in an existing series → `episode` = current max + 1. A fractional
  value (e.g. `2.5`) slots between two episodes without renumbering the rest.
- First post of a brand-new series → `episode: 0`.
- `src/utils/content-utils.ts` groups posts by `category` and sorts by `episode`
  to fill in the series metadata (position, prev/next) used by the archive page
  and the "本系列 · 上一集/下一集" links.

Frontmatter fields follow the schema in `src/content/config.ts`: `date` (a YAML
date, not `published`), optional `updated`, `draft` (`true` keeps the post out of
production builds), `pinned`, `description`, `image`, `tags`, `category`,
`episode`, `lang`.

`make new` scaffolds all of this interactively (title / category / filename /
description / tags / episode; `date` = today, `draft: true`, `lang: zh_CN`).
Writing posts by hand is fine too, as long as `category` and `episode` are there.

## Commands

- `make new` — interactive scaffold for a new post (`scripts/new-post.js`).
- `make dev` — local preview on http://localhost:4321.
- `make check` — `astro check` + unit tests; exactly what CI gates on.
- `make deploy` — runs `check`, commits what is **staged** (message = current
  time), then pushes `master`. It never touches the staging area: `git add` what
  you want to publish first. With nothing staged it only pushes.
- `make status` — branch, staged/unstaged changes, and the `draft: true` posts.

## Commits & deploy

- Commit author/committer must be `Momoyeyu <momoyeyu@outlook.com>`.
- Commit message format: exactly `Site updated: YYYY-MM-DD HH:MM:SS` using the
  real current time (no `Co-Authored-By` trailer). `make deploy` writes this for
  you.
- Deploy = commit to `master` and `git push`. GitHub Pages builds from `master`
  after CI runs `pnpm check` → `pnpm test` → `pnpm build`.
