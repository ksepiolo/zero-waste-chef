<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Recipe Generation Loop

- **Plan**: `context/changes/recipe-generation-loop/plan.md`
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-08-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | FAIL    |

## Summary

All 12 planned changes are implemented, no MISSING items, and every "What We're NOT Doing" guardrail held (verified: no recipes page route, no `stream: true`, no `/recipe/approve` page, no generated DB types, no retry loop, no ingredients filter UI). The three deviations recorded in `change.md` — free Gemma model, `.overrideTypes<string>()`, and the `excludeTitles` variety feature — are each implemented as described.

Automated checks run during this review: `npm run lint` → 0 errors; `npx astro check` → 0 errors, 0 warnings, 4 hints (all pre-existing, in `eslint.config.js`).

Not verified: Progress 1.3 (`npx supabase db reset` exits 0) — running it would wipe the local database, so it was left alone. It is recorded as passing against commit `ae2edeb`.

Deliberately not filed as findings (both plan-sanctioned):

- Partial-snapshot semantics in `approve_recipe` — a stale product id is silently skipped by both the SELECT and the DELETE, and `inventory-panel.tsx:31` optimistically removes all requested ids regardless. Pre-accepted verbatim under *What We're NOT Doing* (`plan.md:44`) as a V1 known limitation.
- `generate()` clearing the recipe before the request fires (`use-recipe-generation.ts:18`), destroying the visible recipe if a regenerate fails — `plan.md:315` specifies exactly this ordering.

## Findings

### F1 — `npm run typecheck` script does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `package.json:5` · `plan.md:511,526,543`
- **Detail**: Progress items 1.1, 2.1 and 3.1 are all marked `- [x] npm run typecheck passes` with commit shas. The script does not exist — `npm run typecheck` exits with "Missing script: typecheck". Three automated checkboxes across three phases record a command that never ran. The substantive condition does hold: the real equivalent, `npx astro check`, returns 0 errors, 0 warnings, 4 pre-existing hints.
- **Fix**: Add `"typecheck": "astro check"` to package.json scripts so the plan's command resolves, and re-run it to legitimately confirm the three checkboxes.
- **Decision**: FIXED — `"typecheck": "astro check"` added at `package.json:6`; `npm run typecheck` now runs and reports 0 errors, 0 warnings, 4 pre-existing hints.

### F2 — OpenRouter fetch has no timeout or abort signal

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/recipe.service.ts:89`
- **Detail**: A single bare `await fetch(...)` with no `signal`. If OpenRouter hangs, the request never settles, the hook's `finally { setIsGenerating(false) }` never runs, and the user is left on a permanent spinner with no way back. Not hypothetical: `change.md` records a real 27 s generation on the free tier, well past the plan's 5–15 s estimate, and the free tier is explicitly rate-limited. The plan's stated mitigation does not cover it — `limits.cpu_ms: 5000` bounds CPU time, and Workers excludes time blocked on fetch I/O from CPU accounting, so a slow upstream is unaffected.
- **Fix**: Pass `signal: AbortSignal.timeout(30_000)` to the fetch and map the resulting AbortError to a distinct message ("Recipe generation timed out — try again").
  - Strength: Guarantees the hook's finally block always runs, so the button always re-enables; 30 s clears the observed 27 s worst case.
  - Tradeoff: A legitimate slow generation past 30 s now fails where it previously would have eventually succeeded.
  - Confidence: HIGH — `AbortSignal.timeout` is supported on the Workers runtime, and the failure mode is reachable today.
  - Blind spot: The exact free-tier queueing ceiling is unmeasured; 30 s is a judgement call, not a measured bound.
- **Decision**: FIXED — `GENERATION_TIMEOUT_MS = 30_000` constant added; the fetch now passes `signal: AbortSignal.timeout(...)` and is wrapped in try/catch mapping `TimeoutError`/`AbortError` to "Recipe generation timed out — try again".

### F3 — Known plaintext credential seeded into a remote-linked project

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/seed.sql:1,30`
- **Detail**: `crypt('Test1234!', gen_salt('bf'))` for `test@example.com` at fixed uuid `…0001`, with `email_confirmed_at = now()` — a pre-confirmed account whose password is committed in a comment on line 1. Fine for a local-only seed, except this repo is linked to a hosted project (`supabase/.temp/linked-project.json` and `project-ref` both exist), so `supabase db reset --linked` would create this confirmed, known-password account in the remote database. The file has no guard against that. `ON CONFLICT DO NOTHING` is correctly present.
- **Fix A ⭐ Recommended**: Add a `-- LOCAL ONLY` header plus a guard that aborts unless the DB is the local instance (e.g. check `current_setting('app.settings.jwt_secret', true)` matches the local dev secret, or gate on `inet_server_port() = 54322`).
  - Strength: Keeps the fixed-uuid seed that makes `db reset` a one-command working login — the point of the out-of-plan fix documented in change.md.
  - Tradeoff: The guard is heuristic; a future local port change silently disables the seed.
  - Confidence: MEDIUM — the mechanism works, but the exact local discriminator to key on needs one round of testing.
  - Blind spot: Haven't confirmed whether anyone has already run `db reset --linked` against the hosted project.
