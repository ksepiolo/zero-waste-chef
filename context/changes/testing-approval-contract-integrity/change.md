---
change_id: testing-approval-contract-integrity
title: Approval contract integrity — all-or-nothing, and exactly the set displayed
status: implementing
created: 2026-08-16
updated: 2026-08-16
archived_at: null
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md`: "Approval contract integrity".

**Risks covered**

- **#3** — Approval half-succeeds: products are removed but the recipe is never saved, or the reverse. (High impact, Medium likelihood.)
- **#5** — The set of products actually removed differs from the set the approval screen listed. (High impact, Low–Med likelihood.)

**Test types planned**: integration, against the existing local `npx supabase db reset` seed. Per §1 principle #4, reuse the seed and the single `ci` job rather than building new test infrastructure.

**Risk response intent** (from test-plan.md §2 Risk Response Guidance)

- **#3**: prove that a forced failure on the second write leaves _neither_ effect committed — inventory unchanged and no orphan recipe row. Challenge "it returned 200, so both writes landed", and "the routine is atomic, so there is nothing to test" — the call site can still misread its result. Do not mock the database; the atomicity guarantee _is_ the database.
- **#5**: prove that the set returned in the approval payload and the set deleted on confirm are provably the same set — across duplicates, stale ids, and ids removed between generate and approve. Challenge "the client sends back what we sent it": the client is untrusted, and a stale or edited id list must not widen the deletion. Do not assert only the count, and do not compare the two lists order-dependently.

**Known context from the 2026-08-16 implementation review of `expired-product-handling`** (finding F3, triaged as SKIPPED — deliberately not recorded in the test plan): `recipe.service.ts` `approveRecipe` still throws `new Error(error.message)` carrying raw PostgREST text, which reaches a user toast via `approve.ts` → `use-recipe-generation.ts` → `inventory-panel.tsx`. That path is inside this phase's scope. Treat it as a candidate finding for research to verify, not as an established test-plan risk.

Phase 4 of the `expired-product-handling` plan established the `ServiceError` pattern in `src/lib/services/service-error.ts`; the approve path has not been migrated to it.
