# Repository guide

Personal blog built on Astro. Posts live in `src/content/posts/*.md`.

## Categories: ordered vs unordered

A category is one of two kinds, and the distinction is **explicit**:

- **Ordered series (有序合集)** — registered in `src/constants/categories.ts`
  (`ORDERED_CATEGORIES`). Posts in these categories **must** set an `episode`
  number. The archive page sorts them by EP and shows series navigation.
- **Unordered groups (无序分类)** — everything else (e.g. `随笔`, `环境搭建`,
  `项目`). Posts **must not** set `episode`; they sort by date.

This invariant is enforced at build time (`src/content/config.ts`): an ordered
post missing `episode`, or an unordered post carrying one, **fails the build**.

When writing a new post:
1. Check whether its `category` is in `ORDERED_CATEGORIES`.
2. If yes → add `episode`, using the next integer after the current max in that
   series (or a fractional value like `2.5` to slot between existing episodes).
3. If no → do not add `episode`.
4. To make a brand-new category ordered, add its exact name to
   `ORDERED_CATEGORIES`.

## Commits & deploy

- Commit author/committer must be `Momoyeyu <momoyeyu@outlook.com>`.
- Commit message format: exactly `Site updated: YYYY-MM-DD HH:MM:SS` using the
  real current time (no `Co-Authored-By` trailer).
- Deploy = commit to `master` and `git push` (GitHub Pages builds from it).