- **Fix B**: Read the password from a `SEED_TEST_PASSWORD` psql variable with no default, so the seed fails loudly when unset.
  - Strength: Removes the credential from git history going forward.
  - Tradeoff: Breaks the frictionless `npx supabase db reset` loop the seed exists to provide; the password is already in history regardless.
  - Confidence: MEDIUM — supabase CLI's psql variable passthrough for seed files is unverified.
  - Blind spot: Unknown whether the CLI's seed runner supports `:'var'` substitution at all.
- **Decision**: FIXED via Fix A — `-- LOCAL ONLY` header plus a `DO $$ … RAISE EXCEPTION` guard at the top of seed.sql. The discriminator is not the port heuristic the review proposed: probing the running local DB showed `app.settings.jwt_secret` holds the fixed public dev value `super-secret-jwt-token-with-at-least-32-characters-long`, which a hosted project never has. Guard verified to pass against the local instance.

### F4 — Supabase CLI scratch artifacts committed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `supabase/.branches/_current_branch` · `supabase/snippets/Untitled query 685.sql`
- **Detail**: Two local CLI artifacts are tracked (`git ls-files supabase/` confirms). `_current_branch` contains `main` — CLI state, not source. The snippet is `SELECT id, email, created_at FROM auth.users;`, scratch work from the seed debugging. `.gitignore:16` covers `supabase/.temp/*` but neither of these directories. No secrets leaked; it's history noise.
- **Fix**: `git rm --cached` both, and add `supabase/.branches/` and `supabase/snippets/` to `.gitignore`.
- **Decision**: FIXED — both untracked via `git rm --cached`; `supabase/.branches/` and `supabase/snippets/` added to `.gitignore`. Files remain on disk for local CLI use.

### F5 — Raw OpenRouter response body surfaced to the browser

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/recipes/generate.ts:48` · `src/lib/services/recipe.service.ts:114`
- **Detail**: The service throws `` `OpenRouter ${response.status}: ${text}` `` where `text` is the entire upstream body, and the route relays `err.message` verbatim as the 500 payload. The hook re-throws it and `inventory-panel.tsx:39` renders it in `toast.error`. On 401/402/429 OpenRouter returns account and quota metadata about the shared server key — displayed in a toast to any authenticated user.
- **Fix**: `console.error` the detailed message server-side and return a fixed "Recipe generation failed" from the catch in `generate.ts`.
- **Decision**: FIXED (fixed differently — status → friendly text). The full upstream body is now `console.error`-logged in the service and never relayed; a new `openRouterErrorMessage(status)` helper maps 401/402 → "Recipe service unavailable — try again later", 429 → "Rate limited — try again shortly", else "Recipe generation failed". Mapping lives in the service, which already owns OpenRouter semantics, so `generate.ts` keeps relaying `err.message` — now safe. The `console.error` carries a targeted `eslint-disable-next-line no-console` since the project sets `no-console: warn`.

### F6 — Unbounded LLM cost surface on a shared API key

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/recipes/generate.ts:12` · `src/lib/services/recipe.service.ts:82`
- **Detail**: `excludeTitles: z.array(z.string()).max(20)` caps the array length but not each element, so a client can post 20 arbitrarily long strings that are interpolated straight into the user turn (`recipe.service.ts:86`). Separately, `productList` (line 82) is built from the entire at-risk inventory with no cap. There is no rate limit or in-flight guard on the endpoint, so an authenticated user can loop it. All spend lands on one shared `OPENROUTER_API_KEY` with no per-user attribution. Blast radius is contained on the output side — the UUID cross-check at lines 127-130 is a genuinely good guardrail and holds regardless of prompt content — so this is a spend and jailbreak-surface issue, not a data integrity one.
- **Fix A ⭐ Recommended**: Bound the inputs — `z.array(z.string().max(120)).max(10)` on `excludeTitles`, and `atRiskProducts.slice(0, 25)` before building `productList`.
  - Strength: Two-line change, no new infrastructure, caps per-request token spend to a known ceiling.
  - Tradeoff: Doesn't stop a request loop — only bounds each request.
  - Confidence: HIGH — purely local, nothing else reads these values.
  - Blind spot: 25 products is a guess at a sane inventory ceiling.
