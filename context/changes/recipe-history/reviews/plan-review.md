<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Recipe History (S-03 / FR-010)

- **Plan**: `context/changes/recipe-history/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-11
- **Verdict**: REVISE → **SOUND after triage** (5 fixed, 1 skipped — see Triage below)
- **Findings**: 1 critical, 5 warnings, 0 observations

## Verdicts

| Dimension             | At review | After triage                |
| --------------------- | --------- | --------------------------- |
| End-State Alignment   | PASS      | PASS                        |
| Lean Execution        | WARNING   | PASS (F2 decided + recorded) |
| Architectural Fitness | FAIL      | PASS (F1 fixed)             |
| Blind Spots           | WARNING   | PASS (F3, F4 fixed)         |
| Plan Completeness     | WARNING   | WARNING (F5 fixed, F6 skipped) |

## Triage

Completed 2026-08-11. Fixed: F1 (Fix A), F2 (Fix B), F3, F4, F5. Skipped: F6.

All fixes are applied to `plan.md`; the Progress↔Phase contract was re-verified afterwards (1 block, both phases, 21 items = 8 + 13, no stray checkboxes).

## Grounding

11/11 paths ✓, 9/9 symbols ✓, brief↔plan ✓. Progress↔Phase contract ✓ (one `## Progress` block, both phases present, 5+3 and 4+8 criteria mapped, no stray checkboxes in phase bodies).

Verified accurate against source: `instructions` is newline-joined TEXT (`src/lib/services/recipe.service.ts:172`); `consumed_products` is a NOT NULL one-way snapshot COALESCEd to `'[]'` (`supabase/migrations/20260607120000_approve_recipe.sql:13-20`); `recipes_user_created_idx` covers both filter and sort (`supabase/migrations/20260531120000_initial_schema.sql:62`); no migration needed.

## Findings

### F1 — Client island imports a server-only module

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 (constant placement) + Phase 2 §3 (island)
- **Detail**: Phase 1 puts `RECIPES_PAGE_SIZE` in `recipe.service.ts` and says "import it where needed"; Phase 2 has `recipe-history-panel.tsx` — a `client:load` island — use it for Prev/Next visibility and `Math.ceil(total / RECIPES_PAGE_SIZE)`. But `recipe.service.ts:3` imports `OPENROUTER_API_KEY` from `astro:env/server`, and Astro throws `ServerOnlyModule` ("The astro:env/server module is only available server-side") whenever that virtual module is loaded in the client environment — `node_modules/astro/dist/env/vite-plugin-env.js:65-70`. The key is declared `access: "secret"` in `astro.config.mjs:21`, so this boundary is also what keeps the OpenRouter key out of the client bundle. The build breaks the moment the island imports the constant. Every current importer of `recipe.service.ts` is a server file (`api/recipes/{generate,approve}.ts`) — this plan is the first to cross the line.
- **Fix A ⭐ Recommended**: Put `RECIPES_PAGE_SIZE` in `src/types.ts` next to `RecipePage`.
  - Strength: `types.ts` has zero runtime imports, so it is already safe for both environments; one-line move, no API change, the service still owns the query that consumes it.
  - Tradeoff: A runtime constant lives in a file otherwise holding only types.
  - Confidence: HIGH — guard verified in Astro's own source; `types.ts` read and confirmed import-free.
  - Blind spot: None significant.
- **Fix B**: Return `totalPages` (or `pageSize`) in the `RecipePage` payload.
  - Strength: The island never needs the constant at all; page-size changes cannot desync client and server.
  - Tradeoff: Widens the API contract for a value the client could derive; the SSR path must compute it too.
  - Confidence: HIGH — trivially correct, just more surface.
  - Blind spot: None significant.
- **Decision**: FIXED — via Fix A. `RECIPES_PAGE_SIZE` now lives in `src/types.ts` (Phase 1 §1, with the `astro:env/server` rationale recorded); Phase 1 §2 imports it from `@/types`.

### F2 — Whole GET endpoint exists only because paging state avoids the URL

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Lean Execution
- **Location**: Implementation Approach; Phase 1 §3; Phase 2 §3
- **Detail**: Page 1 is server-rendered. The only reason `src/pages/api/recipes/index.ts`, its zod validator, and the island's fetch + loading flag + error state + toast path exist is the decision to keep the page number in React state instead of the URL (brief, "Page state location"). If Prev/Next were `<a href="/recipes?page=N">` and `recipes.astro` read `Astro.url.searchParams`, Phase 1 collapses to just `listRecipes` and the island loses its entire async layer. Expansion — the only other interaction — is achievable with `<details name="recipe">`, which gives single-expand accordion behavior natively. That variant also dissolves F1 (no client import of the constant) and F4 (no hydration boundary around the date), softens F5, and adds deep-linking plus working browser back/forward, which the current design explicitly cannot do.
- **Fix A ⭐ Recommended**: URL-driven paging, SSR-only page.
  - Strength: Deletes an endpoint, a validator, and three pieces of client state; the page becomes linkable and back-button-correct.
  - Tradeoff: Full page load per page turn; departs from the `InventoryPanel` island precedent this repo has used for every interactive surface so far.
  - Confidence: MED — mechanically sound in `output: "server"` mode, but `<details name>` accordion styling has not been prototyped against the existing `bg-cosmic` treatment.
  - Blind spot: Whether a non-React page is acceptable given the codebase's island convention — a taste call.
