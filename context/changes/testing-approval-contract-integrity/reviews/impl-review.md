<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Approval Contract Integrity — all-or-nothing, and exactly the set displayed

- **Plan**: context/changes/testing-approval-contract-integrity/plan.md
- **Scope**: Phase 5 of 5 (full plan review)
- **Date**: 2026-08-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Atomicity-test cleanup can permanently strand the sentinel row if an assertion fails mid-test

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/services/recipe.service.approve.integration.test.ts:143-169 (rename step), :93-102 (afterEach)
- **Detail**: The atomicity test inserts a product named `__test_force_delete_failure__`, then at the very end renames it to a random `cleanup-*` name specifically so the shared `afterEach`'s blind `.delete().eq("id", id)` can remove it — the `BEFORE DELETE` trigger blocks deletion of any row still bearing the sentinel name. If any assertion earlier in the test throws (lines 150, 153, or 160), the test aborts before the rename runs. `afterEach` doesn't check the delete's returned error, so the row is silently left behind, still named `__test_force_delete_failure__`, permanently undeletable until a manual `db reset`. This is the exact "does cleanup survive a failed assertion" property the plan's Phase 4 intent cared about, and today the answer is no for this one test.
- **Fix**: Wrap the sentinel-rename in a `try/finally` (or perform it unconditionally in a dedicated cleanup step that runs before the generic `afterEach` delete) so a future assertion regression can't leave an undeletable row in the local seed database.
- **Decision**: FIXED — wrapped the assertions in try/finally so the sentinel rename always runs before afterEach's delete, even on assertion failure.

### F2 — New `approveRecipe` unit tests aren't reflected in plan.md's Testing Strategy section

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/services/recipe.service.test.ts (new `describe("approveRecipe", ...)` block)
- **Detail**: plan.md's Testing Strategy section states "None new — Existing unit coverage in recipe.service.test.ts is untouched by these changes (no assertions there reference approveRecipe)." The implementation adds two new unit tests there (RPC call-shape/return assertion, and a `ServiceError` `data_access` assertion on RPC failure). This is a good, well-justified addition — it's the direct cause of the Phase 5 mutation-testing gain (0.00% → 71.43%) recorded in test-plan.md's §6.5 Phase 2 note, since the integration suite calls the RPC directly and never exercises the `approveRecipe` wrapper. It's transparently documented in test-plan.md, just not in plan.md itself.
- **Fix**: Amend plan.md's Testing Strategy → Unit Tests section with one line noting the two `approveRecipe` unit tests added during Phase 5's mutation-testing pass, so the plan matches what shipped.
- **Decision**: FIXED — added an addendum to plan.md's Testing Strategy → Unit Tests section documenting the two `approveRecipe` unit tests and the mutation-score gain that motivated them.

### F3 — Sentinel-name delete trigger is a permanent, table-wide, user-name-keyed guard

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260816130000_approve_recipe_test_delete_trigger.sql:1-20
- **Detail**: The `BEFORE DELETE` trigger fires on every delete against `public.products`, for every user, and raises only when `OLD.name` exactly equals `__test_force_delete_failure__`. Product names are unrestricted user input with no reservation of this string. If any real user ever named a product exactly that string, they would be permanently unable to delete it — anywhere the migration is applied, including production, since the design intends it to stay installed. Practically improbable, self-inflicted (not cross-user, not a data-exposure issue), and the trade-off is explicitly reasoned about in the plan's Critical Implementation Details (a `REVOKE`/`GRANT` alternative was considered and rejected as a worse, session-wide side effect). Flagged for visibility only.
- **Fix**: No action required. If extra insurance is wanted later: reserve the sentinel prefix at the product-name validation layer, or scope the trigger to a test-only schema instead of the production `products` table.
- **Decision**: SKIPPED — not worth fixing now.