- **Fix B**: Add a per-user throttle before the LLM call (Cloudflare Rate Limiting binding, or a `last_generated_at` column check).
  - Strength: Addresses the actual abuse vector — request volume.
  - Tradeoff: New binding or new migration; more moving parts than this MVP currently carries.
  - Confidence: MEDIUM — a rate-limit binding needs wrangler.jsonc work and behaves differently in local dev.
  - Blind spot: Haven't checked the deployment plan's Workers tier; rate-limiting bindings have their own availability rules.
- **Decision**: FIXED via Fix A — `excludeTitles` is now `z.array(z.string().max(120)).max(10)`, and a `MAX_PROMPT_PRODUCTS = 25` slice bounds the prompt inventory. The slice is taken once into `promptProducts` and reused for the UUID cross-check, so the guardrail stays consistent with what the model was actually shown. One change beyond the stated fix was required: `seenTitles` in the hook grows unbounded and is sent on every call, so tightening the cap from 20 to 10 would have made an 11th generation in one session fail validation — the hook now sends `seenTitles.slice(-10)`. Verified: a 200-char title now returns 400 "Too big: expected string to have <=120 characters".

### F7 — "Generate Different Recipe" is undisabled and self-closing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/inventory/inventory-panel.tsx:267`
- **Detail**: `<AlertDialogAction onClick={() => void handleGenerate()}>` carries no `disabled` prop, unlike its sibling Generate button at line 197 which has `disabled={isGenerating || isApproving}`. Radix's `AlertDialogAction` also auto-closes, firing `onOpenChange(false)` → `reset()` while the generate is in flight — so the modal vanishes and the only progress signal is the panel button behind it. A double-click issues two billable LLM calls. The plan's snippet (`plan.md:413`) has the same omission, so this is a plan-level gap rather than implementation drift.
- **Fix**: Add `disabled={isGenerating || isApproving}` to the `AlertDialogAction` at line 267.
- **Decision**: FIXED — `disabled={isGenerating || isApproving}` added, matching the sibling Generate button. The auto-close-on-click behaviour was left as the plan intended.

### F8 — Approve endpoint holds DB logic inline, bypassing the service layer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/pages/api/recipes/approve.ts:36-44`
- **Detail**: `supabase.rpc("approve_recipe", ...)` is called directly in the route body. Every other data-touching route delegates: `products/index.ts` calls `listProducts`/`createProduct`, `[id].ts` calls `deleteProduct`. The error convention diverges too — those routes wrap the service call in try/catch and map sentinels (`"not found"` → 404), while approve returns a flat 500 for every RPC error including RLS denials. The plan specified this shape (`plan.md` §2.3), so it's a plan-level layering choice, not drift. Related: the route validates `context.locals.user` at line 19 then discards the id, leaning wholly on `auth.uid()` inside the function — the plan reasoned about this explicitly (`plan.md:499`) and accepted it.
- **Fix A ⭐ Recommended**: Extract `approveRecipe(supabase, input)` into `recipe.service.ts` and call it from the route inside try/catch.
  - Strength: Restores the one-pattern-per-layer property the rest of `src/pages/api/` has; gives the RPC error mapping a home.
  - Tradeoff: Touches a phase that is already verified and committed.
  - Confidence: HIGH — mechanical move, mirrors `products/[id].ts` exactly.
  - Blind spot: None significant.
- **Fix B**: Leave as-is and record the exception in CLAUDE.md.
  - Strength: Zero risk to working code; one RPC call is thin enough that a service wrapper is nearly pass-through.
  - Tradeoff: Next endpoint author has two conflicting precedents.
  - Confidence: MEDIUM — depends on whether more RPCs are coming.
  - Blind spot: The roadmap's later slices may add RPCs that would compound the inconsistency.
