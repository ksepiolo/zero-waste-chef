<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recipe History

- **Plan**: `context/changes/recipe-history/plan.md`
- **Scope**: Full plan — Phase 1 and Phase 2 (all Progress boxes `[x]`)
- **Date**: 2026-08-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations
- **Commits reviewed**: `964cc5e` (p1), `93535bc` (p2), `76cb602`, `0b8aca7`, `2d6cd1f` (docs)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification (re-run during this review)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS — 44 files, 0 errors, 0 warnings (4 hints, all pre-existing `eslint.config.js` deprecations) |
| `npm run lint` | PASS — no errors |
| `npm run build` | PASS — server built in 3.58s (only pre-existing sitemap `site` warning) |

## Notes on what was verified clean

Recorded so a future review does not re-litigate these:

- **Auth at the boundary** — `src/pages/api/recipes/index.ts` reproduces the sibling ladder exactly: 503 → 401 → 400 → 500, with auth before any DB work. `/api/recipes` is *not* covered by `PROTECTED_ROUTES` (`startsWith` matches `/api` first), so the endpoint's own 401 is load-bearing and present.
- **App-layer `user_id` filter** — `listRecipes` (`recipe.service.ts:174`) chains `.eq("user_id", userId)` alongside RLS, satisfying the lessons rule at `context/foundation/lessons.md:5-10`.
- **Server-only module leak** — traced the island's full import graph (`@/types`, `@/components/ui/button` → `@/lib/utils`, `lucide-react`, `sonner`). `recipe.service.ts` (which imports `astro:env/server`) is reachable only from `recipes.astro` frontmatter and the API route. Putting `RECIPES_PAGE_SIZE` in `src/types.ts` was the correct call and is documented in-file.
- **Hydration mismatch** — `formatDate` pins both `"en-GB"` and `timeZone: "UTC"` (`recipe-history-panel.tsx:17-24`), exactly as the plan required.
- **Pagination race** — rapid Previous/Next cannot produce out-of-order renders: `setIsLoading(true)` runs synchronously before the `await` and both buttons carry `disabled={… || isLoading}`. Correctness rests entirely on that flag; there is no `AbortController` or sequence token.
- **Unbounded offset** — `max(1000)` rejects rather than clamps, capping the offset at 19,980 rows; the query is served by `recipes_user_created_idx`.
- **XSS / data safety** — no `dangerouslySetInnerHTML` or `set:html` anywhere in `src/`; the feature is strictly read-only (`.select()` only, `GET` only, no migration).
- **Scope** — no delete UI, no re-cook, no search, no detail route, no migration, no change to `generate.ts`/`approve.ts`, `Topbar.astro` and `Layout.astro` untouched, `excludeTitles` still session-scoped. `recipe.service.ts` diff is purely additive.

## Findings

### F1 — Manual class concatenation violates the `cn()` hard rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/recipes/recipe-history-panel.tsx:130`
- **Detail**: The chevron builds its class string with a template literal and an inline ternary:
  `className={\`size-4 text-white/40 transition-transform ${isExpanded ? "rotate-180" : ""}\`}`.
  CLAUDE.md states as a hard rule: "use `cn()` from `@/lib/utils` (clsx + tailwind-merge). Do not concatenate class strings manually." A repo-wide grep confirms this is the **only** manual concatenation in `src/components/` — the precedent for exactly this conditional-class case is `src/components/auth/FormField.tsx:51`. Beyond consistency, bypassing `cn()` skips `tailwind-merge` conflict resolution, so a later-added conflicting class will not override correctly.
- **Fix**: Replace with `cn("size-4 text-white/40 transition-transform", isExpanded && "rotate-180")` and import `cn` from `@/lib/utils`.
  - Strength: Restores the single repo-wide convention and regains tailwind-merge behavior.
  - Tradeoff: None — one line, one import.
  - Confidence: HIGH — explicit CLAUDE.md rule, with an in-repo precedent to copy.
  - Blind spot: None significant.
- **Decision**: FIXED — chevron now uses `cn()`; `cn` imported from `@/lib/utils`.

