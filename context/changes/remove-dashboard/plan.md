# Remove Dashboard Implementation Plan

## Overview

`/dashboard` is a leftover from the 10x-astro-starter scaffold. Nothing in the app links or
redirects to it any more — navigation moved to `AppNav.astro` and `nav/user-menu.tsx` during the
UX-update work. This plan retires the page while keeping the URL working: `/dashboard` becomes a
redirect to `/inventory`, and an E2E test locks that behavior in.

## Current State Analysis

`src/pages/dashboard.astro` still renders the full starter page — a "Welcome, {email}" card with
links to `/inventory` and `/recipes` plus an inline sign-out form. All three of those duplicate
what `AppNav.astro` and `nav/user-menu.tsx` now own.

The page is an orphan. A grep across `src/`, `tests/`, and the configs finds no link or redirect
to it:

| Source                       | Redirect target       |
| ---------------------------- | --------------------- |
| `api/auth/signin.ts:19`      | `/inventory`          |
| `api/auth/signup.ts:19`      | `/auth/confirm-email` |
| `api/auth/signout.ts:9`      | `/`                   |
| `index.astro:6` (signed in)  | `/inventory`          |
| `middleware.ts:20` (no user) | `/auth/signin`        |

The only code coupling is the `"/dashboard"` entry in `PROTECTED_ROUTES` (`src/middleware.ts:4`).
The old sign-in → `/dashboard` redirect recorded in
`context/changes/sign-up-ux-update/plan.md:184` was already replaced.

## Desired End State

Visiting `/dashboard` while signed in lands the user on `/inventory`. Visiting it signed out still
lands on `/auth/signin`, exactly as today. No starter markup remains in `src/pages/`, and the
tracked docs describe the route as a redirect rather than as a page.

Verify by running the E2E suite (Phase 2) and by visiting `/dashboard` in a browser under each
auth state.

### Key Discoveries:

- `Astro.redirect()` in page frontmatter is an established pattern here — `src/pages/index.astro:6`
  uses it for the signed-in visitor on `/`.
- A frontmatter-only Astro page (no template) compiles and builds clean: `astro check` reported 0
  errors and `npm run build` completed on exactly this shape during the 2026-09-04 review.
- Middleware runs ahead of the page, so the signed-out path never reaches the redirect. Verified by
  curl: `GET /dashboard` returned `302 → /auth/signin` with the guard in place.
- `tests/auth.setup.ts` posts to `/api/auth/signin` and writes `playwright/.auth/user.json`; all
  three browser projects in `playwright.config.ts:41-56` declare `dependencies: ["setup"]`, so an
  authenticated page fixture is available to any spec in `tests/`.
- `playwright/.auth/` is gitignored (`.gitignore:58`), so the auth state is produced locally by the
  setup project rather than committed.
- Astro's config-level `redirects` defaults to **301** for GET under SSR — rejected for this change
  because browsers cache it hard.
- `sitemap()` is currently inert: the build warns it is skipped without a `site` option in
  `astro.config.mjs`, so a redirect route appearing in a sitemap is not a live concern.
- `context/foundation/lessons.md` holds one rule (app-layer `user_id` filter alongside RLS). It
  does not apply — this change touches no service functions or Supabase queries.

## What We're NOT Doing

- Not deleting the `/dashboard` route — the URL stays alive for old bookmarks.
- Not touching `PROTECTED_ROUTES` in `src/middleware.ts`. Keeping `"/dashboard"` preserves the
  one-hop signed-out path that exists today.
- Not using a config-level `redirects` entry in `astro.config.mjs` (301 caching).
- Not editing `readme2.md` — it is an untracked draft README rewrite in flight, left to its author.
- Not adding a `site` option or otherwise touching sitemap configuration.
- Not introducing `?next=` return-to-origin support on sign-in; that remains absent, as noted in
  `context/archive/2026-08-11-recipe-history/reviews/impl-review.md:110`.

## Implementation Approach

Replace the page body with a frontmatter-only redirect, keeping the route file as the single place
the legacy URL is handled. Then cover the authenticated path — the one behavior not yet
verified — with an E2E spec driven through `/10x-e2e`, per the CLAUDE.md rule that the skill is the
single source of truth for E2E workflow.

## Critical Implementation Details

**Timing & lifecycle**: middleware resolves the user and enforces `PROTECTED_ROUTES` before the
page module runs. With `"/dashboard"` staying in that list, the page's redirect is only ever
reached by an authenticated request — the signed-out case short-circuits to `/auth/signin` in
middleware. Any manual check of the redirect must therefore be done while signed in; an
unauthenticated curl will show `/auth/signin` and says nothing about whether the page redirect
works.

---

## Phase 1: Redirect the route and update docs

### Overview

Turn `/dashboard` into a redirect to `/inventory` and bring the tracked docs in line.

### Changes Required:

#### 1. The dashboard route

**File**: `src/pages/dashboard.astro`

**Intent**: Drop the starter markup — the welcome card, the `/inventory` and `/recipes` links, and
the inline sign-out form — and replace the whole file with a frontmatter-only redirect to
`/inventory`, so the legacy URL keeps working without rendering a page the app no longer has.
Include a short comment saying why the route still exists, so a future reader does not delete it as
dead code or mistake it for a real page.

**Contract**: The file is frontmatter only — no `<Layout>`, no template, no `Layout.astro` import,
and no use of `Astro.locals.user`. It returns `Astro.redirect("/inventory")`, which yields a 302.
The route stays at the same path, so `/dashboard` continues to resolve.

#### 2. Tracked documentation

**File**: `README.md`

**Intent**: The auth-routes table at line 147 still describes `/dashboard` as an "Example protected
page". Reword that row so it describes the redirect instead.