- **Decision**: FIXED via Fix A — `approveRecipe(supabase, input)` extracted into `recipe.service.ts`; the route now calls it inside try/catch, matching `products/[id].ts`. `ApproveRecipeInput` added to `src/types.ts` per the shared-DTO convention. `userId` was deliberately not added to the signature: F9 was skipped, so there is no `p_user_id` parameter to pass it to and an unused argument would be dead weight.
  - **Surfaced a latent typing defect**: moving the call into a function with a declared `Promise<string>` return exposed that `.overrideTypes<string>()` never actually produced `string` — it resolves to `string | { Error: "Cannot cast array result to a single object…" }`, because with no generated Database types supabase-js infers an array shape for the RPC. The route had simply passed the value to `JSON.stringify`, so nothing type-checked it. Confirmed against the postgrest-js docs that `{ merge: false }` does not help (the brand is emitted by the cast check that runs before merging), and `.single()` would change the runtime request. Resolved by keeping the request identical and narrowing with a commented cast.
  - Verified end-to-end against the local stack: approve returned 200 with a uuid, the `recipes` row carried the ingredients array, `\n`-joined instructions and a correct `consumed_products` snapshot, and both referenced products were deleted. Smoke data removed afterwards.

### F9 — `approve_recipe` lacks search_path pinning and an anon guard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260607120000_approve_recipe.sql:8,31`
- **Detail**: Three hardening gaps, none currently exploitable. (a) No `SET search_path`, and tables are unqualified (`FROM products`, `INSERT INTO recipes`) while `auth.uid()` is qualified. Not an escalation vector under `SECURITY INVOKER` — a manipulated path would only redirect the caller to their own objects, with RLS still applied as the caller — but Supabase's `function_search_path_mutable` linter will flag it. (b) `GRANT EXECUTE … TO authenticated` (line 31) reads as a restriction but isn't one: Postgres grants EXECUTE to PUBLIC by default on new functions and Supabase doesn't revoke it, so `anon` can reach the RPC. It fails safely — `auth.uid()` is NULL, so the INSERT violates `recipes.user_id NOT NULL`, the transaction aborts, and the DELETE never runs — but the caller gets an opaque 500. (c) Choosing `SECURITY INVOKER` was the right call and is why (a) is benign; RLS stays in force behind the `auth.uid()` predicates.
- **Fix**: Add a follow-up migration (do not edit the applied one) with `CREATE OR REPLACE` adding `SET search_path = public, pg_temp`, schema-qualified table names, an opening `IF auth.uid() IS NULL THEN RAISE EXCEPTION … ERRCODE '28000'`, and `REVOKE EXECUTE … FROM PUBLIC, anon;`.
- **Decision**: SKIPPED — none of the three gaps is currently exploitable and the anon path already fails closed. Worth revisiting if the Supabase linter flags `function_search_path_mutable` before production.

### F10 — Silent no-ops on malformed request/response edges

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/recipes/generate.ts:26-29` · `src/components/hooks/use-recipe-generation.ts:32` · `src/pages/api/recipes/approve.ts:50`
- **Detail**: Three instances of the same shape — an invalid edge produces silence rather than an error. (1) `generate.ts:27` discards `parsed` when `safeParse` fails, so a body that is present but invalid is treated as an empty body; every other route does `if (!result.success) return 400` with `result.error.issues[0]?.message` (`products/index.ts:53-57`). The "no body" case is legitimate; "body present and invalid" is not. (2) `use-recipe-generation.ts:32` — a 200 response missing `recipe` calls `setRecipe(undefined)`: no modal, no toast, no throw; the user clicks Generate and nothing happens. (3) `approve.ts:50` — `data` is never null-checked, so a null RPC return yields 200 `{"id":null}`.
- **Fix**: 400 on present-but-invalid body in `generate.ts`; throw in the hook when `json.recipe` is absent; 500 in `approve.ts` when `data` is null.
- **Decision**: FIXED — all three. (1) `generate.ts` now separates "no body at all" (caught → `{}`) from validation, and returns 400 with `parsed.error.issues[0]?.message` like every other route. (2) The hook throws "Failed to generate recipe" when `json.recipe` is absent instead of calling `setRecipe(undefined)`. (3) The null-data check moved into `approveRecipe()` as `throw new Error("Recipe was not saved")`, which the route's catch turns into a 500. Verified: an invalid `excludeTitles` body now returns 400 "Invalid input: expected string, received number" where it was previously ignored.
