# Approval Contract Integrity — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`: prove approval is all-or-nothing
(Risk #3) and removes exactly the set it displayed (Risk #5). Research confirmed
atomicity is sound at the database level but untested, and that Risk #5 is a live,
pre-accepted defect — `approve_recipe` silently skips stale or foreign ids instead of
reporting them, and the client compounds it by trusting the ids it sent rather than
what the server actually did. This plan closes both the coverage gap and the defect,
and migrates `approveRecipe`'s raw-`Error` leak (F3) to the project's `ServiceError`
pattern along the way.

## Current State Analysis

- `approve_recipe` (`supabase/migrations/20260607120000_approve_recipe.sql`) is a
  single `SECURITY INVOKER` plpgsql function — SELECT snapshot, INSERT recipe, DELETE
  products, all scoped by `user_id = auth.uid()`. No exception handler, so any raised
  error rolls back the whole call. This guarantee has never been exercised by a test.
- The DELETE's `WHERE id = ANY(p_used_product_ids) AND user_id = auth.uid()` silently
  excludes any id that doesn't match — stale, already-deleted, or belonging to another
  user — with no way for the caller to tell "nothing to delete" from "this id was
  invalid." This is the pre-accepted "V1 known limitation"
  (`context/archive/2026-06-05-recipe-generation-loop/plan.md:44`), and it directly
  contradicts the PRD's own guardrail: "the approval screen is a contract... never
  more, never fewer" (`context/foundation/prd.md:39`).
- `approveRecipe` (`src/lib/services/recipe.service.ts:253-273`) returns a bare
  `string` (the recipe id) and throws untyped `Error` on failure — the one function in
  the approve path not migrated to `ServiceError` when `product.service.ts` was
  (`src/lib/services/service-error.ts`).
- `approve.ts` (`src/pages/api/recipes/approve.ts:38-46`) responds `{ id }` only — the
  server never reports which ids it actually deleted — and echoes `err.message`
  verbatim into a 500 body, which is exactly how raw PostgREST text reaches a toast.
- `use-recipe-generation.ts`'s `approve()` calls `onApproveSuccess(current.used_product_ids)`
  — the ids the client _sent_ — and `inventory-panel.tsx:71-73` filters local state on
  that same sent set. A server-side skip is invisible to the UI until a page refresh.
- No test in this project touches a real database. The existing mock seam
  (`generate.test.ts`) proves call-site correctness but cannot prove atomicity or
  set-exactness — those are Postgres properties, not JS properties. `npx supabase
db reset` already applies the migration and a one-user seed; nothing new needs
  building to reach a real local Postgres instance.
- `products.user_id` and `recipes.user_id` both carry a `REFERENCES auth.users(id)`
  foreign key (`supabase/migrations/20260531120000_initial_schema.sql:6,52`), so a
  cross-user fixture needs a second real `auth.users` row — a fabricated UUID will not
  satisfy the constraint.
- CI (`.github/workflows/ci.yml`) never runs `npm run test` today. `test-plan.md`'s
  own Phased Rollout table and Quality Gates table both assign that wiring to Phase 4
  ("Quality-gates wiring... Lock the floor in the existing CI job"; integration tests
  are "required after §3 Phase 4"). This plan does not touch CI.

## Desired End State

- `approve_recipe` reports exactly which product ids it deleted. `approveRecipe`
  surfaces that set through `approve.ts` to the client, which reconciles its own state
  against it instead of the set it sent.
- A forced failure partway through `approve_recipe` (specifically the DELETE, not the
  INSERT) is provably rolled back in full: no orphan recipe row, no partial product
  deletion.
- The set actually deleted, across duplicates, a stale id, and a foreign-user id, is
  asserted against the real database — not a mock's assumption of one.
- `approveRecipe`'s failure paths throw `ServiceError`, so a PostgREST failure on
  approve reaches the user as the same safe, generic copy the rest of the app uses,
  not raw internal text.
- The PRD's guardrail wording matches what the system actually guarantees: report
  what changed, never silently claim more happened than did.

Verify via: `npm run test` (existing suite plus new integration tests, run locally
against `npx supabase db reset`), `npm run typecheck`, `npm run lint`, and manually
exercising the approval flow with a product deleted mid-flow in a second tab.

### Key Discoveries:

- `SECURITY INVOKER` (not `DEFINER`) means the RPC runs with the caller's own
  Postgres privileges — this is what makes a clean, non-global failure-forcing
  mechanism possible (see Phase 4).
- `DELETE ... RETURNING id` inside a CTE is the natural way to capture the actually-
  deleted set — no second query needed, no race between the DELETE and a follow-up
  SELECT.
- The client already has a working precedent for "server held something back, tell
  the user by name": `onExpiredExcluded` in `use-recipe-generation.ts` and its
  `toast.info` call in `inventory-panel.tsx:76-78`. The skipped-id reconciliation
  follows the same shape rather than inventing a new one.

## What We're NOT Doing

- Not wiring the new integration tests into CI — that is explicitly `test-plan.md`
  Phase 4's job; these tests run locally via `npm run test` against a running local
  Supabase stack.
- Not migrating `listRecipes`'s identical raw-`Error` leak — same defect, filed
  separately rather than bundled here (this phase stays scoped to the approve path).
- Not adding a test for `approveRecipe`'s `if (!result?.id)` defensive branch — treated
  as unreachable by construction (the RPC always returns a fresh id on success), same
  category as the `ServiceError` `CONTRACT` fallback already accepted elsewhere in
  this codebase.
- Not building a second-user creation/cleanup flow per test — the second seeded user
  is added once, permanently, to `seed.sql`.
- Not touching Risk #4 (data isolation) or Risk #7 (input trust) — those are Phase 3.
- Not adding component or UI rendering tests — excluded project-wide per
  `test-plan.md` §7; the client reconciliation fix in Phase 3 is verified by code
  review and manual testing, not an automated UI test.

## Implementation Approach

Bottom-up by layer, same ordering principle the original recipe-approval work used
("Foundation first, then top-down by layer"): the database contract changes first
since every other layer depends on its shape, then the service/endpoint boundary,
then the client, then the tests that prove all of it, then the documentation that
describes it. Each layer is independently curl/RPC-testable before the next one
touches it.

## Critical Implementation Details

**RPC return-type change requires a `DROP FUNCTION` first.** `CREATE OR REPLACE
FUNCTION` cannot change a function's return type in place (`UUID` → `JSONB`) —
Postgres rejects it. The migration must `DROP FUNCTION IF EXISTS
public.approve_recipe(TEXT, TEXT[], TEXT, UUID[])` before recreating it, or the
migration fails to apply on `db reset`.

**The sentinel trigger must not use a shared/global mechanism.** Because Vitest can
run test files in parallel processes against the same local Postgres instance, the
atomicity test's failure-forcing trigger fires only on an exact sentinel product name
(`'__test_force_delete_failure__'`) — it never touches any other row, so it is safe to
leave installed permanently and cannot make an unrelated test's DELETE fail.

**DB-touching tests must not break `npm run test` for a dev without Supabase running.**
Every existing test in this project is fully mocked and has zero DB dependency. The
new integration test file must not become a silent hard-fail for anyone who runs
`npm run test` without `npx supabase start` first. A `beforeAll` health-check against
the local REST endpoint, skipping the suite with a clear console message if
unreachable, preserves that invariant without a new npm script or CI matrix (per
`test-plan.md` §1 principle #4 — reuse, don't build).

## Phase 1: Database Foundations

### Overview

Change `approve_recipe`'s return shape to report what it actually deleted, and add
the second seeded user Phase 4's cross-user fixture needs.

### Changes Required:

#### 1. `approve_recipe` reports the deleted set

**File**: `supabase/migrations/20260816120000_approve_recipe_report_deleted.sql`

**Intent**: The function currently returns a bare `UUID` (the new recipe id) and
gives the caller no way to know which of the requested product ids were actually
removed. Capture the DELETE's own `RETURNING` and return both values together, so the
silent-skip behavior becomes an observable fact instead of a hidden one.

**Contract**: `approve_recipe(TEXT, TEXT[], TEXT, UUID[])` now `RETURNS JSONB` shaped
`{"recipe_id": "<uuid>", "deleted_ids": ["<uuid>", ...]}`. The SELECT-snapshot and
INSERT statements are unchanged; only the DELETE and the final `RETURN` differ:

```sql
DROP FUNCTION IF EXISTS public.approve_recipe(TEXT, TEXT[], TEXT, UUID[]);

CREATE FUNCTION public.approve_recipe(
  p_title TEXT,
  p_ingredients TEXT[],
  p_instructions TEXT,
  p_used_product_ids UUID[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_consumed_products JSONB;
  v_recipe_id UUID;
  v_deleted_ids UUID[];
BEGIN
  SELECT jsonb_agg(jsonb_build_object('name', name, 'expiry_date', expiry_date::TEXT))
  INTO v_consumed_products
  FROM products
  WHERE id = ANY(p_used_product_ids)
    AND user_id = auth.uid();

  INSERT INTO recipes (user_id, title, ingredients, instructions, consumed_products)
  VALUES (auth.uid(), p_title, p_ingredients, p_instructions, COALESCE(v_consumed_products, '[]'::JSONB))
  RETURNING id INTO v_recipe_id;

  WITH deleted AS (
    DELETE FROM products
    WHERE id = ANY(p_used_product_ids)
      AND user_id = auth.uid()
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_deleted_ids FROM deleted;

  RETURN jsonb_build_object('recipe_id', v_recipe_id, 'deleted_ids', to_jsonb(v_deleted_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_recipe(TEXT, TEXT[], TEXT, UUID[]) TO authenticated;
```

#### 2. Second seeded user

**File**: `supabase/seed.sql`

**Intent**: The cross-user set-identity test (Phase 4) needs a product owned by
someone other than the primary seeded user, and `products.user_id` has a foreign key
to `auth.users(id)` — a fabricated UUID won't satisfy it. Add a second local-only
account, mirroring the existing one's structure (same `auth.users` +
`auth.identities` insert pattern, new fixed uuid, e.g. `...002`, distinct email).

**Contract**: A second row in `auth.users`/`auth.identities`, guarded by the same
`jwt_secret` local-only check already in the file. No products or recipes seeded for
either user — tests insert their own rows.

### Success Criteria:

#### Automated Verification:

- [ ] 1.1 `npx supabase db reset` applies both migration changes cleanly
- [ ] 1.2 `npx supabase db reset` seeds two distinct users (verify via `select count(*) from auth.users`)
- [ ] 1.3 `npm run typecheck` passes (no consumers updated yet — nothing should break)

#### Manual Verification:

- [ ] 1.4 `curl` the local PostgREST endpoint calling `approve_recipe` directly with a
      valid session and confirm the JSONB shape (`recipe_id` + `deleted_ids`) comes
      back as expected

---

## Phase 2: Service & Endpoint Contract

### Overview

Consume the new RPC shape in `approveRecipe`, migrate its error handling to
`ServiceError` (closing F3 for the approve path), and update `approve.ts`'s response
and error mapping to match the rest of the app's endpoints.

### Changes Required:

#### 1. `approveRecipe` returns the deleted set, throws `ServiceError`

**File**: `src/lib/services/recipe.service.ts`

**Intent**: Replace the bare-`string` return and raw `Error` throws with the typed
`ServiceError` pattern already used by `product.service.ts`, and surface
`deleted_ids` from the new RPC shape instead of discarding it.

**Contract**: `approveRecipe(supabase, input): Promise<ApproveRecipeResult>` where
`ApproveRecipeResult = { id: string; deletedIds: string[] }` (new type in
`src/types.ts`, alongside `ApproveRecipeInput`). On a PostgREST error, throw
`new ServiceError("data_access", { cause: error })` instead of `new Error(error.message)`.
On a falsy `recipe_id` in the response (the defensive branch — see What We're NOT
Doing), throw `new ServiceError("data_access")` instead of the current bespoke
message; `.overrideTypes<{ recipe_id: string; deleted_ids: string[] }>()` replaces
the current `.overrideTypes<string>()`.

#### 2. `approve.ts` responds with the deleted set, maps `ServiceError`

**File**: `src/pages/api/recipes/approve.ts`

**Intent**: Mirror `generate.ts`'s catch-block convention exactly (`err instanceof
ServiceError` → `{ error: err.message }` with `err.status`; anything else →
`console.error` + generic 500) instead of echoing `err.message` verbatim. Include the
deleted set in the success response.

**Contract**: `200` response body becomes `{ id: string; deletedIds: string[] }`
(was `{ id }`). Error branch matches `generate.ts:90-102`'s shape one-for-one.

### Success Criteria:

#### Automated Verification:

- [ ] 2.1 `npm run typecheck` passes
- [ ] 2.2 `npm run lint` passes
- [ ] 2.3 `npm run test` passes (no existing test asserts the old `{ id }`-only shape —
      confirm via `grep -rn "deletedIds\|used_product_ids" src/pages/api/recipes/approve.test.ts` if that file exists, otherwise this is a no-op check)

#### Manual Verification:

- [ ] 2.4 `curl -X POST /api/recipes/approve` locally with a crafted stale id in
      `usedProductIds` and confirm the response's `deletedIds` excludes it while `id`
      (the recipe) is still present

---

## Phase 3: Client Reconciliation

### Overview

Stop the client from trusting the ids it sent. Reconcile local inventory state
against the server's `deletedIds`, and tell the user by name when something they
expected to be removed was not.

### Changes Required:

#### 1. Hook computes and forwards the skipped set

**File**: `src/components/hooks/use-recipe-generation.ts`

**Intent**: `approve()` currently calls `onApproveSuccess(current.used_product_ids)`
— the sent set. Read `deletedIds` from the response instead, derive `skippedIds` as
`current.used_product_ids` minus `deletedIds`, and pass both through.

**Contract**: `Options.onApproveSuccess` signature changes from
`(usedProductIds: string[]) => void` to `(deletedIds: string[], skippedIds: string[]) => void`.

#### 2. Panel filters on confirmed ids, toasts skipped ones by name

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: `onApproveSuccess` currently filters `products` on the sent id set
(`inventory-panel.tsx:71-73`). Filter on `deletedIds` instead. When `skippedIds` is
non-empty, resolve names from the still-current local `products` state (the skipped
product was deleted server-side in another tab, but this tab's stale state still has
its name) and `toast.info`, following the exact shape of the existing
`onExpiredExcluded` handler two lines below it.

**Contract**: No change to the component's exported props or other handlers.
`onApproveSuccess`'s two callback parameters match the hook's new signature.

### Success Criteria:

#### Automated Verification:

- [ ] 3.1 `npm run typecheck` passes
- [ ] 3.2 `npm run lint` passes

#### Manual Verification:

- [ ] 3.3 Generate a recipe, delete one of the "Will remove" products in a second
      browser tab before approving, then approve in the first tab — the approved
      recipe saves, the deleted-elsewhere product disappears from state (it already
      had, via the delete), and the _other_ used products are removed from the list
      without a page refresh
- [ ] 3.4 Confirm a toast names the skipped product rather than silently doing
      nothing

---

## Phase 4: Integration Tests

### Overview

Prove atomicity (Risk #3) and set-identity (Risk #5) against the real local
database — the property neither a mock nor a code read can establish.

### Changes Required:

#### 1. Sentinel trigger for forcing the DELETE to fail

**File**: `supabase/migrations/20260816130000_approve_recipe_test_delete_trigger.sql`

**Intent**: `approve_recipe`'s only statement after the INSERT is the DELETE — to
prove the INSERT gets rolled back when a _later_ statement fails, something has to
force that specific DELETE to fail, safely and without touching other tests' data
(`SECURITY INVOKER` + `REVOKE`/`GRANT` was considered and rejected — see Critical
Implementation Details).

**Contract**: A `BEFORE DELETE` trigger on `products` that raises only when
`OLD.name = '__test_force_delete_failure__'`; a no-op for every other row.

#### 2. Atomicity test

**File**: `src/lib/services/recipe.service.approve.integration.test.ts`

**Intent**: Insert a product named with the sentinel string, call `approve_recipe`
(directly via `supabase.rpc`, authenticated as the seeded user, against the real
local Postgres instance) including that product's id, and assert the whole call
rejects. Then assert neither effect persisted: no recipe row with the attempted
title, and the sentinel product still present.

**Contract**: One `describe` block, `beforeAll` health-checks the local REST endpoint
and skips the suite with a console message if unreachable (see Critical
Implementation Details). Authenticates via `@supabase/supabase-js`'s real
`signInWithPassword` against `test@example.com` / the seeded password.

#### 3. Set-identity test matrix

**File**: `src/lib/services/recipe.service.approve.integration.test.ts` (same file)

**Intent**: One `it.each` (or discrete `it`s) covering: happy path (all ids valid and
owned → `deletedIds` equals the sent set, recipe saved, products gone); a duplicate id
in the array (no error, deleted once, `deletedIds` has no duplicate); a stale id
(delete the product before calling the RPC → recipe still saves, `deletedIds`
excludes it, no error); a foreign id (insert a product owned by the second seeded
user → silently excluded, not deleted, no error — the ownership guarantee). Assert
`deletedIds` as a set (order-independent), never just its length.

**Contract**: Reuses the same authenticated client and health-check as the atomicity
test. Each case inserts its own product rows and cleans them up (or relies on
`ON DELETE CASCADE` via a fresh user per run — no, the users are the two fixed seeded
ones, so tests clean up their own inserted product/recipe rows in `afterEach`).

### Success Criteria:

#### Automated Verification:

- [ ] 4.1 `npx supabase start && npx supabase db reset` succeeds locally
- [ ] 4.2 `npm run test` passes with the local Supabase stack running (all new
      integration tests green)
- [ ] 4.3 `npm run test` still passes with the local Supabase stack **stopped** (new
      tests skip cleanly, existing suite unaffected)
- [ ] 4.4 `npm run typecheck` and `npm run lint` pass

#### Manual Verification:

- [ ] 4.5 Manually inspect the local `products`/`recipes` tables after a failed
      atomicity run to confirm no orphan rows survive

---

## Phase 5: Close-out

### Overview

Bring the documentation in line with what the system now actually guarantees, and run
the project's standard mutation-testing pass on the changed logic.

### Changes Required:

#### 1. PRD guardrail amendment

**File**: `context/foundation/prd.md`

**Intent**: Line 39's "never more, never fewer" is now honored as "report, don't
silently under-deliver": the system never deletes more than shown, and any id it
could not delete is surfaced to the caller rather than silently dropped. Update the
guardrail sentence to describe this precisely — the literal "never fewer" claim is
false when a product changed underneath the approval; the honest claim is that the
gap is never hidden from the user.

**Contract**: One sentence in the `## Guardrails` section (`prd.md:39`).

#### 2. Test-plan phase note

**File**: `context/foundation/test-plan.md`

**Intent**: Append a §6.5 "Phase 2" note, following the existing Phase 1/1b format —
what was surprising (the `SECURITY INVOKER` sentinel-trigger approach to forcing an
atomic failure without global side effects; the PRD guardrail wording gap Risk #5
surfaced).

**Contract**: New subsection under `## 6.5 Per-rollout-phase notes`, 2-3 lines,
matching the existing entries' voice.

#### 3. Mutation testing pass

**Command**: `npx stryker run --mutate "src/lib/services/recipe.service.ts:229-<end>"`
(the `approveRecipe` function and its new response-shaping logic), following the same
narrowed-scope convention Phases 1/1b used. Review survivors individually per
`CLAUDE.md`'s Mutation testing section — add an assertion only where a survivor
represents a user-visible or business-relevant bug (e.g., a mutant that drops
`deletedIds` from the response, or one that inverts the `ServiceError` vs. generic-500
branch in `approve.ts`).

### Success Criteria:

#### Automated Verification:

- [ ] 5.1 `npm run test` passes (full suite)
- [ ] 5.2 `npm run typecheck` passes
- [ ] 5.3 `npm run lint` passes
- [ ] 5.4 Stryker mutation run completes; survivors triaged and recorded

#### Manual Verification:

- [ ] 5.5 PRD guardrail wording reviewed for accuracy against the shipped behavior
- [ ] 5.6 `change.md` and `context/foundation/test-plan.md`'s Phased Rollout table
      status updated to reflect Phase 2 complete

---

## Testing Strategy

### Unit Tests:

- None planned — this phase's test type is integration per `test-plan.md`'s Phased
  Rollout table. Existing unit coverage in `recipe.service.test.ts` is untouched by
  these changes (no assertions there reference `approveRecipe`).
- Addendum (Phase 5, mutation-testing pass): two unit tests were added to
  `recipe.service.test.ts` under `describe("approveRecipe", ...)` — an RPC
  call-shape/return assertion and a `ServiceError` `data_access` assertion on RPC
  failure — since the integration suite calls the RPC directly and never exercises
  the `approveRecipe` wrapper, leaving it at 0% mutation coverage otherwise. Raised
  Phase 2 mutation score from 0.00% to 71.43% (see `test-plan.md` §6.5).

### Integration Tests:

- Atomicity: sentinel-forced DELETE failure → neither the INSERT nor the DELETE
  persists.
- Set-identity: happy path, duplicate id, stale id, foreign id — each asserted
  against `deletedIds` as a set, never by count alone.

### Manual Testing Steps:

1. Two-tab concurrent-delete scenario (Phase 3, criterion 3.3/3.4).
2. `curl` the RPC and endpoint directly with crafted payloads (Phase 1/2 manual
   criteria) to confirm the JSONB and JSON shapes before the client ever touches them.
3. Confirm `npm run test` behaves identically whether or not `npx supabase start` is
   running (Phase 4 criterion 4.3) — this is the regression that would break every
   other developer's local test run if missed.

## Performance Considerations

None — the RPC's statement count and the client's filter logic are unchanged in
complexity; only the payload shape grows by one array of ids already sized to the
approval's own product count (bounded, small).

## Migration Notes

Both new migrations are purely additive/replacing — no existing data is
transformed. `DROP FUNCTION` + `CREATE FUNCTION` on `approve_recipe` is safe because
Postgres function replacement inside a migration transaction is atomic with the rest
of the migration; a local `db reset` always runs from empty, and the only production
consumer is the app code this same change updates in lockstep (Phase 2).

## References

- Related research: `context/changes/testing-approval-contract-integrity/research.md`
- RPC: `supabase/migrations/20260607120000_approve_recipe.sql`
- Service pattern to follow: `src/lib/services/product.service.ts`
- Endpoint error-mapping pattern to follow: `src/pages/api/recipes/generate.ts:90-102`
- Existing "server held something back" precedent: `src/components/hooks/use-recipe-generation.ts` (`onExpiredExcluded`), `src/components/inventory/inventory-panel.tsx:74-78`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database Foundations

#### Automated

- [x] 1.1 `npx supabase db reset` applies both migration changes cleanly — b76456b
- [x] 1.2 `npx supabase db reset` seeds two distinct users — b76456b
- [x] 1.3 `npm run typecheck` passes — b76456b

#### Manual

- [x] 1.4 `curl` the RPC directly and confirm the JSONB shape — b76456b

### Phase 2: Service & Endpoint Contract

#### Automated

- [x] 2.1 `npm run typecheck` passes — 541d052
- [x] 2.2 `npm run lint` passes — 541d052
- [x] 2.3 `npm run test` passes — 541d052

#### Manual

- [x] 2.4 `curl` the endpoint with a stale id and confirm `deletedIds` excludes it — 541d052

### Phase 3: Client Reconciliation

#### Automated

- [x] 3.1 `npm run typecheck` passes — 6109d0a
- [x] 3.2 `npm run lint` passes — 6109d0a

#### Manual

- [x] 3.3 Two-tab concurrent-delete scenario reconciles without refresh — 6109d0a
- [x] 3.4 Toast names the skipped product — 6109d0a

### Phase 4: Integration Tests

#### Automated

- [x] 4.1 `npx supabase start && npx supabase db reset` succeeds — 2b95df7
- [x] 4.2 `npm run test` passes with Supabase running — 2b95df7
- [x] 4.3 `npm run test` passes with Supabase stopped (new tests skip cleanly) — 2b95df7
- [x] 4.4 `npm run typecheck` and `npm run lint` pass — 2b95df7

#### Manual

- [x] 4.5 Manually inspect tables after a failed atomicity run for orphan rows — 2b95df7

### Phase 5: Close-out

#### Automated

- [x] 5.1 `npm run test` passes (full suite) — 56468d7
- [x] 5.2 `npm run typecheck` passes — 56468d7
- [x] 5.3 `npm run lint` passes — 56468d7
- [x] 5.4 Stryker mutation run completes, survivors triaged — 56468d7

#### Manual

- [x] 5.5 PRD guardrail wording reviewed for accuracy — 56468d7
- [x] 5.6 `change.md` and `test-plan.md` rollout status updated — 56468d7
