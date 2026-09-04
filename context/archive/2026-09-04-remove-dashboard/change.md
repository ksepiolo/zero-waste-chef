---
change_id: remove-dashboard
title: Remove dashboard
status: archived
created: 2026-09-04
updated: 2026-09-04
archived_at: 2026-09-04T08:33:35Z
---

## Notes

`/dashboard` is a leftover from the 10x-astro-starter scaffold. Findings from a
review on 2026-09-04 (verified by grep across `src/`, `tests/`, configs):

- **Nothing links or redirects to it.** Current redirect targets are
  `api/auth/signin.ts:19` → `/inventory`, `api/auth/signup.ts:19` →
  `/auth/confirm-email`, `api/auth/signout.ts:9` → `/`, `index.astro:6`
  (logged in) → `/inventory`, `middleware.ts:20` → `/auth/signin`. Navigation
  lives in `AppNav.astro` (`/inventory`, `/recipes`) and `nav/user-menu.tsx`.
  The old sign-in → `/dashboard` redirect described in
  `context/changes/sign-up-ux-update/plan.md:184` was already replaced during
  the UX-update work.
- **Only code coupling** is the `"/dashboard"` entry in `PROTECTED_ROUTES`
  (`src/middleware.ts:4`).
- **No test references it** — zero matches in `tests/seed.spec.ts`,
  `tests/generate-approve.spec.ts`, and the vitest/integration tests.
- **Doc references** to update: `README.md:147`, `readme2.md:50`,
  `CLAUDE.md.scaffold:30`.
- The page duplicates nav (Inventory / Recipes) and sign-out that
  `AppNav.astro` + `user-menu.tsx` now own.

**Decision**: keep the URL alive for old bookmarks and redirect to `/inventory`
rather than delete the route.

Open questions for the plan:

- Page-level `Astro.redirect("/inventory")` (302, matches `index.astro:6`) vs a
  config-level entry in `astro.config.mjs` `redirects` — note the config form
  defaults to **301** for GET under SSR, which browsers cache hard and would be
  awkward to undo if a dashboard is ever reintroduced.
- Whether `"/dashboard"` stays in `PROTECTED_ROUTES`. Keeping it sends signed-out
  visitors straight to `/auth/signin` (one hop); removing it sends them
  `/dashboard` → `/inventory` → `/auth/signin`.
- `sitemap()` is currently inert — the build warns it is skipped without a `site`
  option in `astro.config.mjs` — so a redirect route showing up in the sitemap is
  not a live concern today.
