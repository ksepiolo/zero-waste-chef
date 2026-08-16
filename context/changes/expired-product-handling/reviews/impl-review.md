<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Expired-product handling and the generation error contract

- **Plan**: `context/changes/expired-product-handling/plan.md`
- **Scope**: All 6 phases (full plan)
- **Date**: 2026-08-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Every planned item was implemented; nothing is MISSING and no "What We're NOT Doing"
guardrail was violated (no migration, no creation-time rejection, no UI tests, approve
path untouched, no retry logic). All automated success criteria were re-run and pass:
104/104 tests, `astro check` 0 errors, `eslint` clean, `npm run build` complete. The
mutation artefact (`reports/mutation/mutation.html`) is timestamped 16:12 against the
Phase 5 commit at 16:13, so criterion 5.5 has real evidence. Criterion 5.7 was closed by
automated coverage rather than by hand, and that substitution is disclosed in the commit
message, in `test-plan.md` §6.5, and was reviewed here — it is not rubber-stamping.

## Findings

### F1 — Timeout and body-read failures escape the typed-error net

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/recipe.service.ts:148,156
- **Detail**: Both provider body reads sit _outside_ the `try` that ends at line 145.
  `AbortSignal.timeout(GENERATION_TIMEOUT_MS)` (line 116) is attached to the `fetch` and,
  per the Fetch spec, stays live while the body is consumed. So a 30s timeout that fires
  _after_ response headers arrive rejects at line 156, not at line 136 — bypassing the
  `TimeoutError`/`AbortError` handler at 138-139 and falling through to the endpoint's
  generic 500 at `generate.ts:100` instead of the 504 the contract defines. The same
  applies to a 200 whose body is not JSON (CDN HTML page, truncated stream): a raw
  `SyntaxError` at line 156 answers 500 rather than 502 `unusable_model_response`. Not a
  leak — the generic copy holds — but it defeats the "each failure class answers with its
  own status" property this change exists to establish, in precisely the slow-free-tier
  scenario the timeout was added for (line 114 notes 27s queueing observed). It also
  poisons the `console.error("Unhandled error…")` signal, which is meant to flag genuine
  defects.
- **Fix**: Wrap lines 148 and 156 in a `try/catch` mapping `TimeoutError`/`AbortError` to
  `ServiceError("timeout")` and anything else to `ServiceError("unusable_model_response",
{ cause: err })`.
  - Strength: Closes the last two unclassified paths on the provider boundary, so the
    class→status map becomes total rather than nearly-total; reuses the exact pattern
    already at lines 166-176.
  - Tradeoff: Adds a second timeout check in a function that already has one; the two must
    stay in sync if the classes are ever renamed.
  - Confidence: HIGH — the abort-during-body-read behaviour is specified, and the missing
    coverage is visible from the brace positions alone.
  - Blind spot: Not reproduced against a live slow provider; the stubbed test seam resolves
    bodies instantly, so no existing test exercises this window.
- **Decision**: FIXED — both body reads now route failures through a shared `bodyReadError`
  helper (`recipe.service.ts:71-86`), which maps `TimeoutError`/`AbortError` to
  `ServiceError("timeout")` and everything else to `unusable_model_response` with a
  `console.error`. Routing both through one helper also removes the drift risk the tradeoff
  named. 104/104 tests, `astro check` 0 errors, `eslint` clean.

### F2 — The client hook re-opens the toast channel the server just closed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/use-recipe-generation.ts:35
- **Detail**: `await res.json()` runs _before_ the `res.ok` check, so any non-JSON error
  response throws a `SyntaxError` whose message quotes the offending body prefix. It
  propagates past the `finally` to `inventory-panel.tsx:87`, which toasts `err.message`
  verbatim. Non-JSON responses are reachable: `src/middleware.ts` calls
  `supabase.auth.getUser()` uncaught, so a transport failure yields Astro's HTML 500 page,
  and on Cloudflare a worker resource limit returns an HTML 1102 page. The plan's Desired
  End State says "no `ZodError`, `SyntaxError`, or PostgREST text can reach a toast" — that
  now holds on the server, but the last hop can still manufacture a `SyntaxError` toast of
  its own.
- **Fix**: Branch on `res.ok` first, and read the body via `await res.text()` + `JSON.parse`
  inside a try that falls back to the hard-coded copy.
- **Decision**: FIXED — added an `errorMessage(res, fallback)` helper that runs only on the
  `!res.ok` branch and swallows a parse failure into the hard-coded copy. Applied at both
  call sites: `generate` (line 35) and `approve` (line 84), which carried the identical bug
  onto the same toast channel via `inventory-panel.tsx:95`.