### F2 — `aria-controls` points at an element that does not exist while collapsed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (accessibility)
- **Location**: `src/components/recipes/recipe-history-panel.tsx:124` (with `:134`)
- **Detail**: The toggle button always renders `aria-controls={panelId}` (line 124), but the element carrying `id={panelId}` is conditionally mounted — `{isExpanded && <div id={panelId} …>}` (line 134). Collapsed is the default state for every row, so on first paint every button references a non-existent ID. This breaks the ARIA disclosure pattern: screen readers offering "jump to controlled element" (JAWS, NVDA) have nothing to resolve. `aria-expanded` still conveys open/closed state, so this degrades the experience rather than breaking it. `eslint-plugin-jsx-a11y` does not catch dangling `aria-controls` targets — the file passes lint.
- **Fix A ⭐ Recommended**: Always render the panel and toggle visibility with the `hidden` attribute — `<div id={panelId} hidden={!isExpanded} className="…">`.
  - Strength: Makes the reference valid in every state and is the canonical disclosure pattern; `hidden` keeps the content out of the a11y tree and out of tab order.
  - Tradeoff: Recipe bodies for all 20 rows are in the DOM at once instead of one — negligible at a 20-row page size, which is already the payload guard.
  - Confidence: HIGH — standard ARIA disclosure implementation.
  - Blind spot: `hidden` can be overridden by a `display` utility class; verify the panel actually hides under Tailwind 4's preflight.
- **Fix B**: Drop `aria-controls` and rely on `aria-expanded` plus DOM adjacency.
  - Strength: Smallest possible change; keeps the conditional mount exactly as is.
  - Tradeoff: Loses the explicit programmatic relationship — acceptable but strictly less informative than Fix A.
  - Confidence: HIGH — `aria-expanded` alone is a valid, widely used disclosure.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — panel is always mounted with `hidden={!isExpanded}`. Blind spot cleared: Tailwind 4 preflight (`node_modules/tailwindcss/preflight.css:391`) applies `display: none !important` to `[hidden]`, and the panel carries no display utility.

### F3 — Pagination drops keyboard focus and announces nothing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: `src/components/recipes/recipe-history-panel.tsx:83-99`
- **Detail**: Two gaps. (a) Clicking Next onto the last page sets `disabled` on the still-focused Next button, dropping focus to `<body>` — a keyboard user loses their place and must re-tab from the top. Same for Previous onto page 1. (b) The list swaps content with no `aria-live` / `aria-busy`, so a screen-reader user gets no signal that a page turn happened or is in flight. Neither is caught by `eslint-plugin-jsx-a11y`.
- **Fix**: Add `aria-live="polite" aria-busy={isLoading}` to the results container, and either keep the buttons enabled with out-of-range clicks no-oped, or move focus to the list after a page turn.
- **Decision**: FIXED — results wrapped in an always-mounted `aria-live="polite" aria-busy={isLoading}` container; both buttons switched from `disabled` to `aria-disabled` (+ `aria-disabled:pointer-events-none aria-disabled:opacity-50`) so focus survives the range edges, with out-of-range and in-flight clicks rejected inside `goToPage`. Because `aria-disabled` no longer blocks Enter, an `inFlight` ref now mirrors `isLoading` synchronously, preserving the no-overlapping-fetch property this review had verified clean.

### F4 — Empty-state comment contradicts the pagination gate

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: `src/components/recipes/recipe-history-panel.tsx:33, 62-65`
- **Detail**: The comment at 63-64 justifies keeping the empty state inside the shell so "a page that has gone empty because rows were removed still needs its Previous button to get back" — but `showPagination = pageData.total > RECIPES_PAGE_SIZE` (line 33) unmounts the whole pagination block in exactly that case: if `total` drops to ≤ 20 while `page > 1`, the user is stranded on an empty page with no way back. The copy is also wrong there ("No recipes yet — approved recipes will appear here" on page 3 of a non-empty history). Currently **unreachable** — no delete-recipe feature exists, so `total` only grows — which is why this is an observation, not a warning. It becomes live the moment delete lands.
- **Fix**: Gate on `showPagination || page > 1`, and vary the empty copy by `page === 1`.
- **Decision**: FIXED (skip reversed on 2026-08-14) — gate is now `pageData.total > RECIPES_PAGE_SIZE || page > 1`, and the empty copy varies by `page === 1`. Fixed despite being unreachable today because the activation condition lives in a future delete-recipe feature, not in this file. **Beyond the suggested fix**: the F3 guard rejects `next > totalPages`, so showing the controls was not enough on its own — from a stranded page 3 with `totalPages` back at 1, Previous → page 2 would have been a no-op. Previous now targets `Math.min(page - 1, totalPages)`, stepping straight back to the last real page.

