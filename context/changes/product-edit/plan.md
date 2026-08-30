# Edit Existing Pantry Product — Implementation Plan

## Overview

Add the ability to edit an existing product's `name` and `expiry_date` from the inventory panel, via a modal opened from the (currently inert) pencil icon next to each product row.

**Note on scope history**: `context/foundation/roadmap.md`'s Parked section lists "Edycja produktu" as excluded from MVP per the PRD's Non-Goals, with "delete + re-add" as the intended workaround. Confirmed with the user 2026-08-30 that this is a deliberate post-MVP addition (all of S-01–S-03 have since shipped) — this plan supersedes that Parked entry. No `product-edit` item exists in the roadmap's "At a glance" table, so the roadmap status sync in Step 5 has nothing to flip.

## Current State Analysis

- `product.service.ts` has `listProducts`, `createProduct`, `deleteProduct` — no `updateProduct`.
- `src/pages/api/products/[id].ts` exports only `DELETE`; `index.ts` exports `GET`/`POST` — no `PATCH` anywhere.
- `products_update_authenticated` RLS policy (`USING`/`WITH CHECK` both `auth.uid() = user_id`) already exists in `supabase/migrations/20260531120000_initial_schema.sql:25-28` — **no migration needed**.
- The create-time Zod schema (`name` 1–255 chars, `expiry_date` `YYYY-MM-DD` and `>=` today) lives inline in `index.ts`, unexported.
- `InventoryPanel` renders an inert `<span aria-hidden="true">` wrapping a `Pencil` icon next to each product row's delete button — the placeholder this change wires up.
- No React component tests exist anywhere in this repo (only service unit tests and route integration tests). A small Playwright e2e suite exists (`tests/generate-approve.spec.ts`, `tests/seed.spec.ts`) but covers only the generate/approve flow.
- `handleAdd`/`handleConfirmDelete` in `inventory-panel.tsx` use local inline error state, not toast; `toast` is reserved for the recipe generate/approve flow in that file.

## Desired End State

A user can click the pencil icon on any product row, see a modal pre-filled with that product's current name and expiry date, change either or both, and save — the list updates in place (re-sorted by expiry date if it changed) with no page reload. Canceling with unsaved changes prompts a discard confirmation. If the product was removed or changed elsewhere before save completes, the UI reconciles gracefully instead of erroring opaquely.

Verify via: `npm run typecheck`, `npm run lint`, `npm run test:unit`, the new integration test (with local Supabase running), and the manual verification steps in each phase below.

### Key Discoveries:

- `src/lib/services/product.service.ts:72-107` — `createProduct`/`deleteProduct`, the two shapes `updateProduct` combines (row-returning insert + dual-`.eq()` user-scoping).
- `src/pages/api/products/[id].ts:1-31` — current `DELETE`-only route; `PATCH` is added here.
- `src/pages/api/products/index.ts:8-14` — the Zod schema to hoist and share.
- `src/components/inventory/inventory-panel.tsx:244-259` — inert pencil placeholder.
- `src/components/recipes/recipe-history-panel.tsx:142-194` — raw `radix-ui` `Dialog` pattern to copy for the edit modal's markup.
- `src/pages/api/products/[id].integration.test.ts:60-122` — cross-user isolation integration test template for the new `PATCH` test.
- Confirmed via Supabase's own docs (Context7, `/supabase/postgrest-js`): `.single()` returns error code `PGRST116` ("JSON object requested, multiple (or no) rows returned") for **zero** rows, not only for multiple — the same code `.single()` already produces for the "no rows" case is what `updateProduct` will branch on.
- `context/foundation/lessons.md:5-11` — the app-layer `user_id` filter rule applies to `updateProduct` exactly as it does to `deleteProduct`.

## What We're NOT Doing

