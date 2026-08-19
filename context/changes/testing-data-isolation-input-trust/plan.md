# Data Isolation and Input Trust Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md`: prove a second authenticated user
cannot reach the first user's `products`/`recipes` rows by constructing an id (Risk #4),
and that crafted generation parameters are rejected at the boundary rather than reaching
the model prompt (Risk #7). Research found the codebase already compliant on both risks —
`listProducts`, `deleteProduct`, and `listRecipes` all chain an explicit `.eq("user_id",
userId)` alongside RLS per `context/foundation/lessons.md`'s rule, and `generate.ts`'s
closed-list validation already rejects an out-of-enum `technique`. This phase closes the
**coverage gap**, not a defect: no test today proves the isolation holds against a real
second user and a real database, and only one of the three closed lists (`technique`) has
an endpoint-level rejection test.

## Current State Analysis

- **Risk #4 surface is narrower than the risk's wording suggests.** There is no
  `recipes/[id].ts` route and `products/[id].ts` exports only `DELETE` — no route exists
  today that reads a single product or recipe by id. The reachable surface is: the
  collection reads (`GET /api/products`, `GET /api/recipes`, each scoped to the caller via
  `listProducts`/`listRecipes`) and the one mutating single-id endpoint (`DELETE
/api/products/[id]`, via `deleteProduct`).
- **Every reachable function already complies with the lessons.md rule.**
  `listProducts` (`src/lib/services/product.service.ts:51-56`) and `listRecipes`
  (`src/lib/services/recipe.service.ts:241-249`) both chain `.eq("user_id", userId)`.
  `deleteProduct` (`src/lib/services/product.service.ts:92-97`) chains both
  `.eq("user_id", userId)` and `.eq("id", productId)` with `{ count: "exact" }`, so a
  foreign id and a nonexistent id both resolve to `count === 0` → a bare `Error("not
found")` → the route maps that to a 404 (`src/pages/api/products/[id].ts:26-28`). This
  is a deliberate non-leak: the response never distinguishes "not yours" from "doesn't
  exist."
- **`approveRecipe` is a structural, already-tested exception.** It takes no `userId`
  parameter and has no app-layer `.eq` — ownership is enforced entirely inside the
  `approve_recipe` RPC's own `auth.uid()`-scoped `WHERE` clauses
  (`supabase/migrations/20260607120000_approve_recipe.sql:17,25`), which is `SECURITY
INVOKER` so it runs under the caller's own session. This is already proven by
  `recipe.service.approve.integration.test.ts:236-255` ("excludes a foreign-owned id
  without deleting it or erroring"). Confirmed out of scope for this phase.
- **RLS is a real second layer, not the only one.** `supabase/migrations/20260531120000_initial_schema.sql`
  defines `USING (auth.uid() = user_id)` policies for SELECT/INSERT/UPDATE/DELETE on both
  tables for the `authenticated` role, plus explicit `USING (false)` deny policies for
  `anon`. The app-layer `.eq` filters above are redundant with RLS by design — the whole
  point of the lessons.md rule is that RLS alone was once silently bypassed
  (`context/foundation/lessons.md:5-9`), so both layers are asserted together, not
  substituted for each other.
- **Every API route builds its own Supabase client from request cookies, not from
  `locals`.** `src/lib/supabase.ts:5-24`'s `createClient(requestHeaders, cookies)` is
  called fresh inside every route handler (e.g. `src/pages/api/products/index.ts:17,38`,
  `src/pages/api/products/[id].ts:8`, `src/pages/api/recipes/index.ts:18`).
  `context.locals.user` (set by `src/middleware.ts` from `supabase.auth.getUser()`) is a
  separate value the route reads independently for its own 401 check and to pass
  `userId` into the service call. A route-level test that wants a **real**, RLS-enforced
  session therefore has to substitute what `createClient` returns, not what `locals`
  contains alone — see Critical Implementation Details.
- **Two seeded users already exist** (`supabase/seed.sql`): `test@example.com` /
  `test2@example.com`, both password `Test1234!`, added in Phase 2 specifically "for
  cross-user set-identity coverage." No seed changes needed.
- **A working cross-user integration scaffold already exists**
  (`recipe.service.approve.integration.test.ts`): a `beforeAll`-reachability guard
  (`describe.skipIf`) so `npm run test` behaves identically with or without `npx supabase
start`, two real `@supabase/supabase-js` clients signed in via `signInWithPassword`,
  and per-test insert/cleanup tracking. This phase's Risk #4 tests follow the same
  scaffold shape, applied at the route layer instead of the RPC layer.
- **Risk #7's closed-list mechanism is a genuine single source of truth**, not duplicated:
  `RECIPE_TECHNIQUES`/`RECIPE_METHODS`/`RECIPE_TIMES` (`src/types.ts:62-75`) back the zod
  schema (`generate.ts:8,17-22`, `z.enum(...)`), the prompt-building lookups
  (`recipe-prompt.ts`), and the frontend `<select>` dropdowns
  (`inventory-panel.tsx:259-313`) — all three read off the same arrays. There is no
  free-text input for any of the three fields anywhere in the UI.
- **Only `technique` has an endpoint-level rejection test today**
  (`generate.test.ts:260-271`: `technique: "flambe"` → 400, provider never called).
  `method` and `time` use the identical `z.enum()` mechanism off the same style of
  constant array but are structurally unverified at the endpoint.
- **No re-validation exists between the zod parse and the prompt.** `technique` and
  `method` are safe object-key lookups (`TECHNIQUE_LINES[params.technique]`,
  `METHOD_LINES[params.method]` in `recipe-prompt.ts`) that would throw or return
  `undefined` on an out-of-enum value. `time` is the one exception: it's directly
  template-interpolated (`timeLine(...)` in `recipe-prompt.ts`), so a value that bypassed
  zod would reach the prompt as free text. This is unreachable today — zod is the only
  entry point that constructs `RecipeParams` — and stays that way; see decisions below.

## Desired End State

- A real second authenticated user, tested against the real local database, cannot see
  the first user's products or recipes through the collection endpoints, and cannot
  delete the first user's product through the single-id endpoint — proven at the route
  layer, not inferred from reading the code.
- An out-of-list value for any of the three closed generation parameters
  (`technique`, `method`, `time`) — not just `technique` — is rejected with 400 before
  the provider is ever called.
- The `time` field's direct-interpolation gap is recorded in the project's own record
  (test-plan.md §6.5), not silently left for a future reader to rediscover.

Verify via: `npm run test` (both with and without `npx supabase start` running),
`npm run typecheck`, `npm run lint`, and the mutation-testing pass in Phase 3.

### Key Discoveries:

- Mocking `@/lib/supabase`'s `createClient` to return a **real, already-signed-in**
  `@supabase/supabase-js` client (rather than a stub) is what lets a route-level test
  exercise the actual exported handler with real RLS enforcement, without needing to
  fabricate cookie serialization.
- `deleteProduct`'s `count === 0` branch already collapses "foreign" and "nonexistent"
  into the same 404 — the isolation guarantee this phase tests is that a foreign id never
  distinguishes itself from a wrong id, which is the correct non-leaking behavior to
  assert, not a gap to close.

## What We're NOT Doing

- Not adding a `GET`/`PATCH` route for a single product, or any `recipes/[id].ts` route —
  no such route exists today, and Risk #4 is a test-coverage phase, not a feature phase.
- Not touching `approveRecipe` — already covered by Phase 2's cross-user test; re-testing
  or annotating it here is redundant (per session decision).
- Not adding boundary tests for `excludeTitles` (max 10 items, 120 chars each) — it's
  free text by design, not a closed list, and out of Risk #7's framing (per session
  decision). Left as a known, unclosed gap for a future phase if it becomes relevant.
- Not adding a runtime guard for the `time` field's direct interpolation — the path is
  unreachable today (zod is the only entry point), and adding production code inside a
  test-rollout phase contradicts `test-plan.md` §1 principle #4 ("reuse, don't build").
  Documented only (per session decision).
- Not extracting a shared test-reachability/cleanup helper across the three new
  integration files — `test-plan.md` §7 explicitly excludes building test infrastructure
  beyond the minimum; each file duplicates the same small guard Phase 2 already
  established, matching that file's own precedent.
- Not wiring any of this into CI — that is `test-plan.md` Phase 4's job.
- Not adding component or UI tests — excluded project-wide per `test-plan.md` §7.

## Implementation Approach

Two independent risks, two independent test additions, closed out together. Risk #4 gets
new integration test files (real DB, two real users) at the route layer, following the
existing RPC-layer cross-user scaffold. Risk #7 gets a cheap extension of an existing
unit test (mocked, no DB) rather than new infrastructure, since the gap is breadth
(three lists, one tested) not depth.

## Critical Implementation Details

**Route-level cross-user tests need a real client behind the app's `createClient`
seam, not a stub.** Every route calls `createClient(context.request.headers,
context.cookies)` internally (`src/lib/supabase.ts`) rather than reading a client from
`locals`. To exercise the real exported route handler with real RLS, `vi.mock("@/lib/supabase")`
must return a **real, already-signed-in** `@supabase/supabase-js` client rather than the
usual query-stub pattern (`generate.test.ts`'s `QueryStub`). Because different tests in
the same file need the mock to return a _different_ signed-in client (primary vs.
secondary user) depending on which request is being simulated, use a `vi.hoisted`
mutable holder that each test sets before calling the route handler — mirroring
`generate.test.ts`'s `supabase.rows` holder pattern, but holding a whole client instead
of row data:

```ts
const clientHolder = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock("@/lib/supabase", () => ({ createClient: () => clientHolder.current }));
```

`context.locals.user` must be set to the **same identity** as whichever client
`clientHolder.current` holds for that call (e.g. `{ id: secondaryUserId }` alongside
`secondaryClient`) — a mismatch would test a different, unrelated scenario (a confused
session), not id-construction isolation.

**DB-touching tests must not break `npm run test` for a dev without Supabase running.**
Each new integration file repeats the exact `isSupabaseReachable()` +
`describe.skipIf(!supabaseReachable)` guard from
`recipe.service.approve.integration.test.ts:28-46`, evaluated once at module load.

## Phase 1: Data Isolation — Route-Layer Cross-User Tests

### Overview

Prove Risk #4 against the real local database: a second authenticated user cannot see
the first user's products or recipes through the collection endpoints, and cannot delete
the first user's product through the single-id endpoint.

### Changes Required:

#### 1. Cross-user product listing

**File**: `src/pages/api/products/index.integration.test.ts` (new)

**Intent**: Prove `GET /api/products`, called as the second seeded user, never includes
a product the first seeded user owns.

**Contract**: Follows the reachability-guard + two-signed-in-clients scaffold from
`recipe.service.approve.integration.test.ts`. Inserts one product as the primary user
(direct `.from("products").insert(...)` via `primaryClient`, cleaned up in `afterEach`),
calls the exported `GET` handler with `clientHolder.current = secondaryClient` and
`locals.user = { id: secondaryUserId }`, and asserts the response's `products` array
contains no entry with the primary product's id.

#### 2. Cross-user product deletion

**File**: `src/pages/api/products/[id].integration.test.ts` (new)

**Intent**: Prove `DELETE /api/products/[id]`, called as the second seeded user against
the first seeded user's product id, is rejected and does not delete the row.

**Contract**: Same scaffold. Inserts one product as the primary user, calls the exported
`DELETE` handler with `context.params = { id: <primary's product id> }`,
`clientHolder.current = secondaryClient`, `locals.user = { id: secondaryUserId }`.
Asserts `response.status === 404` (matching `deleteProduct`'s existing not-found/foreign
collapse — no distinguishing status), then re-selects the product via `primaryClient` and
asserts it still exists.

#### 3. Cross-user recipe listing

**File**: `src/pages/api/recipes/index.integration.test.ts` (new)

**Intent**: Prove `GET /api/recipes`, called as the second seeded user, never includes a
recipe the first seeded user owns.

**Contract**: Same scaffold. Inserts one recipe directly as the primary user
(`.from("recipes").insert(...)` via `primaryClient` — RLS's `WITH CHECK (auth.uid() =
user_id)` allows this since the client is authenticated as that same user), calls the
exported `GET` handler with `clientHolder.current = secondaryClient`,
`locals.user = { id: secondaryUserId }`, and a `url` set so `pageSchema`'s default page-1
behavior applies. Asserts the response's `recipes` array contains no entry with the
primary recipe's id.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes with `npx supabase start` running (all three new integration
  tests green)
- `npm run test` passes with the local Supabase stack stopped (new tests skip cleanly,
  existing suite unaffected)
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- `curl -X DELETE` the local `/api/products/<primary's id>` endpoint using the second
  seeded user's session cookie and confirm a 404, then confirm via the Supabase Studio
  or a direct `select` that the product still exists

---

## Phase 2: Input Trust — Closed-List Boundary Coverage

### Overview

Close the breadth gap in Risk #7: prove all three closed-list parameters
(`technique`, `method`, `time`) are rejected at the boundary, not just `technique`.

### Changes Required:

#### 1. Extend the out-of-list test to all three closed lists

**File**: `src/pages/api/recipes/generate.test.ts`

**Intent**: The existing test (`generate.test.ts:263-271`) proves the mechanism works
for `technique` alone. `method` and `time` use the identical `z.enum()` pattern off the
same style of constant array but are unverified at the endpoint. Convert the single test
into an `it.each` table per the project's own cookbook convention (§6.1: "Boundary rules
get one `it.each` table, not one test per row"), covering all three fields.

**Contract**: Replaces `generate.test.ts:263-271`'s single `it` with an `it.each` over
`[{ field: "technique", value: "flambe" }, { field: "method", value: "sous-vide" }, { field: "time", value: "60" }]`,
posting `JSON.stringify({ [field]: value })` and asserting `response.status === 400` and
`fetchSpy` was never called for each case — same assertion shape as the existing test,
just parameterized.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes (all three `it.each` cases green)
- `npm run typecheck` passes
- `npm run lint` passes

#### Manual Verification:

- `curl -X POST` the local `/api/recipes/generate` endpoint with a crafted
  `{"method": "sous-vide"}` body and confirm a 400 response, demonstrating the endpoint
  is reachable and enforces the closed list independent of the UI dropdown

---

## Phase 3: Close-out

### Overview

Run the project's standard mutation-testing pass on the newly-covered logic, record what
this phase found, and update tracking status.

### Changes Required:

#### 1. Mutation testing pass

**Command**: `npx stryker run --mutate "src/lib/services/product.service.ts:51-107"`
(covers `listProducts` and `deleteProduct`), followed by
`npx stryker run --mutate "src/lib/services/recipe.service.ts:241-254"` (covers
`listRecipes`) — same narrowed-scope convention Phases 1/1b/2 used. Review survivors
individually per `CLAUDE.md`'s Mutation testing section; add an assertion only where a
survivor represents a user-visible or business-relevant bug. Of particular interest: a
mutant that removes or weakens the `.eq("user_id", userId)` filter on any of these three
functions — that is exactly the defect class this phase's new integration tests exist to
catch, and killing it is the strongest evidence the tests are doing their job.

#### 2. Test-plan phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Append a §6.5 "Phase 3" note, following the existing Phase 1/1b/2 format —
what was surprising (the real-signed-in-client-behind-a-mock pattern for route-level
cross-user testing; the `time` field's direct-interpolation gap, recorded as accepted and
unreachable rather than closed; `approveRecipe` confirmed as a compliant structural
exception, not touched).

**Contract**: New subsection under `## 6.5 Per-rollout-phase notes`, 2-3 lines, matching
the existing entries' voice.

#### 3. Rollout status update

**File**: `context/foundation/test-plan.md`

**Intent**: Flip the `## 3. Phased Rollout` table's Phase 3 row `Status` from
`change opened` to `complete`.

**Contract**: One cell in the existing table (`test-plan.md:87`).

### Success Criteria:

#### Automated Verification:

- `npm run test` passes (full suite)
- `npm run typecheck` passes
- `npm run lint` passes
- Stryker mutation runs complete; survivors triaged and recorded

#### Manual Verification:

- `change.md` status and `test-plan.md`'s Phased Rollout table both reflect Phase 3
  complete
- `test-plan.md` §6.5 phase note reads consistently with the existing Phase 1/1b/2 entries

---

## Testing Strategy

### Unit Tests:

- Extended `it.each` in `generate.test.ts` covering all three closed-list parameters
  (Phase 2). No new unit test file — this is an extension of existing coverage.

### Integration Tests:

- Cross-user product listing exclusion (`GET /api/products`)
- Cross-user product deletion rejection (`DELETE /api/products/[id]`, 404 + row survives)
- Cross-user recipe listing exclusion (`GET /api/recipes`)

### Manual Testing Steps:

1. `curl -X DELETE` a foreign product id as the second seeded user and confirm 404 plus
   the row's survival (Phase 1 manual criterion).
2. `curl -X POST` the generate endpoint with a crafted `method`/`time` value and confirm
   400 (Phase 2 manual criterion).
3. Confirm `npm run test` behaves identically whether or not `npx supabase start` is
   running (Phase 1 automated criterion) — the same regression class Phase 2 guarded
   against.

## Performance Considerations

None — all changes are new or extended test code; no production code path changes.

## Migration Notes

None — no schema changes. Both seeded users this phase relies on already exist from
Phase 2.

## References

- Rollout definition: `context/foundation/test-plan.md` §2 (Risk Response Guidance for
  Risks #4, #7), §3 Phase 3
- Lessons rule: `context/foundation/lessons.md` ("Always add an app-layer user_id filter
  alongside RLS on read and delete queries")
- Cross-user test scaffold to follow:
  `src/lib/services/recipe.service.approve.integration.test.ts`
- Route-context helper pattern to follow: `src/pages/api/recipes/generate.test.ts:73-86`
- RLS policies: `supabase/migrations/20260531120000_initial_schema.sql`
- Closed-list source of truth: `src/types.ts:62-79`, `src/pages/api/recipes/generate.ts:8,17-22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Isolation — Route-Layer Cross-User Tests

#### Automated

- [x] 1.1 `npm run test` passes with local Supabase running (all three new integration tests green) — e4d6e51
- [x] 1.2 `npm run test` passes with local Supabase stopped (new tests skip cleanly) — e4d6e51
- [x] 1.3 `npm run typecheck` passes — e4d6e51
- [x] 1.4 `npm run lint` passes — e4d6e51

#### Manual

- [x] 1.5 `curl -X DELETE` a foreign product id as the second seeded user, confirm 404 and row survival — e4d6e51

### Phase 2: Input Trust — Closed-List Boundary Coverage

#### Automated

- [x] 2.1 `npm run test` passes (all three `it.each` cases green) — a032bcb
- [x] 2.2 `npm run typecheck` passes — a032bcb
- [x] 2.3 `npm run lint` passes — a032bcb

#### Manual

- [x] 2.4 `curl -X POST` generate with a crafted `method`/`time` value, confirm 400 — a032bcb

### Phase 3: Close-out

#### Automated

- [x] 3.1 `npm run test` passes (full suite)
- [x] 3.2 `npm run typecheck` passes
- [x] 3.3 `npm run lint` passes
- [x] 3.4 Stryker mutation runs complete, survivors triaged

#### Manual

- [x] 3.5 `change.md` and `test-plan.md` rollout status updated
- [x] 3.6 `test-plan.md` §6.5 phase note added, consistent with existing entries
