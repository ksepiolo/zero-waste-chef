---
date: 2026-08-16T15:28:14Z
researcher: Kasia Sepiolo
git_commit: 6ed248ab480275e0b51e2898e6836d7d6a42cbed
branch: main
repository: zero-waste-chef
topic: "Rollout Phase 2 — Approval contract integrity (Risks #3, #5)"
tags: [research, codebase, approve_recipe, atomicity, set-identity, recipe.service, testing]
status: complete
last_updated: 2026-08-16
last_updated_by: Kasia Sepiolo
---

# Research: Approval contract integrity (Risks #3, #5)

**Date**: 2026-08-16T15:28:14Z
**Researcher**: Kasia Sepiolo
**Git Commit**: 6ed248ab480275e0b51e2898e6836d7d6a42cbed
**Branch**: main
**Repository**: zero-waste-chef

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md`: "Approval contract integrity."

Risks to verify:

- **#3** — Approval half-succeeds: products are removed but the recipe is never saved, or the reverse.
- **#5** — The set of products actually removed differs from the set the approval screen listed.

Risk response guidance to verify, not blindly accept:

- **#3**: prove a forced failure on the second write leaves _neither_ effect committed. Challenge "it returned 200, so both writes landed" and "the routine is atomic, so there is nothing to test." Do not mock the database.
- **#5**: prove the set returned in the approval payload and the set deleted on confirm are provably the same set — across duplicates, stale ids, and ids removed between generate and approve. Challenge "the client sends back what we sent it." Do not assert only the count; do not compare lists order-dependently.

Extended scope (per user decision this session): trace set identity through the client, not just the server boundary; ground the `p_instructions TEXT` vs. `instructions: string[]` shape as a candidate defect; ground F3 from the `expired-product-handling` implementation review (raw PostgREST text reaching a toast on the approve chain).

## Summary

**Risk #3 (atomicity) is SOUND at the database level, and the RPC-return-narrowing defect the test-plan cited as evidence is already fixed** — but the response guidance's core assumption ("the routine is atomic, so there is nothing to test") is still wrong, just not for the reason originally suspected. The real gap is that nothing tests the atomicity guarantee itself; the historical defect it happened to catch was a call-site typing bug, not a transaction bug.

**Risk #5 is a confirmed, pre-accepted, currently-shipping defect, not a coverage gap.** The archived plan explicitly pre-accepted "V1 known limitation: if a product is deleted in another tab while the approval modal is open, its name disappears from 'Will remove' but the RPC silently saves a partial snapshot with no error surfaced" (`context/archive/2026-06-05-recipe-generation-loop/plan.md:44`). That is a direct violation of the PRD's own guardrail: "the approval screen is a contract... never more, never fewer" (`context/foundation/prd.md:39`). **A test written honestly against the PRD will fail against current behavior.** This is a decision for `/10x-plan`, not a test to add quietly: either the RPC changes to error on a stale/missing id, or the PRD/guardrail is amended to describe the accepted V1 limitation.

The client makes the same defect worse and adds an independent divergence: `approve.ts` responds with `{ id }` only — the server never reports which ids it actually deleted — so `inventory-panel.tsx:71-73` removes products from local state using the ids the client _sent_ (`current.used_product_ids`), not the ids the server actually removed. A silently-skipped stale id (the pre-accepted defect above) makes the UI lie until a page refresh.

**The `p_instructions TEXT` vs. `instructions: string[]` shape is SOUND, not a defect.** It is a documented, working conversion: `recipe.service.ts:259` joins with `\n` before the RPC call, and `recipe-history-panel.tsx:140` splits on `\n` on read-back. Round-trip verified in code; drop this from the risk list.

**F3 (raw PostgREST text on the approve toast) is CONFIRMED live** and sits squarely inside this phase's scope — `approveRecipe` and `listRecipes` both `throw new Error(error.message)`, unlike the rest of the app's typed `ServiceError` convention.

**Test infrastructure**: no rig-building required. The existing mock seam (`vi.mock("@/lib/supabase", …)` in `generate.test.ts`) can prove call-site correctness but **cannot honestly prove atomicity or set-exactness** — those are database-engine properties. A real local-Postgres integration test is possible today with what already exists (`supabase/config.toml`, the migration, `npx supabase db reset`), but two gaps must be closed first: CI never runs `npm run test` at all today, and the seed has only one user and zero products (a test must insert its own product rows).

Two of four spawned research agents failed on an API session limit mid-run (atomicity/RPC-boundary agent, set-identity agent). Their ground was recovered by direct reading in this session — see Detailed Findings for what was verified directly vs. by a completed sub-agent.

## Detailed Findings

### Risk #3 — Atomicity

**The transaction guarantee is sound.** `approve_recipe` (`supabase/migrations/20260607120000_approve_recipe.sql:3-29`) is a single `plpgsql` `SECURITY INVOKER` function — SELECT snapshot, INSERT recipe, DELETE products, `RETURN v_recipe_id`. No exception handler, no `SAVEPOINT`, no explicit `COMMIT` inside the body. A function invoked via a single PostgREST/`supabase.rpc()` call runs inside one implicit transaction; if any statement inside raises, the whole function's effects roll back, including the earlier INSERT. There is no code path that lets the DELETE fail while the INSERT survives, or vice versa, from inside the function body.

**The RPC-return-narrowing defect the test-plan cited as evidence is already fixed** (`recipe.service.ts:253-273`):

```ts
export async function approveRecipe(supabase: SupabaseClient, input: ApproveRecipeInput): Promise<string> {
  const { data, error } = await supabase
    .rpc("approve_recipe", { ... })
    .overrideTypes<string>();

  if (error) throw new Error(error.message);

  const id = data as unknown as string | null;
  if (!id) throw new Error("Recipe was not saved");

  return id;
}
```

The comment documents the original defect precisely (`.overrideTypes<string>()` resolving to a branded union rather than plain `string` because no generated `Database` types exist) and its resolution (explicit narrowing via `data as unknown as string | null`, with an `!id` guard). This is the exact bug `context/archive/2026-06-05-recipe-generation-loop/change.md:26-35` and its impl-review F8 describe — already corrected there, not a live defect today.

**What is still untested: the actual failure-forcing case.** No test exists that forces the DELETE (or any second statement) to fail and asserts the INSERT did not survive. `error` is set by supabase-js when the RPC call itself raises inside Postgres — at that point, per the transaction semantics above, nothing should have committed. **This specific claim (a raised exception inside the function rolls back the already-executed INSERT) is grounded in general Postgres/plpgsql transaction semantics, not verified by a runtime test in this codebase — that verification is exactly what Phase 2 should add.**

**One residual PLAUSIBLE edge, not CONFIRMED**: `if (!id) throw new Error("Recipe was not saved")` fires only if the RPC returns successfully (no `error`) but `data` is falsy. Under normal execution `v_recipe_id` is always a fresh non-null UUID from `RETURNING id INTO v_recipe_id`, so this branch should be unreachable — but if it ever did fire, the INSERT+DELETE would already be committed (no `error` means the transaction succeeded) while the user sees a thrown error. That would be a genuine "reported failure, actually succeeded" case. Whether this is truly unreachable was not verified against a live Postgres instance in this pass — flagged as an edge for `/10x-plan` to decide whether it's worth a defensive test or is out of scope as unreachable-by-construction (same category as the `ServiceError` CONTRACT fallback fixed elsewhere in this project).

**`p_instructions TEXT` vs. `instructions: string[]` — SOUND, drop from risk list.** `recipe.service.ts:259`: `p_instructions: input.instructions.join("\n")` — the join is the documented "Sole conversion point" (comment at line 258). Column type confirmed `TEXT NOT NULL` at `supabase/migrations/20260531120000_initial_schema.sql:54`. Round-trip confirmed on read: `src/components/recipes/recipe-history-panel.tsx:140`: `recipe.instructions.split("\n").filter((step) => step.trim() !== "")`. `types.ts:55` documents the shape explicitly: `instructions: string[]; // array from AI; joined with '\n' only in approve endpoint`. This is not a live defect — the join/split pair is intentional and correctly paired.