- No database migration — RLS already permits this.
- No partial-update semantics — `PATCH` always requires both `name` and `expiry_date` in the body, matching the modal always submitting both and `NewProduct`'s shape.
- No new Playwright E2E spec for this flow (confirmed with user) — unit + integration coverage only.
- No new shared `Dialog` UI wrapper component — the edit modal hand-writes Tailwind classes copied from `recipe-history-panel.tsx`, matching the project's existing one-off-per-usage convention.
- No component-level (React Testing Library) tests — no such convention exists anywhere in this repo yet; not introduced here.
- No quantity/amount field, notifications, or any other capability outside `name`/`expiry_date` editing.

## Implementation Approach

Two phases, backend then frontend, since the frontend's `PATCH` calls depend on the backend existing. Every piece has a direct precedent to copy: `updateProduct` combines `createProduct`'s row-returning insert shape with `deleteProduct`'s dual-`.eq()` user-scoping; the `PATCH` route copies `DELETE`'s four-step shape; the modal copies `recipe-history-panel.tsx`'s raw `Dialog` markup and `handleAdd`'s fetch/error-handling flow.

## Critical Implementation Details

### State sequencing — modal state survives Dialog open/close, must be reset explicitly

Radix's `Dialog.Content` unmounts from the DOM when closed (via its internal `Presence`), which can look like it resets component state — but the _parent_ function component holding `useState` (the new `EditProductDialog`) does **not** unmount just because its child `Dialog.Content` does. Without an explicit reset, reopening the modal for a different product (or the same one after a prior edit) would show stale `name`/`expiryDate` values from the previous session. `EditProductDialog` must reset its `name`, `expiryDate`, `error`, and `showDiscardConfirm` state in a `useEffect` keyed on `product?.id` whenever a product is opened for editing.

### State sequencing — close-attempt precedence

Three behaviors interact on every close attempt (Escape, overlay click, or the Cancel button): block-while-submitting, confirm-if-dirty, and otherwise-just-close. They must be checked in this order inside a single `attemptClose()` function, not as three independent handlers:

1. If `isSubmitting`, do nothing (Radix's controlled `open` prop not being updated is what blocks the close — the same mechanism `recipe-history-panel.tsx`'s controlled `isOpen`/`onOpenChange` already relies on, not `preventDefault()` on the escape/outside-click events).
2. Else if dirty (`name`/`expiryDate` differ from the product's current values), open the nested discard-confirmation `AlertDialog` instead of closing.
3. Else, close immediately.

The discard-confirmation's own "Discard" action calls the real close directly, bypassing step 2.

## Phase 1: Backend — service, route, and schema sharing

### Overview

Add `updateProduct` to the service layer, hoist the shared Zod validation schema, and add the `PATCH` handler to the existing `[id].ts` route — following the exact conventions `createProduct`/`deleteProduct` and the `DELETE` handler already establish.

### Changes Required:

#### 1. Shared validation schema

**File**: `src/lib/services/product.schema.ts` (new)

**Intent**: Extract the Zod schema currently inline in `index.ts` so both `POST` and the new `PATCH` validate with the exact same rules, with no duplication. This is the first use of the `feature.schema.ts` naming convention in this repo.

**Contract**: Export `productSchema` — identical shape to the current inline `createProductSchema` in `src/pages/api/products/index.ts:8-14` (`name`: `z.string().min(1).max(255)`; `expiry_date`: regex `^\d{4}-\d{2}-\d{2}$` + `.refine(val => val >= new Date().toISOString().split("T")[0])`). No behavior change, pure extraction.

#### 2. Wire the shared schema into `POST`

**File**: `src/pages/api/products/index.ts`

**Intent**: Remove the inline schema definition, import the hoisted one instead.

**Contract**: Delete the local `createProductSchema` const; `import { productSchema } from "@/lib/services/product.schema"`; `POST`'s `.safeParse(body)` call switches to `productSchema`.

#### 3. `updateProduct` service function

**File**: `src/lib/services/product.service.ts`

**Intent**: User-scoped, row-returning update — the same data-isolation discipline as `deleteProduct` (chain both `.eq("user_id", userId)` and `.eq("id", productId)` in the query itself, not relying on RLS alone per `[[Always add an app-layer user_id filter alongside RLS on read and delete queries]]`), combined with `createProduct`'s pattern of re-deriving `classifyExpiry` on the returned row.

**Contract**: `updateProduct(supabase: SupabaseClient, userId: string, productId: string, data: NewProduct): Promise<ProductWithRisk>`.

Query: `.from("products").update({ name: data.name, expiry_date: data.expiry_date }).eq("user_id", userId).eq("id", productId).select().single<Product>()`.

Error handling: if `error.code === "PGRST116"`, throw a bare `Error("not found")` (mirroring `deleteProduct`'s bare-`Error` not-found convention — not a `ServiceError` kind, since `ServiceError`'s kinds classify _upstream_ failures, and this is a domain 404 the route string-matches). `id` is the table's primary key, so `PGRST116` here can only mean zero matching rows, never multiple — safe to treat as an unambiguous not-found signal. For any other error, throw `ServiceError("data_access", { cause: error })`, with the same `console.error` diagnostic line pattern used in `createProduct`/`deleteProduct`. On success, return `{ ...updated, ...classifyExpiry(updated.expiry_date) }`.

#### 4. `PATCH` route handler

**File**: `src/pages/api/products/[id].ts`

**Intent**: Add `PATCH` following the exact same four-step shape as the existing `DELETE` export in this file (`createClient` → null-check 503 → auth-check 401 → validate → service-call-in-try/catch), plus body validation matching `POST`'s shape in `index.ts`.

**Contract**: `export const PATCH: APIRoute = async (context) => {...}`. Import `updateProduct` and `productSchema` alongside the existing `deleteProduct` import. Steps: `createClient` null-check (503) → `locals.user` check (401) → `params.id` presence check (400, same message as `DELETE`'s) → parse `request.json()` (400 "Invalid JSON" on parse failure, matching `POST`'s handling) → `productSchema.safeParse(body)` (400 with the first issue's message, matching `POST`'s handling) → call `updateProduct(supabase, context.locals.user.id, id, result.data)` in try/catch. Catch: `message === "not found"` → 404 `{ error: "Product not found" }` (matching `DELETE`'s exact message); otherwise 500 `{ error: message }`. Success: 200 `{ product }` with `Content-Type: application/json`, matching `POST`'s success response shape.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npx vitest run src/lib/services/product.service.test.ts`
- Full unit suite still green (no regressions): `npm run test:unit`
- New cross-user isolation integration test passes (requires local Supabase): `npx vitest run src/pages/api/products/[id].integration.test.ts`

#### Manual Verification:

- `PATCH /api/products/<own-id>` with a valid body returns 200 with the updated, re-classified product
- `PATCH /api/products/<own-id>` with an empty `name` or a past `expiry_date` returns 400 with the same validation message `POST` would give for the equivalent invalid input
- `PATCH /api/products/<foreign-id>` (a product belonging to another user) returns 404 and leaves that row unchanged in the DB
- `PATCH` with no session/auth cookie returns 401

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Frontend — edit modal wired to the pencil icon

### Overview

Turn the inert pencil icon into a working edit trigger, add a new `EditProductDialog` sub-component (defined inline in `inventory-panel.tsx`, mirroring how `RecipeCard` lives inline in `recipe-history-panel.tsx`) that copies the raw `radix-ui` `Dialog` markup pattern, and wire in the UX behaviors decided during planning: dirty-gated Save, block-close-while-submitting, discard-confirmation on a dirty cancel, and stale-404 reconciliation.

### Changes Required:

#### 1. Pencil icon becomes a real trigger

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Replace the `<span aria-hidden="true">` wrapping the `Pencil` icon with a real `<button>` that opens the edit modal for that row's product, styled consistently with the adjacent delete button but visually distinct (not the danger hover color, since this isn't a destructive action).

**Contract**: `<button type="button" aria-label={`Edit ${product.name}`} onClick={() => setEditingProduct(product)} className="text-brand-muted-2 hover:text-brand-green rounded p-1 transition-colors">` wrapping the existing `<Pencil className="size-4" />`. New `editingProduct: ProductWithRisk | null` state alongside the existing `pendingDeleteId` state.

#### 2. `EditProductDialog` sub-component

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: A self-contained modal matching `recipe-history-panel.tsx`'s `Dialog` markup, implementing the pre-fill, dirty-check, submit, discard-confirm, and stale-404 behaviors decided in planning (see Critical Implementation Details above for the state-reset and close-precedence requirements).

**Contract**: Local, unexported function component `EditProductDialog({ product, today, onOpenChange, onSaved, onRemoved })` where `product: ProductWithRisk | null`, `onOpenChange: (open: boolean) => void`, `onSaved: (updated: ProductWithRisk) => void`, `onRemoved: (id: string) => void`.

- Controlled `name`/`expiryDate` inputs (unlike `handleAdd`'s uncontrolled `FormData` approach — controlled is required here to compute dirty state), reset via the `useEffect` described in Critical Implementation Details.
- `isDirty` = either field differs from `product`'s current value; `isValid` = non-empty name ≤255 chars and `expiryDate >= today`. Save button `disabled={!isDirty || !isValid || isSubmitting}`.
- Submit: `PATCH /api/products/${product.id}` with `{ name, expiry_date: expiryDate }`. On 404 → call `onRemoved(product.id)`. On other non-ok → set inline `error` state from the response JSON, styled identically to `addError`'s `text-brand-danger` paragraph (not a toast — matches this file's existing form-error convention). On success → call `onSaved(json.product)`.
- `attemptClose()` implements the three-step precedence from Critical Implementation Details; wired to `Dialog.Root`'s `onOpenChange` and the Cancel button's `onClick`.
- Nested `AlertDialog` (reusing the existing `@/components/ui/alert-dialog` import already used for delete-confirm) for the discard prompt: title "Discard changes?", description naming the product, Cancel = "Keep editing" (just closes the confirm), Action = "Discard" (calls the real close).

#### 3. Wire the dialog into `InventoryPanel`

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Render `EditProductDialog` as a new sibling alongside the existing delete-confirm and recipe-approval `AlertDialog`s, and handle its two outcomes.

**Contract**: `<EditProductDialog product={editingProduct} today={today} onOpenChange={(open) => { if (!open) setEditingProduct(null); }} onSaved={(updated) => { setProducts((prev) => [...prev.filter((p) => p.id !== updated.id), updated].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))); setEditingProduct(null); }} onRemoved={(id) => { setProducts((prev) => prev.filter((p) => p.id !== id)); toast.info("This product was removed elsewhere"); setEditingProduct(null); }} />`. The re-sort on save mirrors `handleAdd`'s existing `.sort(...)` call, since editing `expiry_date` can change list order. The `toast.info` on removal matches the existing precedent in `onApproveSuccess`/`onExpiredExcluded` for reconciling state that changed in another tab.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full unit suite still passes (no regressions): `npm run test:unit`

#### Manual Verification:

- Clicking the pencil icon opens the modal pre-filled with that product's current name and expiry date
- Save is disabled on open (no changes yet); editing either field enables it; reverting a field back to its original value disables it again (proves diff-based dirty tracking, not just "was touched")
- Editing only the name and saving updates the list in place without changing row order
- Editing the expiry date to a different position and saving re-sorts the list correctly
- Clearing the name, or setting an expiry date before today, disables Save (and/or shows the native constraint) without allowing submission
- Making an edit then pressing Cancel, Escape, or clicking the overlay shows a "Discard changes?" confirmation; confirming discards and closes, canceling returns to the modal with edits intact
- Cancel/Escape/overlay with no changes made closes immediately, no confirmation shown
- While a save is in flight (throttle network in devtools), Cancel is disabled and Escape/overlay-click do not close the modal
- Opening the edit modal for a product, deleting that same product from a second browser tab, then saving in the first tab: the modal closes, the product disappears from the list, and a toast reports it was removed elsewhere
- No regressions in the existing add, delete, or recipe-generation flows

**Implementation Note**: Pause here for manual confirmation that all manual verification steps pass.

---

## Testing Strategy

### Unit Tests:

- `updateProduct` success path: returns the updated row with `classifyExpiry` re-applied (mirrors `createProduct`'s and `listProducts`'s reclassification tests).
- `updateProduct` not-found path: a `stubUpdateChain` returning `{ data: null, error: { code: "PGRST116", ... } }` results in a bare `Error("not found")`, not a `ServiceError`.
- `updateProduct` generic-failure path: any other error shape results in `ServiceError("data_access")`.

### Integration Tests:

- `PATCH /api/products/[id]` cross-user isolation: seed a product as the primary user, `PATCH` it as the secondary user with a different name/date, assert 404, then assert the row's `name` and `expiry_date` are unchanged in the DB (not inferred from the 404 alone) — the same oracle (`[[Always add an app-layer user_id filter alongside RLS on read and delete queries]]`) and structure as the existing `DELETE` isolation test.

### Manual Testing Steps:

See the Manual Verification lists under each phase above.

## Performance Considerations

None beyond what already applies to `createProduct`/`deleteProduct` — a single-row, indexed (`id` is the primary key) update.

## Migration Notes

None — no schema or RLS changes required.

## References

- Related research: `context/changes/product-edit/research.md`
- `src/lib/services/product.service.ts:72-107` — `createProduct`/`deleteProduct`
- `src/pages/api/products/[id].ts:1-31` — existing `DELETE` route shape
- `src/components/recipes/recipe-history-panel.tsx:142-194` — `Dialog` pattern to copy
- `context/foundation/lessons.md:5-11` — app-layer `user_id` filter rule

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — service, route, and schema sharing

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Unit tests pass: `npx vitest run src/lib/services/product.service.test.ts`
- [x] 1.4 Full unit suite still green: `npm run test:unit`
- [x] 1.5 Cross-user isolation integration test passes: `npx vitest run src/pages/api/products/[id].integration.test.ts`

#### Manual

- [x] 1.6 Valid `PATCH` on own product returns 200 with updated, re-classified product
- [x] 1.7 Invalid `PATCH` body (empty name / past date) returns 400 with the same message `POST` would give
- [x] 1.8 `PATCH` on a foreign product returns 404 and leaves the row unchanged
- [x] 1.9 `PATCH` with no session returns 401

### Phase 2: Frontend — edit modal wired to the pencil icon

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Full unit suite still passes: `npm run test:unit`

#### Manual

- [ ] 2.4 Pencil icon opens modal pre-filled with current values
- [ ] 2.5 Save disabled until dirty; re-disabled when reverted to original values
- [ ] 2.6 Name-only edit updates list without reordering
- [ ] 2.7 Expiry-date edit re-sorts the list correctly
- [ ] 2.8 Invalid input (empty name / past date) blocks submission
- [ ] 2.9 Dirty cancel/Escape/overlay shows discard confirmation; confirm discards, cancel keeps edits
- [ ] 2.10 Non-dirty cancel/Escape/overlay closes immediately, no confirmation
- [ ] 2.11 Cancel and Escape/overlay are blocked while a save is in flight
- [ ] 2.12 Stale-404 (product removed in another tab) closes modal, removes row, shows toast
- [ ] 2.13 No regressions in add/delete/recipe-generation flows
