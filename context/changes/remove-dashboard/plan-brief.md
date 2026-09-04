# Remove Dashboard — Plan Brief

> Full plan: `context/changes/remove-dashboard/plan.md`

## What & Why

`/dashboard` is a leftover from the 10x-astro-starter scaffold that nothing in the app links or
redirects to any more. It still renders a welcome card duplicating navigation and sign-out that
`AppNav.astro` and `nav/user-menu.tsx` now own. This change retires the page but keeps the URL
alive, redirecting it to `/inventory` so old bookmarks still work.

## Starting Point

`src/pages/dashboard.astro` renders the full starter page. Every redirect in the app now points
elsewhere — sign-in and the signed-in landing both go to `/inventory`, sign-out to `/`. The only
code coupling is the `"/dashboard"` entry in `PROTECTED_ROUTES` (`src/middleware.ts:4`); no test
references the route at all.

## Desired End State

A signed-in visitor hitting `/dashboard` lands on `/inventory`. A signed-out visitor still lands on
`/auth/signin`, exactly as today. No starter markup remains in `src/pages/`, and an E2E spec keeps
the redirect from silently regressing.

## Key Decisions Made

| Decision             | Choice                                     | Why (1 sentence)                                                                            |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Keep or delete route | Keep, as a redirect                        | Old bookmarks stay working instead of hitting a 404.                                        |
| Redirect mechanism   | Page-level `Astro.redirect` in frontmatter | 302 by default and trivially reversible, unlike a config-level entry's hard-cached 301.     |
| Route guard          | Leave `"/dashboard"` in `PROTECTED_ROUTES` | Signed-out visitors keep reaching `/auth/signin` in one hop — no change to a verified path. |
| Doc scope            | `README.md` + `CLAUDE.md.scaffold` only    | `readme2.md` is an untracked draft in flight and belongs to its author.                     |
| Verification         | Playwright E2E spec                        | The authenticated redirect is the one behavior never confirmed at runtime.                  |

## Scope

**In scope:**

- Replace `src/pages/dashboard.astro` with a frontmatter-only redirect to `/inventory`
- Reword `README.md:147` and `CLAUDE.md.scaffold:30`
- Add an E2E spec asserting the authenticated redirect

**Out of scope:**

- Deleting the route, or touching `PROTECTED_ROUTES`
- A config-level `redirects` entry in `astro.config.mjs`
- `readme2.md` (untracked draft)
- Sitemap configuration, and `?next=` return-to-origin support on sign-in

## Architecture / Approach

Middleware runs first and enforces `PROTECTED_ROUTES`, so a signed-out request to `/dashboard`
never reaches the page — it short-circuits to `/auth/signin`. An authenticated request falls
through to the page module, whose only job is `Astro.redirect("/inventory")`. The route file stays
as the single place the legacy URL is handled, mirroring how `index.astro:6` already redirects the
signed-in visitor on `/`.

## Phases at a Glance

| Phase                        | What it delivers                                         | Key risk                                                                  |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Redirect the route + docs | `/dashboard` redirects to `/inventory`; docs match       | Signed-in redirect path is unproven until manually checked                |
| 2. E2E regression coverage   | Spec asserting authenticated `/dashboard` → `/inventory` | Needs local Supabase and a working auth fixture before the suite will run |

**Prerequisites:** Local Supabase running (`npx supabase start`) and a working `tests/auth.setup.ts`
sign-in for Phase 2; nothing beyond the dev stack for Phase 1.
**Estimated effort:** ~1 session across both phases.

## Open Risks & Assumptions

- The signed-in redirect (`/dashboard` → `/inventory`) has been type-checked and built but **never
  confirmed at runtime**. An earlier attempt to verify it was reverted before it completed, so
  Phase 1's manual check and Phase 2's spec are the first real proof.
- Assumes `playwright/.auth/user.json` can still be regenerated — the fixture is gitignored and the
  local test user must exist in the running Supabase instance.
- Phase 2 is routed through `/10x-e2e` per CLAUDE.md; if that skill judges a navigation assertion
  not to warrant a browser test, the coverage decision needs revisiting.
- `readme2.md` keeps a stale `/dashboard` description by choice — worth folding in whenever that
  draft is merged.

## Success Criteria (Summary)

- A bookmarked `/dashboard` lands a signed-in user on `/inventory` rather than a dead starter page
- A signed-out visitor still reaches `/auth/signin`, with no behavior change
- The redirect is covered by a test that fails if someone reverts it
