<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Edit Existing Pantry Product — Implementation Plan

- **Plan**: context/changes/product-edit/plan.md
- **Scope**: Phase 2 of 2 (full plan — both phases complete)
- **Date**: 2026-08-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Automated Verification (re-run during review)

- `npm run typecheck` — pass (0 errors, 0 warnings, 5 hints)
- `npm run lint` — pass (0 errors)
- `npm run test:unit` — pass (4 files, 112 tests)
- `npx vitest run "src/pages/api/products/[id].integration.test.ts"` (local Supabase running) — pass (2 tests, including the new cross-user isolation case)

## Findings

### F1 — State reset uses render-time adjustment instead of the plan's specified `useEffect`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/inventory/inventory-panel.tsx:499-515
- **Detail**: The plan's Critical Implementation Details section specifies resetting `name`/`expiryDate`/`error`/`showDiscardConfirm` "in a `useEffect` keyed on `product?.id`." The actual code instead uses React's documented "adjust state during render" pattern, keyed on the `product !== null` open/close transition rather than `product?.id`, with an inline comment citing the React docs rationale and explaining why keying on the open-transition (not `product.id`) correctly also covers reopening the _same_ product after a discarded edit. Functionally equivalent for every reachable path — `onOpenChange` always routes a close through `setEditingProduct(null)` before a new product can be set, and the modal blocks interaction with other rows while open — but it's a different mechanism than the plan specifies, so a future reader who greps for `useEffect` here won't find it.
- **Fix**: No code change needed — the deviation is deliberate, documented, and functionally equivalent. Optionally add a one-line addendum to the plan noting the actual mechanism used, so the plan stays an accurate reference.
- **Decision**: FIXED — added addendum to plan.md's Critical Implementation Details section noting the actual render-time-adjustment mechanism used.

### F2 — Double-submit guarded only by React state, not a synchronous ref

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/inventory/inventory-panel.tsx:532-563
- **Detail**: `handleSubmit` guards re-entrancy with `isSubmitting` (React state), which can't block two clicks landing in the same frame before the re-render commits. `src/components/recipes/recipe-history-panel.tsx:30-32` established a `useRef` in-flight guard in this codebase specifically for that race. The new dialog doesn't reuse it. Risk is narrow here (a single Save button, not a rapid-fire action), but it's an established local pattern for exactly this class of bug that wasn't picked up.
- **Fix**: Optionally add a `useRef` in-flight guard mirroring `recipe-history-panel.tsx:30-32` if strict double-submit safety is wanted; acceptable as-is given the narrow surface.
- **Decision**: SKIPPED — narrow risk, single Save button.

### F3 — `params.id` not format-validated before use in `PATCH`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/products/[id].ts:17-20
- **Detail**: A malformed (non-UUID) `id` isn't rejected before reaching `updateProduct`'s `.eq("id", productId)`; Postgres would raise an "invalid input syntax" error, which gets classified as `ServiceError("data_access")` → 500 instead of a more correct 400/404. This is pre-existing behavior inherited unchanged from the sibling `DELETE` handler in the same file — not a regression introduced by this change, just a shared gap.
- **Fix**: No action needed as part of this change — same gap exists in `DELETE` and predates this plan; track separately if it's worth closing for both handlers.
- **Decision**: SKIPPED — pre-existing shared gap, not a regression from this change.

### F4 — `PATCH` catch block hardcodes 500, ignoring `ServiceError.status`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/products/[id].ts:41-47
- **Detail**: On a `ServiceError`, the route hardcodes `status: 500` rather than reading `err.status`. Harmless today since `updateProduct`'s only `ServiceError` kind (`data_access`) maps to 500 anyway, but it's latent — a future `ServiceError` kind would silently disagree with the response status. This mirrors the same shortcut already present in `index.ts` (POST/GET) and `[id].ts`'s existing `DELETE`, so it's consistent with existing precedent rather than a new deviation.
- **Fix**: No action needed as part of this change — matches existing precedent across the file; would be a repo-wide cleanup, not scoped to this plan.
- **Decision**: SKIPPED — matches existing precedent across the file, repo-wide cleanup not scoped to this plan.