**`auth.uid()` NULL path.** Not independently re-verified this pass beyond what the completed historical-decisions agent surfaced: `context/archive/2026-06-05-recipe-generation-loop/reviews/impl-review.md:150-168` (F9) records that `GRANT EXECUTE` is technically reachable by `anon` (Postgres grants EXECUTE to PUBLIC by default; Supabase doesn't revoke it), but fails safely today via a NOT NULL violation on `user_id` when `auth.uid()` is NULL, surfacing as an opaque 500. That finding was reviewed and explicitly SKIPPED as non-exploitable at the time — worth re-surfacing only if a Postgres linter flags `function_search_path_mutable`.

### Risk #5 — Set identity

**The DELETE is scoped to the caller — cannot widen to another user's rows.** `approve_recipe:23-25`:

```sql
DELETE FROM products
WHERE id = ANY(p_used_product_ids)
  AND user_id = auth.uid();
```

The `AND user_id = auth.uid()` bounds the worst case of Risk #5: a client cannot make the deletion touch rows it doesn't own, regardless of what ids it sends. This is a genuine, verifiable guarantee — a candidate positive assertion for the test suite ("a crafted id belonging to another user is not deleted, and does not error — it is silently excluded").

**The same filter is also the defect.** Because `WHERE id = ANY(...) AND user_id = auth.uid()` silently excludes any id that doesn't match — stale, already-deleted, or foreign — the routine has no way to distinguish "nothing to delete for this id" from "this id was never valid." Nothing re-derives the deletion set server-side against the recipe the server actually generated; the RPC trusts the id list verbatim (short of the ownership filter). This is the exact shape the archived plan pre-accepted:

> `context/archive/2026-06-05-recipe-generation-loop/plan.md:44` — "V1 known limitation: if a product is deleted in another tab while the approval modal is open, its name disappears from 'Will remove' but the RPC silently saves a partial snapshot with no error surfaced."

Against the PRD's own oracle:

> `context/foundation/prd.md:39` — "**Inventory consistency**: the approval screen is a contract. The set of products it shows as 'to be removed' matches exactly the set removed from the database — never more, never fewer."
>
> `context/foundation/prd.md:52` — "After approval, the inventory reflects the removal — the approved products no longer appear in the product list" (US-01 AC #3).

**This is a confirmed, currently-shipping defect against a stated guardrail, not a coverage gap.** A test that asserts the PRD's contract literally ("the deleted set equals the displayed set, always") will fail today for the stale-id case. `/10x-plan` needs to decide: fix the RPC (e.g., have it raise/report which ids were skipped, or have the endpoint re-validate the id list against a fresh read before calling the RPC), or amend the guardrail language to describe the accepted V1 exception. Testing around a known contradiction without surfacing it would just encode the bug as the new spec.

**The client compounds this with an independent divergence.** `approve.ts:39-42` responds `{ id }` only — the server never tells the client which ids were actually deleted:

```ts
const id = await approveRecipe(supabase, result.data);
return new Response(JSON.stringify({ id }), { status: 200, ... });
```

`use-recipe-generation.ts` (`approve()`) then calls `onApproveSuccess(current.used_product_ids)` — the ids the client _sent_, not anything the server confirmed. `inventory-panel.tsx:71-73`:

```ts
onApproveSuccess: (usedIds) => {
  setProducts((prev) => prev.filter((p) => !usedIds.includes(p.id)));
},
```

Concrete scenario: product A is deleted in a second tab while the approval modal is open in the first. The RPC silently skips id A (per the pre-accepted defect above) — the recipe still saves, 200 returned. The client removes A from local UI state anyway, because A was in `used_product_ids` regardless of what the server actually did. **A already doesn't exist in the DB (it was deleted in the other tab), so this specific scenario happens to self-correct** — but the general shape (server silently narrows the deletion for any reason, client optimistically removes the full sent set) is a real UI/DB divergence that a page refresh would reveal, not caught by any test today.

**Generation-time guardrail creates a false sense of coverage.** `recipe.service.ts:206-224` cross-checks the model's returned `used_product_ids` against the prompted inventory at _generation_ time (`ServiceError("unusable_model_response")` if the model invents an id, or ignores all at-risk products). This guardrail exists and is tested, but it only proves the ids were valid _when the recipe was generated_ — it says nothing about whether they are still valid _when the user approves_, which can be an arbitrary amount of time later. The existence of this generation-time check should not be mistaken for approval-time protection; they are different moments and the gap between them is exactly where Risk #5 lives.

**Duplicates.** `p_used_product_ids UUID[]` is not deduplicated anywhere before or inside the RPC. `id = ANY(...)` and the `DELETE` are naturally duplicate-safe (deleting the same row twice via one `ANY` array is a no-op, not an error), but this was not independently verified against a live Postgres instance this pass — flagged as PLAUSIBLE (very likely SOUND given standard `ANY()`/`DELETE` semantics, but not runtime-confirmed).

**Empty array.** `approve.ts:11` — zod `usedProductIds: z.array(z.uuid()).min(1)` rejects an empty array at the HTTP boundary before the RPC is ever called. This path is already guarded; not a gap.

### F3 (from expired-product-handling impl review) — confirmed in scope

`recipe.service.ts:244` (`listRecipes`) and `:264` (`approveRecipe`) both `throw new Error(error.message)` — raw PostgREST text, unlike the `ServiceError("data_access", ...)` pattern the rest of the app (`product.service.ts`) now uses. `approve.ts:43-46` echoes `err.message` verbatim into the JSON error body:

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : "Unknown error";
  return new Response(JSON.stringify({ error: message }), { status: 500 });
}
```

Chain to the toast: `approve.ts` → `use-recipe-generation.ts` (`approve()`, `errorMessage` helper reads `json.error` verbatim on `!res.ok`) → `inventory-panel.tsx` `toast.error`. An RLS misconfiguration or transient PostgREST failure on the approve path surfaces raw internal text (e.g., `permission denied for table "recipes" (policy recipes_insert_own)`) as a user-facing toast. This was explicitly triaged as SKIPPED in the `expired-product-handling` review (deferred to this phase) — confirmed live and in scope, not re-verified beyond re-reading the current file state, which matches the review's description exactly.

## Test Infrastructure

### What exists (verified directly + completed sub-agent)

- **Runner**: `vitest.config.ts` — `environment: "node"`, `include: ["src/**/*.test.ts"]`, no setup/teardown files, `TZ: "UTC"`. No database-touching test exists today.
- **Existing mock seam** (`generate.test.ts:22-40`): `vi.mock("@/lib/supabase", …)` hand-rolls a chainable query stub (`select`/`eq`/`order` only) backed by `vi.hoisted` mutable state. **No `.rpc()` method exists in this stub today** — it would need extending to cover `approve_recipe`. This seam mocks the JS boundary only; it cannot execute real SQL, a real transaction, or real RLS.
- **Seed** (`supabase/seed.sql`, full file): exactly one auth user (`test@example.com` / `Test1234!`, fixed uuid), guarded to only run against local dev via a `jwt_secret` probe. **Zero products, zero recipes seeded.** No second user — irrelevant to Risks #3/#5 (relevant to Risk #4, Phase 3).
- **Local Postgres reachability**: `supabase/config.toml` fully configured (API :54321, DB :54322, seed wired). `npx supabase start` + `npx supabase db reset` already apply the migration and seed. Nothing new to build here — Docker + the CLI (already a devDependency) is sufficient.
- **CI gap**: `.github/workflows/ci.yml` never runs `npm run test` at all today — only lint/typecheck/build. No database step exists in CI. This is a real gap the phase should close if it wants tests to run automatically, not a rig to build.

### What a mock CAN and CANNOT prove for these risks

**CAN prove** (with the existing seam extended for `.rpc()`): the call site passes correct arguments to the RPC; the call site correctly interprets the RPC's declared success/error shape (this is exactly the class of bug the archived typing defect was — call-site misreading, not transaction failure); endpoint-level error mapping and message hygiene (mirrors the existing sanitization tests in `generate.test.ts:317-333`).

**CANNOT prove**: atomicity (a mock returning "failure" on command asserts nothing about whether Postgres actually rolled back); set-exactness under RLS and stale/duplicate ids (the `AND user_id = auth.uid()` filter and `ANY()` array semantics are database behavior, not JS behavior). **The atomicity guarantee is the database — the response guidance's own anti-pattern warning ("mocking the database... a mock only asserts your own assumption") applies directly here.**

### Minimum viable path to a real-database test (no new infra category)

1. `npx supabase start && npx supabase db reset` (already documented, already works).
2. New test file authenticates a real `@supabase/supabase-js` client as the seeded user (or service-role), pointed at `http://127.0.0.1:54321`.
3. Test inserts its own `products` rows (seed provides none) before calling `.rpc("approve_recipe", …)` for real.
4. For atomicity: force a failure on the second statement (e.g., a constraint violation) and assert _neither_ the recipe row nor the product deletion persisted.
5. For set-identity: seed a duplicate id, a foreign-user id, and a since-deleted id in the same call; assert exactly which rows are affected and that the response/no-response distinguishes "silently skipped" in a way a future fix could target.
6. Close the CI gap: add a `supabase start`/`db reset` step to the existing single `ci` job before `npm run test` — no new workflow file, no service container needed (the CLI manages its own containers).

This matches `test-plan.md` §1 principle #4 exactly: reuse the seed and the single CI job; the missing pieces are test code and one CI step, not new infrastructure.

## Code References

- [`supabase/migrations/20260607120000_approve_recipe.sql:1-31`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/supabase/migrations/20260607120000_approve_recipe.sql#L1-L31) — the `approve_recipe` function (SELECT snapshot → INSERT → DELETE, all `user_id = auth.uid()`-scoped)
- [`supabase/migrations/20260531120000_initial_schema.sql:54`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/supabase/migrations/20260531120000_initial_schema.sql#L54) — `instructions TEXT NOT NULL` column definition
- [`src/lib/services/recipe.service.ts:253-273`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/lib/services/recipe.service.ts#L253-L273) — `approveRecipe`, RPC call and return narrowing
- [`src/lib/services/recipe.service.ts:234-247`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/lib/services/recipe.service.ts#L234-L247) — `listRecipes`, same raw-`Error` leak as `approveRecipe`
- [`src/lib/services/recipe.service.ts:206-224`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/lib/services/recipe.service.ts#L206-L224) — generation-time id cross-check guardrail (does not cover approval-time drift)
- [`src/pages/api/recipes/approve.ts:1-47`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/pages/api/recipes/approve.ts#L1-L47) — endpoint: zod validation, `{ id }`-only success response, raw-message error response
- [`src/components/hooks/use-recipe-generation.ts`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/components/hooks/use-recipe-generation.ts) (`approve()`) — calls `onApproveSuccess(current.used_product_ids)` with client-sent ids, not server-confirmed ids
- [`src/components/inventory/inventory-panel.tsx:71-73`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/components/inventory/inventory-panel.tsx#L71-L73) — client-side optimistic removal keyed on the sent id set
- [`src/components/recipes/recipe-history-panel.tsx:140`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/components/recipes/recipe-history-panel.tsx#L140) — `instructions.split("\n")` read-back, confirms the join/split round trip is sound
- [`src/types.ts:55`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/src/types.ts#L55) — documents the intentional `string[]` ↔ `TEXT` conversion point
- [`supabase/seed.sql`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/supabase/seed.sql) — single seeded user, zero products, local-only guard via `jwt_secret` probe
- [`vitest.config.ts:19-33`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/vitest.config.ts#L19-L33) — runner config, no DB setup/teardown
- [`.github/workflows/ci.yml`](https://github.com/ksepiolo/zero-waste-chef/blob/6ed248ab480275e0b51e2898e6836d7d6a42cbed/.github/workflows/ci.yml) — `ci` job never runs `npm run test`; no DB step

## Architecture Insights

- **Atomicity is delegated entirely to one plpgsql function** — this is the only transactional path available (`supabase-js` has no client-side transaction API), and it is soundly built. The project's risk was never "is the transaction real" — it's "does anything test that it's real," and separately, "does the function's _scoping logic_ (the `WHERE` clause) match the contract the UI promises."
- **The recipe/product relationship is deliberately decoupled** (`consumed_products JSONB` snapshot, not a foreign key) so recipe history survives product deletion. Any test asserting "recipe saved without deletion" must check `consumed_products` independently of live `products` rows — they are decoupled by design, not by accident.
- **The server never reports back which ids were actually acted on.** The `{ id }`-only response is a structural reason the client and server can silently diverge — this is not specific to the current stale-id defect; any future server-side skip (retry logic, partial batch handling, etc.) would hit the same blind spot unless the response contract changes.
- **The approve path is the one place in the app still using untyped `Error` throws** after the `expired-product-handling` change (Phase 4) established `ServiceError` everywhere else in `product.service.ts`. It was deliberately excluded from that migration and explicitly deferred to this phase.

## Historical Context (from prior changes)

- `context/archive/2026-06-05-recipe-generation-loop/research.md:213` — "Atomic approve via PostgreSQL function is the only safe option. supabase-js has no transaction API; two sequential PostgREST calls cannot be atomic." (Decision origin for the RPC-based design.)
- `context/archive/2026-06-05-recipe-generation-loop/research.md:223` — `consumed_products` snapshot-not-FK is deliberate, to survive product deletion.
- `context/archive/2026-06-05-recipe-generation-loop/change.md:26-35` — the RPC-return-typing defect, and its correction (already shipped, see Risk #3 above).
- `context/archive/2026-06-05-recipe-generation-loop/plan.md:44` — the pre-accepted "V1 known limitation" that is Risk #5's live defect.
- `context/archive/2026-06-05-recipe-generation-loop/reviews/plan-review.md:47-54` (F3) — the same concurrent-delete gap flagged during plan review, decision: documented as a known limitation rather than closed.
- `context/archive/2026-06-05-recipe-generation-loop/reviews/impl-review.md:150-168` (F9) — `GRANT EXECUTE` reachable by `anon`, decision SKIPPED as non-exploitable.
- `context/archive/2026-06-05-recipe-generation-loop/reviews/impl-review.md:161-168` (F10) — null RPC-return no-op, fixed (now the `if (!id) throw` guard in `approveRecipe`).
- `context/foundation/lessons.md:5-9` — RLS-alone-is-insufficient lesson; not approve-specific, but the same `auth.uid()` trust pattern underlies the RPC's DELETE scoping.
- `context/changes/expired-product-handling/plan.md:116` — "Not touching the approve path. `approve_recipe` set identity is Risk #5, rollout Phase 2." (This phase.)
- `context/changes/expired-product-handling/reviews/impl-review.md:97-137` (F3) — the raw-PostgREST-to-toast finding, triaged SKIPPED, explicitly deferred here.

## Related Research

- `context/archive/2026-06-05-recipe-generation-loop/research.md` — original grounding for the approve/RPC design.
- `context/changes/testing-recipe-generation-core/research.md` — Phase 1 research (runner bootstrap, generation core); establishes the mock-seam pattern this phase would extend.
- `context/changes/expired-product-handling/research.md` — Phase 1b research; established the `ServiceError` pattern this phase's F3 finding references.

## Open Questions

1. **Should `/10x-plan` fix the stale-id defect or amend the PRD guardrail?** This is the load-bearing decision for the whole phase — testing around the current behavior without resolving this first would either fail (if asserting the PRD literally) or silently ratify the bug (if asserting current behavior as the oracle). Recommend surfacing this explicitly to the user before `/10x-plan` writes sub-phases.
2. **Is the `if (!id) throw` branch in `approveRecipe` truly unreachable?** Not verified against a live Postgres instance this pass. Low priority — likely dead-code-safe, same shape as other defensive fallbacks in this codebase, but worth a one-line note in the plan rather than silently assuming.
3. **Duplicate-id behavior in `DELETE ... WHERE id = ANY(...)`** — PLAUSIBLE-not-CONFIRMED that duplicates are a harmless no-op; standard Postgres semantics support this but it wasn't run against a live instance.
4. **The two failed sub-agents** (atomicity/RPC-boundary deep dive, full client-chain trace) were not re-run after the session-limit failure; their intended scope was covered by direct reading in this pass, but a second pass with fresh agents could still surface something a single-context read missed, particularly around `SECURITY INVOKER` vs `SECURITY DEFINER` implications if RLS policies on `recipes`/`products` change in the future.
