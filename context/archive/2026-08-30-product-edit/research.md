---
date: 2026-08-30T21:22:26+02:00
researcher: Claude (Sonnet 5)
git_commit: 9ce890bed601b1dafd1437d73b755cd3c01fdac9
branch: feature/product-edit
repository: zero-waste-chef
topic: "Edit existing pantry product via modal in inventory panel"
tags: [research, codebase, product-edit, inventory, product-service, api-routes, rls, radix-dialog]
status: complete
last_updated: 2026-08-30
last_updated_by: Claude (Sonnet 5)
---

# Research: Edit existing pantry product via modal in inventory panel

**Date**: 2026-08-30T21:22:26+02:00
**Researcher**: Claude (Sonnet 5)
**Git Commit**: 9ce890bed601b1dafd1437d73b755cd3c01fdac9
**Branch**: feature/product-edit
**Repository**: zero-waste-chef

## Research Question

The change notes (in `change.md`) already name the concrete gaps: add a modal to `inventory-panel.tsx` for editing a product's `name` and `expiry_date`; add a missing `updateProduct` service function and a `PATCH` route handler on `/api/products/[id]`; reuse the create-time validation rules; and reuse the raw radix-ui `Dialog` pattern from `recipe-history-panel.tsx` rather than a new shadcn primitive. This research verifies each of those claims against the live code and surfaces the conventions (isolation, error handling, testing) the new code must follow to fit.

## Summary

Every claim in the change notes checks out against the current code:

- `product.service.ts` has `listProducts`, `createProduct`, `deleteProduct` — no `updateProduct` ([src/lib/services/product.service.ts](src/lib/services/product.service.ts)).
- `src/pages/api/products/[id].ts` exports only `DELETE`; `index.ts` exports `GET`/`POST` — no `PATCH` anywhere ([src/pages/api/products/[id].ts:7](src/pages/api/products/[id].ts#L7), [src/pages/api/products/index.ts](src/pages/api/products/index.ts)).
- `products_update_authenticated` already exists and is correctly scoped (`USING`/`WITH CHECK` both `auth.uid() = user_id`) — no migration needed ([supabase/migrations/20260531120000_initial_schema.sql:25-28](supabase/migrations/20260531120000_initial_schema.sql#L25-L28)).
- The create-time Zod schema (`name` 1–255 chars, `expiry_date` `YYYY-MM-DD` and `>=` today) lives inline in `index.ts` and is not exported/shared — it will need to be duplicated or factored out for `PATCH` to reuse ([src/pages/api/products/index.ts:8-14](src/pages/api/products/index.ts#L8-L14)).
- `src/components/ui/` has no plain `dialog.tsx`; the only Dialog usage in the repo is the raw `Dialog` import from the `radix-ui` package in `recipe-history-panel.tsx`, confirming that's the pattern to copy rather than running `shadcn add dialog` ([src/components/recipes/recipe-history-panel.tsx:4](src/components/recipes/recipe-history-panel.tsx#L4), [src/components/recipes/recipe-history-panel.tsx:142-194](src/components/recipes/recipe-history-panel.tsx#L142-L194)).
- `InventoryPanel` already renders an inert pencil icon next to each product row (`<Pencil>` wrapped in a non-interactive `<span aria-hidden="true">`) — this is clearly the placeholder the edit modal is meant to wire up ([src/components/inventory/inventory-panel.tsx:244-247](src/components/inventory/inventory-panel.tsx#L244-L247)).

Beyond confirming the notes, two structural conventions matter for the plan:

1. **The data-isolation lesson applies to UPDATE too.** The concrete rule is in `context/foundation/lessons.md`: every service function touching user-owned rows must chain `.eq("user_id", userId)` in the query itself, not rely on RLS alone. `deleteProduct` does this with a `{ count: "exact" }` delete + `count === 0` → `throw new Error("not found")` pattern that the `DELETE` route matches to answer 404. `updateProduct` should follow the identical shape (`.update(...).eq("user_id", userId).eq("id", productId).select().single()` with a not-found path), and a cross-user integration test mirroring `[id].integration.test.ts`'s DELETE isolation test should be added for `PATCH`.
2. **Error taxonomy.** `ServiceError` in `service-error.ts` only has a `data_access` kind used by the products service today; `updateProduct` should throw `ServiceError("data_access", { cause: error })` on a genuine DB error, but the domain "not found" case should stay a bare `Error("not found")` like `deleteProduct`, matched explicitly in the route (not passed through `ServiceError`, which has no 404 kind).

## Detailed Findings

### `product.service.ts` — service layer

- Exports: `AT_RISK_DAYS`, `isExpired`, `isAtRisk`, `classifyExpiry`, `listProducts`, `createProduct`, `deleteProduct`. No `updateProduct`. ([src/lib/services/product.service.ts:1-107](src/lib/services/product.service.ts))
- `createProduct` shape to mirror for the "happy path" insert-like structure: builds an object literal restricted to the mutable fields (`name`, `expiry_date`), `.select().single<Product>()`, wraps DB errors in `ServiceError("data_access", { cause: error })`, then re-applies `classifyExpiry` to the returned row before returning `ProductWithRisk` ([src/lib/services/product.service.ts:72-90](src/lib/services/product.service.ts#L72-L90)).
- `deleteProduct` shape to mirror for the "must belong to this user, must exist" structure: `{ count: "exact" }`, chains **both** `.eq("user_id", userId)` and `.eq("id", productId)`, throws `ServiceError("data_access")` on a query error and a bare `Error("not found")` when `count === 0` ([src/lib/services/product.service.ts:92-107](src/lib/services/product.service.ts#L92-L107)). An `updateProduct` needs both of these traits at once: user-scoped **and** row-returning, so it will need `.update(...).eq("user_id", userId).eq("id", productId).select().single()` — but `.single()` on Supabase throws its own "no rows" error rather than returning a `count`, so the not-found detection strategy needs a decision (e.g. switch to `{ count: "exact" }` alongside `.select()`, or catch the PostgREST "no rows" error code — Supabase JS returns `PGRST116` for `.single()` with zero rows).

### API routes — `src/pages/api/products/`

- `[id].ts` currently exports only `DELETE`; the file already imports `createClient` and `deleteProduct` at the top and follows the standard four-step route shape: `createClient` → null-check (503) → `locals.user` check (401) → param/body validation (400) → service call wrapped in try/catch, mapping the "not found" message to 404 and everything else to 500 with `err.message` ([src/pages/api/products/[id].ts:1-31](src/pages/api/products/[id].ts)). A new `PATCH` export needs to be added to this same file, reusing this shape.
- `index.ts`'s `createProductSchema` (Zod) is a local `const`, not exported — `name`: `z.string().min(1).max(255)`; `expiry_date`: regex `^\d{4}-\d{2}-\d{2}$` + `.refine(val => val >= new Date().toISOString().split("T")[0])` ([src/pages/api/products/index.ts:8-14](src/pages/api/products/index.ts#L8-L14)). For `PATCH` to "reuse the same validation" per the change notes, this schema either needs to be exported from `index.ts`/hoisted to a shared location, or duplicated verbatim in `[id].ts`. Since both routes need the identical two-field object today, hoisting avoids drift risk — worth flagging as a design decision for the plan rather than deciding here.
- Both routes always respond with `{ error: string }` JSON on failure and `{ product }` / `{ products }` on success, `Content-Type: application/json` set only on success responses (error responses in this codebase set the header inconsistently — `GET`/`POST` don't set it on error, `DELETE`'s error responses also don't). A `PATCH` handler should match this existing (if slightly inconsistent) precedent rather than introduce a new convention.

### RLS / migrations

- `products_update_authenticated` (authenticated, `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`) and `products_update_anon` (anon, `USING (false)`) already exist in the initial schema migration — confirms no new migration is needed for this change ([supabase/migrations/20260531120000_initial_schema.sql:25-28](supabase/migrations/20260531120000_initial_schema.sql#L25-L28), [supabase/migrations/20260531120000_initial_schema.sql:40-41](supabase/migrations/20260531120000_initial_schema.sql#L40-L41)).
- Per [[Always add an app-layer user_id filter alongside RLS on read and delete queries]] in `context/foundation/lessons.md`, the same app-layer filter discipline should extend to this UPDATE, even though the rule's title predates it (it's phrased "read and delete" but the stated reasoning — "any service-role client or accidental RLS disable" — applies identically to UPDATE).

### Frontend — `inventory-panel.tsx`

- The product list row already renders a disabled-looking edit affordance: `<span aria-hidden="true" className="text-brand-muted-2 p-1"><Pencil className="size-4" /></span>` sits directly next to the (functional) delete `<button>` ([src/components/inventory/inventory-panel.tsx:244-259](src/components/inventory/inventory-panel.tsx#L244-L259)). This needs to become a real `<button>` (matching the delete button's `aria-label`/hover pattern) that opens the new edit modal, pre-filled with that product's `name`/`expiry_date`.
- State pattern to follow for the new modal: the file already manages two dialogs via simple `useState` — `pendingDeleteId: string | null` gates the `AlertDialog` for delete confirmation, and `recipe: Recipe | null` (from the `useRecipeGeneration` hook) gates the recipe-approval `AlertDialog` ([src/components/inventory/inventory-panel.tsx:64-68](src/components/inventory/inventory-panel.tsx#L64-L68), [src/components/inventory/inventory-panel.tsx:364-448](src/components/inventory/inventory-panel.tsx#L364-L448)). An edit modal fits the same shape: e.g. `editingProduct: ProductWithRisk | null` state, opened by the pencil button, closed on cancel/success.
- The "add product" form (`handleAdd`) is the closest precedent for the edit form's fetch/validation/error-handling flow: `FormData` → `fetch` → non-ok branch reads `{ error }` JSON into a local error state → success branch updates the `products` array and clears the error ([src/components/inventory/inventory-panel.tsx:107-138](src/components/inventory/inventory-panel.tsx#L107-L138)). The edit flow is a `PATCH /api/products/${id}` with the same body shape (`{ name, expiry_date }`), success replaces the matching product in `products` (and likely re-sorts by `expiry_date`, matching the add flow's `.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))` at [src/components/inventory/inventory-panel.tsx:131](src/components/inventory/inventory-panel.tsx#L131)) since editing the expiry date can change sort order.
- The date `<input type="date" min={today}>` and plain text `<input>` used in the add form ([src/components/inventory/inventory-panel.tsx:175-199](src/components/inventory/inventory-panel.tsx#L175-L199)) are the exact controls the modal's form should reuse, pre-populated with `defaultValue`/`value` from the product being edited.

### Dialog pattern — `recipe-history-panel.tsx` vs. `alert-dialog.tsx`

- `src/components/ui/` contains only `LibBadge.astro`, `alert-dialog.tsx`, `button.tsx`, `sonner.tsx` — **no plain `dialog.tsx`** ([directory listing](src/components/ui/)). This confirms the house rule ("no new shadcn primitive") is already being followed by using the raw `radix-ui` package directly for non-confirmation dialogs.
- `recipe-history-panel.tsx` imports `{ Dialog } from "radix-ui"` (the umbrella package, not `@radix-ui/react-dialog` directly) and uses `Dialog.Root` / `Dialog.Trigger asChild` / `Dialog.Portal` / `Dialog.Overlay` / `Dialog.Content` / `Dialog.Title` with hand-written Tailwind classes matching the app's brand tokens (`border-brand-border`, `rounded-2xl`, `bg-black/40` overlay, `fixed top-1/2 left-1/2 ... -translate-x-1/2 -translate-y-1/2`) ([src/components/recipes/recipe-history-panel.tsx:1-4](src/components/recipes/recipe-history-panel.tsx#L1-L4), [src/components/recipes/recipe-history-panel.tsx:142-194](src/components/recipes/recipe-history-panel.tsx#L142-L194)). This is the literal template to copy for the edit modal's markup/classes — controlled `open`/`onOpenChange` on `Dialog.Root`, matching the `isOpen`/`onOpenChange` prop pattern already used per-card in that file.
- `alert-dialog.tsx` (the existing shadcn-style wrapper `InventoryPanel` already uses for delete-confirm and recipe-approval) is a _confirmation_ pattern (`AlertDialogAction`/`AlertDialogCancel`, no arbitrary form content idiom) — not the right fit for a form with two inputs and its own submit/cancel/error-state logic, which is presumably why the change notes point at `recipe-history-panel.tsx`'s `Dialog` instead of `alert-dialog.tsx`.

### Types — `src/types.ts`

- `Product` (`id`, `user_id`, `name`, `expiry_date`, `created_at`), `NewProduct = Omit<Product, "id" | "user_id" | "created_at">` (i.e. `{ name, expiry_date }`), `ProductWithRisk = Product & { is_at_risk, is_expired }` ([src/types.ts:1-13](src/types.ts#L1-L13)). `NewProduct`'s shape is exactly what a PATCH body should validate to (same two fields, both required or both optional depending on whether partial updates are in scope — the change notes describe changing "nazwę i datę ważności" together, suggesting both fields are submitted every time from the modal, matching `NewProduct` with no new type needed).

### Testing conventions

- **Unit tests** (`product.service.test.ts`): frozen-clock (`vi.useFakeTimers()` + `vi.setSystemTime`), hand-rolled minimal Supabase query-builder stubs per operation shape (e.g. `stubDeleteChain` for the `.delete().eq().eq()` chain) rather than a general mock library ([src/lib/services/product.service.test.ts:130-157](src/lib/services/product.service.test.ts#L130-L157)). An `updateProduct` unit test would need an analogous `stubUpdateChain` covering `.update().eq().eq().select().single()`.
- **Integration tests** (`[id].integration.test.ts`, `index.integration.test.ts`): real local Supabase, two seeded users (`test@example.com`/`test2@example.com`), `vi.mock("@/lib/supabase")` swaps in a real signed-in client per test, `describe.skipIf(!supabaseReachable)` skips cleanly when `supabase start` isn't running, and each test explicitly asserts both the HTTP-level rejection (404) _and_ that the row is unchanged in the DB — never inferring one from the other ([src/pages/api/products/[id].integration.test.ts:60-122](src/pages/api/products/[id].integration.test.ts#L60-L122)). A `PATCH` cross-user isolation test should follow this exact template: seed a product as the primary user, attempt the `PATCH` as the secondary user, assert 404, then assert the row's `name`/`expiry_date` are unchanged in the DB.
- Both integration tests reference `[[Always add an app-layer user_id filter alongside RLS on read and delete queries]]` explicitly in a comment as the oracle being proven — a `PATCH` isolation test should carry the same comment/oracle reference.

## Code References

- `src/lib/services/product.service.ts:72-107` - `createProduct`/`deleteProduct`, the two shapes `updateProduct` should combine
- `src/lib/services/service-error.ts:15-64` - `ServiceError` kind table; only `data_access` is relevant here
- `src/pages/api/products/[id].ts:1-31` - current `DELETE`-only route; where `PATCH` gets added
- `src/pages/api/products/index.ts:8-14` - the Zod validation schema to reuse/share for `PATCH`
- `supabase/migrations/20260531120000_initial_schema.sql:25-28` - existing `products_update_authenticated` RLS policy
- `src/components/inventory/inventory-panel.tsx:244-259` - inert pencil icon placeholder next to the delete button
- `src/components/inventory/inventory-panel.tsx:107-138` - `handleAdd`, the closest precedent for the edit form's fetch flow
- `src/components/inventory/inventory-panel.tsx:364-383` - existing `AlertDialog` controlled-open pattern (delete confirm) for state-shape reference
- `src/components/recipes/recipe-history-panel.tsx:142-194` - raw `radix-ui` `Dialog` usage to copy for the edit modal
- `src/lib/services/product.service.test.ts:130-157` - unit test stub pattern for a Supabase mutation chain
- `src/pages/api/products/[id].integration.test.ts:60-122` - cross-user isolation integration test template for `PATCH`
- `src/types.ts:1-13` - `Product`/`NewProduct`/`ProductWithRisk`
- `context/foundation/lessons.md:5-11` - app-layer `user_id` filter rule

## Architecture Insights

- **Route shape is fully standardized**: every route in this codebase follows `createClient` → null-check → auth-check → input-validate → service-call-in-try/catch, with the service layer, not the route, owning the `ServiceError` classification. `PATCH` should not deviate from this.
- **"Not found" is deliberately kept out of `ServiceError`**: both the existing `deleteProduct`/`DELETE` pair and this research's read of `service-error.ts` show that a domain-level 404 is signaled with a bare `Error("not found")` string-matched by the route, not a `ServiceError` kind — because `ServiceError`'s kinds are about safely translating _upstream_ failures, and 404 needs no translation. `updateProduct` should follow the same split.
- **Validation is currently duplicated-by-absence, not duplicated-by-copy**: today only `index.ts`'s `POST` needs the schema. Adding `PATCH` to `[id].ts` is the first point where the same two-field schema is needed in two files, making this the natural moment to decide whether to hoist it (e.g. into `product.service.ts` or a new `product.schema.ts` per the `feature.schema.ts` naming convention) — the plan should make this call explicitly rather than silently duplicating the regex/refine logic.
- **Dialog-building has no shared abstraction**: both existing dialog usages (`alert-dialog.tsx` wrapper and `recipe-history-panel.tsx`'s raw `Dialog`) hand-write their own Tailwind for overlay/content/positioning rather than sharing a base. The edit modal is expected to add a third one-off, following `recipe-history-panel.tsx`'s markup rather than introducing a shared `Dialog` wrapper component — consistent with the project's general preference for inline Tailwind over premature abstraction (see CLAUDE.md conventions).
- **Sort-order side effect**: because the product list is kept sorted client-side by `expiry_date` after every mutation (`handleAdd`'s `.sort(...)`), an edit that changes `expiry_date` needs the same re-sort after a successful `PATCH`, or the list will visibly display in the wrong order until the next full reload.

## Historical Context (from prior changes)

- `context/archive/2026-05-31-inventory-management/plan.md:106-112` - the original `POST` validation was specified with the exact same Zod schema (`name` ≤ 255 chars, `expiry_date` regex + "today or future" refine) that lives in `index.ts` today — confirms this is the intended, stable validation contract to carry into `PATCH` unchanged, not a new decision to make.
- `context/archive/2026-05-31-inventory-management/plan.md:291` - "Add product with empty name — inline validation error" was a manually-verified acceptance criterion for create; the plan for this change should include the mirror case for edit.
- `context/foundation/lessons.md` - the only standing lesson in the repo is the app-layer `user_id`-filter rule discussed above; no other recorded lessons touch products/inventory.
- No prior change in `context/changes/` or `context/archive/` addresses editing an existing product — `2026-05-31-inventory-management` covers create/list/delete only, and this is a net-new capability.

## Related Research

- None — no other `research.md` in `context/changes/**` or `context/archive/**` covers product editing specifically. `context/archive/2026-05-31-inventory-management/research.md` and `plan.md` are the closest prior art for the create/delete surface this change extends.

## Open Questions

- **Not-found detection for `updateProduct`**: should it use `.update().select().single()` (relying on PostgREST's `PGRST116` "no rows" error to signal not-found) or `.update({ count: "exact" }).select()` without `.single()` (checking `count === 0` like `deleteProduct`, then separately reading the row)? Supabase JS's `count` option and `.single()` interact differently than in `deleteProduct` (which doesn't `.select()` a row back) — this needs a decision in the plan, ideally verified with a quick local Supabase check.
- **Schema sharing**: hoist `createProductSchema`'s validation to a shared location (e.g. `product.service.ts` or a new `product.schema.ts`) so `POST` and `PATCH` both import it, or accept duplication? The plan should decide and, if hoisting, follow the `feature.schema.ts` file-naming convention from `CLAUDE.md`.
- **Partial vs. full update semantics**: does `PATCH` require both `name` and `expiry_date` in the body every time (matching the modal always submitting both), or should the endpoint tolerate a partial body sending only one field? The change notes' modal always shows both fields, so requiring both is consistent with `NewProduct`'s shape — but this is worth confirming isn't blocked by a future need for partial updates.
- **Cross-tab staleness**: `handleApprove`'s `onApproveSuccess`/`onExpiredExcluded` callbacks in `InventoryPanel` show the app already reasons about another tab deleting a product concurrently (`skippedIds`). Should editing a product that was deleted/edited in another tab between opening the modal and submitting be handled specially (e.g. treat a 404 from `PATCH` as "someone else removed this" and drop it from the list), or is a generic error toast sufficient for v1?