### F5 — Expired session surfaces as a raw "Unauthorized" toast with no re-auth path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: `src/components/recipes/recipe-history-panel.tsx:39-43`
- **Detail**: When the session expires, `/api/recipes` returns 401 `{"error":"Unauthorized"}`, which the generic `!res.ok` branch renders verbatim via `toast.error`. The user is left on a page they can no longer refresh successfully with no route back to sign-in. This is exact parity with `inventory-panel.tsx` — a pre-existing pattern gap, not a regression introduced here.
- **Fix**: Special-case `res.status === 401` with a redirect to `/auth/signin`; apply to `inventory-panel.tsx` at the same time so the two stay consistent.
- **Decision**: SKIPPED — a fix was applied on 2026-08-14 and then **reverted at the user's request the same day**. No F5 code remains: `inventory-panel.tsx` and `use-recipe-generation.ts` are byte-identical to `2d6cd1f`, and the helper module was deleted. The gap stands as described, at parity with `inventory-panel.tsx`.
- **Findings carried over from the applied-then-reverted attempt** (recorded so a future pass does not re-derive them):
  - **`/auth/signin` already renders a `?error=` query param** (`signin.astro:5` → `<SignInForm serverError={error} />`), so a 401 bounce can explain itself without new page plumbing. There is **no** `?next=` support anywhere — `api/auth/signin.ts:19` always redirects to `/dashboard`, and `middleware.ts:20` to a bare `/auth/signin`. Returning the user to where they were would require building that first.
  - **There are five client fetch surfaces, not two.** Beyond `recipe-history-panel.goToPage` and `inventory-panel`'s `handleAdd`/`handleConfirmDelete`, `use-recipe-generation`'s `generate` and `approve` also 401. Fixing only the two the finding names leaves Generate/Approve on raw "Unauthorized" toasts — the same inconsistency the finding is about.

### F6 — Un-projected `select("*")` and no `Cache-Control` on a per-user GET

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (security)
- **Location**: `src/lib/services/recipe.service.ts:171`, `src/pages/api/recipes/index.ts:37`
- **Detail**: Three latent exposures on one data path, all matching the `products` sibling exactly. (a) `.select("*")` is un-projected, so `user_id` ships in the API JSON *and* is inlined into the server-rendered `astro-island` props in the page HTML; any column added to `recipes` later reaches the browser automatically with no code change. (b) The 200 response sets only `Content-Type` — no `Cache-Control: private, no-store` on a per-user GET. Cloudflare will not edge-cache a cookie-bearing Worker response by default, so this is latent rather than live, but a future cache rule turns it into cross-user leakage. (c) The 500 handler forwards `err.message` verbatim, and `listRecipes` throws `new Error(error.message)` carrying the raw PostgREST/Postgres text — potentially column and constraint names. Because all three are the established repo convention (`products/index.ts:32-33`, `product.service.ts`), fixing them here alone would make this endpoint the odd one out.
- **Fix A ⭐ Recommended**: Log the finding as a repo-wide follow-up covering both `recipes` and `products` — project explicit columns, add `Cache-Control: private, no-store`, and return a generic message on 500 while logging the real one server-side.
  - Strength: Fixes the whole class at once and keeps the two endpoints symmetric, which is the property that made this reviewable in the first place.
  - Tradeoff: Nothing improves today; depends on the follow-up actually being picked up.
  - Confidence: HIGH — the divergence is real but identical in both endpoints, so scope is well understood.
  - Blind spot: Have not checked whether any caller depends on the raw error text for debugging.
- **Fix B**: Harden `/api/recipes` now and leave `products` for later.
  - Strength: Immediate improvement on the newest surface.
  - Tradeoff: Introduces exactly the inconsistency this slice worked to avoid; the next reviewer sees two endpoint shapes with no note explaining why.
  - Confidence: MEDIUM — safe in isolation, but the divergence needs documenting.
  - Blind spot: Column projection must be kept in sync with the `Recipe` type by hand thereafter.