### F3 — The typed-error convention is half-migrated across the app

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: src/lib/services/recipe.service.ts:216,236
- **Detail**: The plan's load-bearing claim is that "hygiene comes from the allowlist being
  a _type_, not from remembering to sanitise". That property is real but **local to
  `/api/recipes/generate`**. Five sibling sites still echo arbitrary `err.message`:
  `api/products/index.ts:32,66`, `api/products/[id].ts:25`, `api/recipes/index.ts:42`,
  `api/recipes/approve.ts:44`. And `recipe.service.ts:216` (`listRecipes`) and `:236`
  (`approveRecipe`) still `throw new Error(error.message)` with raw PostgREST text — the
  exact leak Phase 5 closed in `product.service.ts`. The approve chain is live end-to-end:
  `approveRecipe` → `approve.ts:44` → `use-recipe-generation.ts:86` →
  `inventory-panel.tsx:95` `toast.error`, so an RLS misconfiguration surfaces
  `permission denied for table "recipes" (policy recipes_insert_own)` as a user toast. The
  `/api/products` routes are covered only _by accident_ — a `ServiceError`'s message
  happens to be safe copy — so the next bare `Error` added to `product.service.ts` leaks
  again with no test catching it. Related: `[id].ts:26` matches `message === "not found"`
  as a string, which `product.service.ts:92` deliberately preserves; that coupling is now
  the only reason the 404 works.
