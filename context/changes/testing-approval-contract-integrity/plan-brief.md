# Approval Contract Integrity — Plan Brief

> Full plan: `context/changes/testing-approval-contract-integrity/plan.md`
> Research: `context/changes/testing-approval-contract-integrity/research.md`

## What & Why

Rollout Phase 2 of the test plan: prove approval is all-or-nothing (Risk #3) and
removes exactly the set it displayed (Risk #5). Research found atomicity is sound but
untested, and that Risk #5 is a live, pre-accepted defect — the RPC silently
under-deletes on stale or foreign ids, and the client trusts what it sent rather than
what the server did. This plan closes both, and migrates `approveRecipe`'s raw-error
leak (F3) to the project's typed error pattern.

## Starting Point

`approve_recipe` is a sound single-transaction RPC, but returns only a bare recipe id
— never which product ids it actually deleted. The client removes products from local
state based on the ids it sent, not on server confirmation. No test in the project
touches a real database; the existing seed has one user and zero products.

## Desired End State

Approval either fully succeeds or fully fails, provably, against a real Postgres
instance. If a product changed underneath the approval, the server reports exactly
what it deleted, the client reconciles instead of lying, and the user sees a named
toast instead of stale UI until refresh.

## Key Decisions Made

| Decision                      | Choice                                                               | Why (1 sentence)                                                                                                                       | Source |
| ----------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Stale-id defect resolution    | Report the real deleted set, don't reject or paper over              | Preserves today's "approval always succeeds" UX while closing the client's actual lie; mirrors the existing `excluded_expired` pattern | Plan   |
| Client fix scope              | Fix `use-recipe-generation.ts` + `inventory-panel.tsx` in this phase | A server-only fix is inert — the UI would still lie until refresh                                                                      | Plan   |
| F3 (raw-error leak) scope     | `approveRecipe` only, not `listRecipes`                              | Keeps the diff matched to the two named risks; `listRecipes` filed separately                                                          | Plan   |
| Cross-user test fixture       | Second user added permanently to `seed.sql`                          | Phase 3 (data isolation) needs two seeded users anyway — avoids rebuilding this later                                                  | Plan   |
| Atomicity failure mechanism   | Sentinel-named-row trigger, not privilege revoke/grant               | Exercises the real DELETE statement without mutating shared role grants other parallel tests depend on                                 | Plan   |
| Unreachable `if (!id)` branch | Out of scope, documented as unreachable by construction              | Matches existing precedent for defensive fallbacks elsewhere in the codebase                                                           | Plan   |
| CI wiring                     | Not touched this phase                                               | `test-plan.md`'s own phase table assigns CI wiring to Phase 4 explicitly                                                               | Plan   |

## Scope

**In scope:**

- `approve_recipe` RPC returns `{recipe_id, deleted_ids}`
- `approveRecipe` / `approve.ts` migrated to `ServiceError`, new response shape
- Client reconciliation against server-confirmed deleted ids
- Real-database integration tests: atomicity + set-identity (happy path, duplicate,
  stale, foreign id)
- Second seeded user in `seed.sql`
- PRD guardrail wording amendment

**Out of scope:**

- CI wiring (Phase 4)
- `listRecipes`'s identical raw-error leak (filed separately)
- Data isolation / input trust (Phase 3, Risks #4/#7)
- UI component or rendering tests (excluded project-wide)

## Architecture / Approach

Bottom-up by layer: database contract (RPC + seed) → service/endpoint → client →
integration tests → docs. Each layer is independently verifiable (curl/RPC) before
the next depends on it — mirrors the original approve-flow build order.

## Phases at a Glance

| Phase                          | What it delivers                                               | Key risk                                                                                                             |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1. Database Foundations        | RPC returns deleted set; second seeded user                    | `DROP FUNCTION` required for the return-type change — easy to miss and fail `db reset`                               |
| 2. Service & Endpoint Contract | `approveRecipe`/`approve.ts` typed errors + new response shape | Response shape change is a breaking contract change for any other consumer (none exist today)                        |
| 3. Client Reconciliation       | UI filters on server-confirmed ids, toasts skipped items       | Stale-closure bug when resolving skipped product names from local state                                              |
| 4. Integration Tests           | Atomicity + set-identity proven against real Postgres          | New DB-dependent tests must skip gracefully without Supabase running, or they break every other dev's `npm run test` |
| 5. Close-out                   | PRD wording, test-plan note, scoped mutation pass              | —                                                                                                                    |

**Prerequisites:** Local Supabase CLI + Docker (already a devDependency, already
working per Phase 1 research).
**Estimated effort:** ~3-4 sessions across 5 phases.

## Open Risks & Assumptions

- The sentinel-trigger approach for forcing the DELETE to fail is a novel pattern for
  this codebase — if it proves awkward in practice, the fallback (documented in the
  plan's Critical Implementation Details) is the weaker INSERT-failure proof.
- The PRD wording amendment (Phase 5) is a product-facing document change; confirm the
  final phrasing reads correctly to a non-implementer before merging.

## Success Criteria (Summary)

- A forced mid-transaction failure leaves zero trace (no orphan recipe, no partial
  deletion) — proven, not assumed.
- The deleted set is asserted correct across duplicates, stale ids, and foreign ids —
  never just counted.
- A product deleted in another tab during approval is reflected correctly in the UI
  without a page refresh, with a named toast.