- **Decision**: SKIPPED — Fix A was applied in full on 2026-08-14 and then **reverted at the user's request the same day**. No F6 code remains: `src/types.ts`, both services, and all three API routes are byte-identical to `2d6cd1f`. All three exposures stand as originally described, at parity with the `products` sibling.
- **Findings carried over from the applied-then-reverted attempt** (recorded so a future pass does not re-derive them):
  - **The projection would be compile-time enforced, not advisory.** supabase-js infers the row shape from the `.select()` string literal, so with an explicit column list and a `RecipeView = Omit<Recipe, "user_id">` return type, dropping a column fails typecheck: `Type '{ id: any; ingredients: any; … }[]' is not assignable to type 'RecipeView[]'`. This was verified empirically, not assumed. It makes (a) materially stronger than a comment-based convention.
  - **The original blind spot is real and has a live caller.** `products/[id].ts:26` matches `deleteProduct`'s `"not found"` sentinel to return a 404. It is a sentinel rather than database text, and the comparison runs *before* the 500 branch — so genericizing 500 is safe, but any future pass must keep that ordering or the 404 disappears.
  - `no-console` is `warn` repo-wide; the established pattern for a deliberate server-side log is an inline `// eslint-disable-next-line no-console -- <reason>`, as at `recipe.service.ts:140`.

### F7 — Criterion 2.13's stated repro is wrong and still stands in the plan text

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/recipe-history/plan.md:212`
- **Detail**: Criterion 2.13 reads "With the Supabase env vars unset (forcing `createClient` to return null), `/recipes` shows the load-error line, not the empty state." That repro cannot work: with the env vars unset, `createClient` also returns null in `src/middleware.ts:7`, so `locals.user` is null and `/recipes` redirects to `/auth/signin` before the page renders. The implementer caught this, verified the line by injecting a throw into `listRecipes` for an authenticated user — which is the case the `loadError` divergence actually exists to protect — and documented the correction at `plan.md:313-318`. **The verification is sound and honestly recorded; only the criterion text is stale.** Flagged so the wrong repro is not copied if this plan is used as a reference.
- **Fix**: Reword criterion 2.13 in the Success Criteria block to the repro that was actually used (service throw for an authenticated user), matching the verification note already at `plan.md:313-318`.
- **Decision**: SKIPPED — plan text left as written; the correction is already recorded at `plan.md:313-318` for anyone reading the plan through.

## Triage outcome (2026-08-14)

| Finding | Decision |
|---|---|
| F1 — manual class concatenation | FIXED |
| F2 — dangling `aria-controls` | FIXED (Fix A) |
| F3 — pagination focus / announcement | FIXED |
| F4 — empty-state vs. pagination gate | FIXED (skip reversed) |
| F5 — 401 with no re-auth path | SKIPPED (applied, then reverted) |
| F6 — `select("*")` / `Cache-Control` / raw 500 | SKIPPED (applied, then reverted) |
| F7 — stale criterion 2.13 text | SKIPPED (correction recorded at `plan.md:313-318`) |

Four of seven findings fixed (F1–F4), all of them confined to a single file:

| File | Findings |
|---|---|
| `src/components/recipes/recipe-history-panel.tsx` | F1, F2, F3, F4 |

F5 and F6 were each applied in full and then reverted at the user's request; no code from either remains. Every other file in the repo is byte-identical to `2d6cd1f` — no service, type, API route, or sibling component is touched, and no new module was added. The triage diff is one component file.

Gates re-run after the F5 revert: `npm run typecheck` PASS (44 files, 0 errors, 0 warnings, 4 pre-existing hints), `npm run lint` PASS (0 errors, 0 warnings), `npm run build` PASS (server built in 4.39s, only the pre-existing sitemap `site` warning).

**Re-test scope**: the inventory page is *not* in scope — after the F5 and F6 reverts nothing outside `recipe-history-panel.tsx` changed. The manual criteria in `plan.md` were verified against the pre-triage code, and the four applied fixes were not re-driven in a browser.

**Follow-up for whoever re-tests**: criterion 2.8 reads "both buttons disable at their respective ends". F3 changed `disabled` to `aria-disabled` plus `aria-disabled:pointer-events-none aria-disabled:opacity-50`, so the buttons still dim and reject clicks at the ends but are now focusable — the criterion still holds behaviourally, via a different mechanism. Worth a re-click of 2.7/2.8 since those were the browser-verified rows.

## Manual-criteria audit

All 13 manual rows are checked `[x]` and, unusually, carry real evidence rather than assertion — `plan.md:297-318` records verification against local Supabase with three seeded users (25 / 1 / 0 recipes, one with empty `consumed_products`), and rows 2.7 and 2.9 were driven with actual clicks in headless Chrome over the DevTools protocol with hydration confirmed first. No rubber-stamping detected. The only discrepancy is F7, which the implementer surfaced themselves.