- **Fix A ⭐ Recommended**: Convert the two `recipe.service.ts` datastore throws to
  `ServiceError("data_access", { cause: error })` with the `console.error` the product
  service already uses, and apply the `instanceof ServiceError` allowlist from
  `generate.ts:94-100` to all five endpoints.
  - Strength: Makes the structural guarantee actually structural and app-wide; the plan
    already established the pattern and the copy, so this is mechanical propagation rather
    than new design. Closes a live PostgREST→toast path on the approve chain.
  - Tradeoff: Touches the approve path, which the plan explicitly deferred ("`approve_recipe`
    set identity is Risk #5, rollout Phase 2"), and those routes have no test coverage yet,
    so the conversion lands unverified.
  - Confidence: MEDIUM — the leak is verified by reading the chain, but rollout Phase 2 is
    the change that will add the tests, and doing it now means editing those files twice.
  - Blind spot: Whether `recipes/index.ts`'s consumer relies on the raw message;
    `recipe-history-panel.tsx:62` uses its own copy, but no other consumer was audited.
- **Fix B**: Leave the code and record the leak as explicit scope for rollout Phase 2,
  amending `test-plan.md` §3 row 2 to name it.
  - Strength: Honours the plan's own deferral, and lands the fix alongside the tests that
    would prove it rather than ahead of them.
  - Tradeoff: A known PostgREST→toast path stays live in the meantime, and the plan's §6.5
    note currently reads as though hygiene is settled.
  - Confidence: MEDIUM — safe, but depends on Phase 2 actually picking it up.
  - Blind spot: No estimate of how long Phase 2 is away.
- **Decision**: SKIPPED — left as-is for now; neither the code conversion nor a test-plan
  amendment was made. The PostgREST→toast path on the approve chain remains live and
  unrecorded outside this report.

### F4 — `classifyExpiry` reads the clock three times, so mutual exclusion is not structural

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/product.service.ts:33-35
- **Detail**: The boundary arithmetic is correct and genuinely UTC-safe (−1 expired, 0 and
  +3 at-risk, +4 neither; `getUTCDate`/`setUTCDate` throughout, no local/UTC mix). But
  `classifyExpiry` calls `isAtRisk` (two `new Date()` reads) then `isExpired` (a third). If
  UTC midnight lands between them, a product expiring on the day that just ended returns
  `is_at_risk: true` **and** `is_expired: true`. That contradicts the plan's own Critical
  Implementation Detail — "mutually exclusive by construction only if both come from the
  same call" — and two consumers depend on it: `inventory-panel.tsx:220-225` renders both
  badges with no precedence logic, and `generate.ts:66-71` partitions on `is_expired`
  alone. In `listProducts`' map, different rows in one response can also be classified
  against different "today" values. `product.service.test.ts` cannot catch this — the
  mutual-exclusivity `it.each` runs under `vi.setSystemTime`, a frozen clock. The window is
  microseconds per day, so the practical risk is negligible; the point is that the
  invariant is currently a property of timing rather than of the code.
- **Fix**: Compute `today` and the `AT_RISK_DAYS` horizon once inside `classifyExpiry` and
  thread both into the predicates, keeping the exported `isAtRisk`/`isExpired` as thin
  wrappers so existing tests are untouched. Also removes 3 `Date` allocations per row.
- **Decision**: FIXED — `classifyExpiry` reads `new Date()` once and threads `today` and the
  horizon into both predicates. `utcDateOffset`, `isExpired` and `isAtRisk` took optional
  parameters defaulting to a fresh read, so every existing caller and test is unchanged.
  Exclusivity is now structural rather than a property of timing.

### F5 — Prettier corrupted pre-existing Phase 1 prose in `test-plan.md` §6.5

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/test-plan.md:310,314
- **Detail**: While appending the Phase 1b note, formatting rewrote Phase 1 text this change
  had no reason to edit: `json_schema` → `json*schema` (line 310) and `_message_` →
  `\_message*` (line 314). Markdown emphasis parsing paired the underscores across the
  bullet. Both now render as stray asterisks. `prettier --check` reports the file as clean,
  so re-running the formatter will not undo it — the corrupted form is now the stable one.
- **Fix**: Wrap both in backticks (`` `json_schema` ``, `` `message` ``) so the formatter
  leaves them alone, restoring the original wording.
- **Decision**: FIXED — both restored as inline code, so the underscores are inert to
  Markdown emphasis parsing and the formatter cannot re-corrupt them.

### F6 — `ServiceError` constructor has no runtime guard on the table lookup

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/service-error.ts:53
- **Detail**: The `Record<ServiceErrorKind, …>` table is exhaustive and type-safe — a kind
  cannot compile with a status but no message, which is exactly the shape the plan set out
  to prevent, and no untyped error can reach the client with its own text. One residual
  edge: `CONTRACT[kind].message` is unguarded, so a `kind` arriving from a cast or a
  deserialized value throws a `TypeError` _inside the constructor_, replacing the intended
  classified error with an unclassified one — the fail-safe direction, but it converts a
  502 into a 500.
- **Fix**: `const entry = CONTRACT[kind] ?? CONTRACT.upstream_fault;`
- **Decision**: FIXED — both `message` and `status` now read from the guarded `entry`.
  `@typescript-eslint/no-unnecessary-condition` flags the fallback as unreachable by type;
  suppressed with a reason, since covering a `kind` that bypassed the type system is exactly
  the guard's purpose.

### F7 — Stale comment describes behaviour this change removed

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/recipe.service.test.ts:535
- **Detail**: "The message is not asserted: it names the provider, which is Risk #6
  presentation work owned by `expired-product-handling`." That work is done — the
  empty-content case now carries the shared `unusable_model_response` copy and names no
  provider. The comment points a future reader at a deferral that has been resolved.
- **Fix**: Retire the comment, or restate it as "shared copy, asserted by kind not by text".
- **Decision**: FIXED — restated: the empty-content case carries the shared
  `unusable_model_response` copy, so the assertion is on the kind rather than on a snapshot
  of the string. The rest of the comment, which explains why `TypeError`/`SyntaxError` are
  asserted against, is unchanged.

### F8 — Comment in `generate.ts` contradicts the code beneath it

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/recipes/generate.ts:37-39
- **Detail**: "A body that is present but malformed still falls through to validation
  below." It does not. Every field in `generateSchema` is `.optional()` or `.default()`, so
  the `body = {}` fallback parses successfully and a malformed body silently generates with
  default parameters. `generate.test.ts:249` pins this as intentional, so the behaviour is a
  decision — but it diverges from `products/index.ts:50` and `approve.ts:28`, which both
  return 400, and the comment describes a guard that does not exist. Pre-existing, not
  introduced here.
- **Fix**: Correct the comment to say a malformed body is treated as an absent one.
- **Decision**: FIXED — comment only. It now states that a malformed body is treated the
  same as an absent one, and names the reason (every field optional or defaulted, so `{}`
  parses). The behaviour is untouched, since `generate.test.ts:249` pins it as intentional.

### F9 — Two plan-text inaccuracies where the implementation chose better

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/expired-product-handling/plan.md:581,510
- **Detail**: (a) Phase 6 §4 specifies `status: complete` for `change.md`; `complete` is not
  a value in this workflow's vocabulary — `/10x-archive` expects `{implemented,
impl_reviewed}`. The implementation correctly shipped `implemented` (change.md:4).
  (b) Phase 5 §4 places the datastore-hygiene test in `recipe.service.test.ts`; it landed in
  `generate.test.ts:317-336` instead, with its vacuity guard intact. That file is the right
  home — `recipe.service.test.ts` has no Supabase seam. Both are plan defects, not
  implementation drift; recorded so a future reader does not "correct" the code to match.
- **Fix**: None to the code. Optionally amend the plan text so the two rows describe what
  shipped.
- **Decision**: FIXED — plan text amended, no code change. Phase 6 §4 now reads
  `status: implemented` with a note on the vocabulary; Phase 5 §4 now names
  `generate.test.ts` and says why (`recipe.service.test.ts` has no Supabase seam).

## Notes

Verified independently during this review and found sound:

- `classifyExpiry` is genuinely the only derivation point — a repo-wide grep finds no second
  site computing either flag.
- All four `unusable_model_response` sites share one message from the `CONTRACT` table with
  no duplicated literal, and the forbidden phrase "didn't match your inventory" appears
  nowhere in `src/` except the comment explaining why it was avoided.
- All three vacuity guards in the hygiene tests exist and assert the raw text really was
  produced upstream before asserting its absence.
- Ordering in `generate.ts` is empty → all-expired → generate, with the provider unreached
  in both precondition branches.
- Astro page callers (`inventory.astro`, `recipes.astro`) swallow service errors into safe
  UI state, so the new typed throws introduced no regression there.
