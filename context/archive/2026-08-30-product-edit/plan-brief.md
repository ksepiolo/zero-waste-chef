# Edit Existing Pantry Product — Plan Brief

> Full plan: `context/changes/product-edit/plan.md`
> Research: `context/changes/product-edit/research.md`

## What & Why

Add the ability to edit an existing product's name and expiry date from the inventory panel, via a modal opened from the currently-inert pencil icon. This closes the gap where the only way to fix a typo or correct a date is to delete and re-add the product.

**Scope note**: `context/foundation/roadmap.md`'s Parked section lists this as excluded from MVP per the PRD's Non-Goals ("poprawka wymaga delete + add w MVP"). Confirmed with the user this is a deliberate post-MVP addition now that S-01–S-03 have all shipped — this plan supersedes that Parked entry.

## Starting Point

`product.service.ts` has `createProduct`/`deleteProduct` but no `updateProduct`; `[id].ts` exports only `DELETE`. The RLS `UPDATE` policy already exists, so no migration is needed. `InventoryPanel` already renders a disabled-looking pencil icon next to each row's delete button — this plan wires it up.

## Desired End State

Clicking the pencil opens a modal pre-filled with the product's current name and expiry date. Saving updates the list in place (re-sorted if the date changed) with no reload. Canceling with unsaved changes prompts a discard confirmation. If the product was removed elsewhere while the modal was open, saving reconciles gracefully instead of erroring.

## Key Decisions Made

| Decision               | Choice                                                                | Why (1 sentence)                                                                                                                                          | Source                            |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Stale-404 handling     | Auto-close modal, remove from list, toast "removed elsewhere"         | Matches the existing `onApproveSuccess`/`onExpiredExcluded` precedent for reconciling stale client state                                                  | Plan (user-confirmed)             |
| Save button gating     | Disabled until dirty (and valid)                                      | Avoids pointless PATCH round-trips; standard edit-modal UX                                                                                                | Plan (user-confirmed)             |
| Close while submitting | Blocked (Cancel disabled, Escape/overlay ignored)                     | Prevents abandoning a request the UI can no longer reconcile                                                                                              | Plan (user-confirmed)             |
| Dirty cancel           | Confirm discard via nested `AlertDialog`                              | User chose data-loss protection over the simpler silent-close option                                                                                      | Plan (user-confirmed)             |
| E2E coverage           | Unit + integration only, no new Playwright spec                       | Matches the coverage level the original create/delete feature shipped with                                                                                | Plan (user-confirmed)             |
| Not-found detection    | `.select().single()` + check `error.code === "PGRST116"`              | Confirmed via Supabase's own docs that `.single()` returns this code for zero rows; combines with `createProduct`'s row-returning shape in one round-trip | Plan (self-resolved via Context7) |
| Schema sharing         | Hoist to new `product.schema.ts`, imported by both `POST` and `PATCH` | First use of the `feature.schema.ts` convention; avoids validation-rule drift between create and edit                                                     | Plan (self-resolved)              |

## Scope

**In scope:**

- `updateProduct` service function, `PATCH /api/products/[id]` route
- Shared Zod schema (`product.schema.ts`) used by both `POST` and `PATCH`
- Edit modal (raw `radix-ui` `Dialog`, copying `recipe-history-panel.tsx`'s pattern) with dirty-gated save, block-close-while-submitting, discard confirmation, stale-404 handling
- Unit tests for `updateProduct`; cross-user isolation integration test for `PATCH`

**Out of scope:**

- Database migration (RLS already permits this)
- Partial updates (both `name` and `expiry_date` always required together)
- New Playwright E2E spec
- New shared `Dialog` UI wrapper component
- Component-level (React Testing Library) tests — no such convention exists in this repo yet

## Architecture / Approach

Two phases: backend first (service + route + schema + tests), then frontend (modal wired to the pencil icon), since the modal's `PATCH` calls depend on the backend existing. Every piece copies a direct precedent already in the codebase — `updateProduct` combines `createProduct`'s row-returning insert with `deleteProduct`'s user-scoped `.eq()` chain; the `PATCH` route copies `DELETE`'s four-step shape; the modal copies `recipe-history-panel.tsx`'s `Dialog` markup and `handleAdd`'s fetch/error-handling flow.

## Phases at a Glance

| Phase       | What it delivers                                                                 | Key risk                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Backend  | `updateProduct`, shared schema, `PATCH` route, unit + integration tests          | Not-found detection (`PGRST116`) is a subtle Supabase behavior — verified against docs, not assumed                                                       |
| 2. Frontend | Edit modal wired to the pencil icon, with dirty/close/discard/stale-404 handling | Radix `Dialog.Content` unmount/remount vs. parent component state persistence — state reset must be explicit (see plan's Critical Implementation Details) |

**Prerequisites:** Local Supabase running (`npx supabase start`) to exercise the new integration test.
**Estimated effort:** ~1 session across the 2 phases — every piece has a direct precedent to copy, so this is implementation-and-wiring, not design.

## Open Risks & Assumptions

- Assumes the roadmap's Parked/Non-Goals status for product editing is genuinely superseded now, not an oversight — confirmed directly with the user before planning.
- The `PGRST116` not-found detection relies on `id` being the table's primary key (so "multiple rows" is impossible and the code unambiguously means "not found") — true today per the schema, and asserted in the plan's Contract section rather than left implicit.

## Success Criteria (Summary)

- A user can edit a product's name and/or expiry date from the inventory list and see the change reflected immediately, correctly re-sorted.
- Editing a product deleted or changed elsewhere fails gracefully (auto-reconciled with a toast), not with a raw error.
- No regressions to the existing add/delete/recipe-generation flows; full test suite and lint/typecheck stay green.