- **Fix B**: Keep the island; record the endpoint's cost as a deliberate consistency choice in the plan.
  - Strength: Zero rework; stays inside the pattern every reviewer of this repo already knows.
  - Tradeoff: Pays an endpoint plus a client fetch layer for one feature no other surface consumes.
  - Confidence: HIGH — the plan as written works, modulo F1.
  - Blind spot: None significant.
- **Decision**: FIXED — via Fix B. Island and endpoint kept; Implementation Approach now records why the endpoint exists, what the leaner alternative would have removed, and the accepted consequences (no bookmarkable pages, no Back-button paging).

### F3 — SSR read failure renders as "you have no recipes"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 (page) and §3 (empty state)
- **Detail**: Phase 2 §2 says the SSR call is wrapped in a try/catch "degrading to an empty page", copying `inventory.astro:14-16`. Phase 2 §3 then renders an empty `recipes` array as "approved recipes will appear here". Composed, a transient Supabase failure tells the user their entire recipe history is gone. This is worse than the inventory case it copies: a missing product is re-addable in seconds, whereas history is the only record of something the user cannot reconstruct — `consumed_products` is a one-way snapshot, as the plan itself notes.
- **Fix**: Pass a `loadError` flag alongside `initialPage` and have the island render a "couldn't load your recipes — try again" state distinct from the empty state. Add a Phase 2 manual criterion covering it.
- **Decision**: FIXED — Phase 2 §2 now sets `loadError` instead of degrading silently (with the reason it diverges from `inventory.astro`), §3 takes it as a prop and gives it precedence over the empty state, and criterion 2.13 covers it.

### F4 — Date rendering unspecified; locale formatting will mismatch on hydration

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3; success criterion 2.5 ("correct dates")
- **Detail**: The plan asks for "a human-readable `created_at` date" without saying how. `client:load` means Astro server-renders the island first, so a bare `toLocaleDateString()` runs once on Cloudflare (UTC, ICU default locale) and again in the user's browser (their locale and timezone) — a React hydration mismatch, and for a `TIMESTAMPTZ` near midnight, two different calendar days. There is no precedent to copy: `inventory-panel.tsx` prints the raw `expiry_date` string and grep finds no `toLocale*` anywhere in `src/`.
- **Fix**: Specify the exact formatting — an explicit locale and `timeZone` (e.g. `toLocaleDateString("en-GB", { timeZone: "UTC" })`), or slice the ISO date server-side — so server and client output are byte-identical.
- **Decision**: FIXED — Phase 2 §3 now pins the exact call (`"en-GB"`, `timeZone: "UTC"`, explicit day/month/year) and records why a bare `toLocaleDateString()` breaks under `client:load`.

### F5 — `page` validator under-specified in two places

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3
- **Detail**: Two gaps. (a) "optional, coerced to an integer, minimum 1, defaulting to 1" — `searchParams.get("page")` returns `null` when the param is absent, and zod 4's coerce runs `Number(null) === 0`, which fails `min(1)`. Written literally, the plain `GET /api/recipes` returns 400, contradicting criterion 1.6. The parse input has to be normalized (`?? undefined`, or `Object.fromEntries(searchParams)`). (b) "Cap `page` at a sane upper bound" names neither the bound nor the response for exceeding it (400 vs. clamp).
- **Fix**: State the exact schema and the null-to-undefined normalization, and name the cap and its failure response — e.g. max 1000 → 400.
- **Decision**: FIXED — Phase 1 §3 now carries the literal zod schema, the `?? undefined` normalization with the reason, and `max(1000)` rejecting with 400 rather than clamping.

### F6 — Three "Automated Verification" items have no automation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criteria 1.4–1.5; Phase 2 criterion 2.4
- **Detail**: "GET /api/recipes returns 401 without a session cookie", "?page=0 and ?page=abc return 400", and "signed out, GET /recipes redirects" sit under Automated Verification, but the plan's own Testing Strategy states automated verification is `typecheck` / `lint` / `build` only — there is no test runner. `/10x-implement` will reach these steps with no command to run.
- **Fix**: Give each one a runnable command against `npm run dev` (e.g. `curl -s -o /dev/null -w '%{http_code}' localhost:4321/api/recipes`) rather than moving them to Manual — that keeps the Progress step numbering intact.
- **Decision**: SKIPPED — criteria 1.4, 1.5 and 2.4 stay as written; whoever runs them supplies the command.