**Contract**: The `/dashboard` row remains in the table under `### Auth routes`; only its
description cell changes. Table pipe alignment is preserved — `prettier --write` runs on `*.md` via
lint-staged, so misaligned columns will be reformatted on commit.

**File**: `CLAUDE.md.scaffold`

**Intent**: Line 30 lists `src/pages/dashboard.astro` as the "Protected page example". Reword it to
name the file as a legacy route that redirects to `/inventory`.

**Contract**: The bullet stays in the same list under the auth-flow section; only its wording
changes.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Unit and integration tests pass: `npm test`
- `src/pages/dashboard.astro` contains no `<Layout` and no `Astro.locals` reference
- `grep -n '"/dashboard"' src/middleware.ts` still matches — the guard entry is deliberately kept

#### Manual Verification:

- Signed in, visiting `/dashboard` lands on `/inventory` with the inventory UI rendered
- Signed out, visiting `/dashboard` still lands on `/auth/signin`
- The browser back button after the redirect does not trap the user in a redirect loop
- `/inventory` and `/recipes` remain reachable from `AppNav` — no navigation regressed

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: E2E regression coverage

### Overview

Lock in the authenticated redirect with a Playwright spec, so a future refactor cannot silently
turn `/dashboard` back into a dead end.

### Changes Required:

#### 1. Redirect spec

**File**: `tests/dashboard-redirect.spec.ts`

**Intent**: Assert that an authenticated visit to `/dashboard` ends up on `/inventory`. This is the
one behavior that has never been confirmed at runtime — the signed-out path was verified by curl,
but the signed-in path was not.

**Contract**: A single `test` in `tests/`, picked up by the existing chromium/firefox/webkit
projects, which supply the authenticated storage state via the `setup` dependency. It navigates to
`/dashboard` and waits for the URL to settle on `/inventory` — `waitForURL` or `toHaveURL`, never
`page.waitForTimeout`. The spec creates no data, so it needs no cleanup and no unique-id suffix,
keeping it independent and re-runnable.

**Drive this phase with `/10x-e2e`**, per CLAUDE.md: that skill is the single source of truth for
the E2E workflow and owns the locator rules, the five anti-patterns review, and the verify step.
Note for that run: the risk here is navigational rather than visual, so DOM/snapshot mode applies
and vision is not needed.

### Success Criteria:

#### Automated Verification:

- The new spec passes on all three browser projects: `npm run test:e2e`
- Linting passes on the new test file: `npm run lint`
- The spec fails if the redirect is reverted — confirm by temporarily restoring the old page body
  and re-running, then restoring the redirect

#### Manual Verification:

- The spec is reviewed against the five anti-patterns from `/10x-e2e`
- No `page.waitForTimeout` and no CSS/XPath selectors appear in the new file

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

None. The change has no branching logic, no service function, and no input to validate — a unit
test would assert only that a one-line redirect calls a framework API.

### Integration Tests:

None beyond the E2E spec. The existing integration tests cover the products and recipes API routes
and are untouched by this change.

### Manual Testing Steps:

1. Start the dev stack (`npm run dev` with local Supabase running) and sign in.
2. Navigate to `/dashboard` — confirm you land on `/inventory` with the inventory list rendered.
3. Press the browser back button — confirm you are not bounced forward into a redirect loop.
4. Sign out, then visit `/dashboard` directly — confirm you land on `/auth/signin`.
5. Confirm `AppNav` still moves between `/inventory` and `/recipes` normally.

## Performance Considerations

None. A redirect replaces a rendered page, which is marginally less work per request. The extra hop
for a user arriving on `/dashboard` is negligible and applies only to stale bookmarks.

## Migration Notes

No data migration. The only user-visible migration is behavioral: a bookmarked `/dashboard` now
lands on `/inventory` instead of a standalone page. The 302 is not cached persistently, so
reverting this change restores the old behavior immediately — which is precisely why the page-level
redirect was chosen over a config-level 301.

## References

- Change identity and findings: `context/changes/remove-dashboard/change.md`
- Redirect pattern to follow: `src/pages/index.astro:6`
- Route guard: `src/middleware.ts:4`
- E2E auth fixture: `tests/auth.setup.ts`, wired in `playwright.config.ts:41-56`
- E2E runner: `scripts/test-e2e.sh` (runs the three browser projects one at a time)
- Prior context on the removed `/dashboard` redirect: `context/changes/sign-up-ux-update/plan.md:184`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Redirect the route and update docs

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Production build succeeds: `npm run build`
- [x] 1.4 Unit and integration tests pass: `npm test`
- [x] 1.5 `src/pages/dashboard.astro` contains no `<Layout` and no `Astro.locals` reference
- [x] 1.6 `grep -n '"/dashboard"' src/middleware.ts` still matches — the guard entry is deliberately kept

#### Manual

- [x] 1.7 Signed in, visiting `/dashboard` lands on `/inventory` with the inventory UI rendered
- [x] 1.8 Signed out, visiting `/dashboard` still lands on `/auth/signin`
- [x] 1.9 The browser back button after the redirect does not trap the user in a redirect loop
- [x] 1.10 `/inventory` and `/recipes` remain reachable from `AppNav` — no navigation regressed

### Phase 2: E2E regression coverage

#### Automated

- [ ] 2.1 The new spec passes on all three browser projects: `npm run test:e2e`
- [ ] 2.2 Linting passes on the new test file: `npm run lint`
- [ ] 2.3 The spec fails if the redirect is reverted — confirm by temporarily restoring the old page body and re-running, then restoring the redirect

#### Manual

- [ ] 2.4 The spec is reviewed against the five anti-patterns from `/10x-e2e`
- [ ] 2.5 No `page.waitForTimeout` and no CSS/XPath selectors appear in the new file
