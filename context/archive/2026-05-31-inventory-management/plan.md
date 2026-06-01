# Inventory Management Implementation Plan

## Overview

Implement S-01: a logged-in user can add a product (name + expiry date) to their inventory, view the full list with inline at-risk badges for products expiring within 3 days, and delete any product (with a confirm dialog) — all on a new `/inventory` route. The product service is the single authoritative location for the at-risk window constant, making it reusable for S-02.

## Current State Analysis

- `products` table exists in Supabase with RLS (F-01 complete): `id`, `user_id`, `name`, `expiry_date` (DATE), `created_at`
- `Product` and `NewProduct` types exported from `src/types.ts`; `ProductWithRisk` does not yet exist
- `src/product/product.handler.ts` is a stale stub with non-PRD fields (`quantity`, `unit`) — deleted in Phase 1
- Auth middleware resolves `Astro.locals.user` for all routes; `PROTECTED_ROUTES` currently covers only `/dashboard`
- `dashboard.astro` is a skeleton (welcome + signout) — needs an inventory link added
- No Zod in `package.json`; no shadcn `alert-dialog` installed
- API route pattern from auth: `const prerender = false`, uppercase handler exports, `createClient` + null-check, redirect or JSON response

## Desired End State

- `/inventory` is a protected page that renders the full product list (sorted by `expiry_date ASC`) with amber "At risk" badges on products expiring ≤ today+3 days
- Users can add a product via a form (name + date); the date must be today or future; the row appears immediately without page reload
- Users can delete any product via a confirm dialog; the row disappears immediately without page reload
- The at-risk window (3 days) is a named constant exported from `src/lib/services/product.service.ts`; no other file computes it

### Key Discoveries:

- `createClient(request.headers, cookies)` is the established auth-aware Supabase client factory — use it in both API routes and the page frontmatter
- `context.locals.user` (set by middleware) is available in API routes; use it to guard endpoints with 401 before touching Supabase
- Supabase RLS enforces user isolation at the DB layer; the explicit auth check in API routes is defense-in-depth
- Astro file-based routing: `src/pages/inventory.astro` → `/inventory`, `src/pages/api/products/index.ts` → `/api/products`, `src/pages/api/products/[id].ts` → `/api/products/:id`
- React component file naming follows kebab-case dot suffix: `inventory-panel.tsx`
- `cn()` from `@/lib/utils` for Tailwind class merging; `Button` from `@/components/ui/button`

## What We're NOT Doing

- No product editing (PRD Non-Goal: delete + re-add is the correction flow)
- No quantity or unit tracking (PRD Non-Goal)
- No search, filter, or sort controls (PRD Non-Goal — natural order only)
- No empty-state animation or skeleton loading — a text placeholder suffices
- No optimistic updates for the add form (wait for server confirmation before showing the row)
- No server-sent events or polling — list reflects the last fetch only
- No migration changes — F-01 schema is complete

## Implementation Approach

Two phases: Phase 1 establishes the API surface (service + endpoints) independently testable before any UI exists. Phase 2 wires the React island and page. The React island receives `initialProducts` server-rendered as props to avoid a loading flash on page load; subsequent mutations (add/delete) hit the JSON API and update local state.

## Critical Implementation Details

**At-risk window placement**: `AT_RISK_DAYS = 3` and `isAtRisk(expiryDate: string): boolean` live exclusively in `src/lib/services/product.service.ts`. API routes and the inventory page call the service — they never re-implement the window check. S-02 will import `AT_RISK_DAYS` directly from this service.

**Date comparison**: `expiry_date` is stored as `YYYY-MM-DD`. The `isAtRisk` function computes `today.toISOString().split('T')[0]` and `threshold` the same way, then compares ISO strings lexicographically — no timezone-aware Date math needed.

**user_id on insert**: The products table has no `DEFAULT` for `user_id`; the INSERT must supply it explicitly. The API route extracts `context.locals.user.id` and passes it to `createProduct`.

---

## Phase 1: Product service + API routes

### Overview

Install Zod, create the product service with the at-risk helper, expose three JSON endpoints (GET list, POST create, DELETE by id), and remove the stale product handler stub.

### Changes Required:

#### 1. Install Zod

**File**: `package.json` (via `npm install zod`)

**Intent**: Add Zod as a runtime dependency so API routes can validate request bodies. Run `npm install zod` before writing any API route that imports it.

**Contract**: `zod` appears in `dependencies` in `package.json`.

#### 2. Add `ProductWithRisk` to shared types

**File**: `src/types.ts`

**Intent**: Extend the existing `Product` type with a computed `is_at_risk` flag that the service adds server-side. The React island receives `ProductWithRisk[]` and never needs to re-derive at-risk status.

**Contract**: Add after the existing `NewProduct` type:
```typescript
export type ProductWithRisk = Product & { is_at_risk: boolean };
```

#### 3. Product service

**File**: `src/lib/services/product.service.ts` (new file)

**Intent**: Single location for all product business logic — at-risk constant, at-risk predicate, and the three DB operations. Keeps API routes thin and makes `AT_RISK_DAYS` importable by S-02.

**Contract**:
- Export `AT_RISK_DAYS: number = 3`
- Export `isAtRisk(expiryDate: string): boolean` — returns true if `expiryDate` (YYYY-MM-DD) ≤ today + AT_RISK_DAYS days; uses ISO string comparison
- Export `listProducts(supabase): Promise<ProductWithRisk[]>` — selects all products ordered by `expiry_date ASC`, maps each row through `isAtRisk`; throws on DB error
- Export `createProduct(supabase, userId: string, data: NewProduct): Promise<ProductWithRisk>` — inserts `{user_id: userId, name, expiry_date}`, returns the inserted row with `is_at_risk` appended; throws on DB error
- Export `deleteProduct(supabase, productId: string): Promise<void>` — deletes by `id`; throws with a "not found" message if `count === 0`

#### 4. GET + POST `/api/products`

**File**: `src/pages/api/products/index.ts` (new file)

**Intent**: List all products (GET) and add a new one (POST). Both handlers guard against unauthenticated requests and a missing Supabase client.

**Contract**:
- `export const prerender = false`
- `GET`: null-check `createClient` → 503; check `context.locals.user` → 401; call `listProducts`; return `{ products }` JSON 200
- `POST`: parse JSON body; Zod schema validates `name` (non-empty string ≤ 255 chars) and `expiry_date` (YYYY-MM-DD regex, must be ≥ today's ISO string); on validation error return 400 `{ error }`; call `createProduct`; return 201 `{ product }`

The Zod `expiry_date` refinement:
```typescript
expiry_date: z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
  .refine(val => val >= new Date().toISOString().split('T')[0], "Expiry date must be today or in the future")
```

#### 5. DELETE `/api/products/[id]`

**File**: `src/pages/api/products/[id].ts` (new file)

**Intent**: Delete a single product by its UUID. RLS ensures the row belongs to the authenticated user — no explicit ownership check needed beyond auth guard.

**Contract**:
- `export const prerender = false`
- `DELETE`: null-check `createClient` → 503; check `context.locals.user` → 401; extract `context.params.id`; call `deleteProduct`; return 204 on success, 404 `{ error }` if service threw "not found"

#### 6. Remove stale product handler

**File**: `src/product/product.handler.ts` (delete)

**Intent**: The file contains stub functions with non-PRD fields (`quantity`, `unit`). It is not imported anywhere in production code and is superseded by the new service.

**Contract**: File is deleted; no imports of this file exist anywhere.

### Success Criteria:

#### Automated Verification:

- Zod installed: `npm ls zod` shows a version
- TypeScript compilation passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `curl -X POST http://localhost:4321/api/products` with a valid JSON body and a valid session cookie returns 201 with the new product including `is_at_risk`
- `curl http://localhost:4321/api/products` (authenticated) returns `{ products: [...] }` sorted by `expiry_date ASC`
- `curl -X DELETE http://localhost:4321/api/products/<id>` (authenticated) returns 204; second call on the same id returns 404
- Unauthenticated request to any endpoint returns 401

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Inventory UI + page wiring

### Overview

Install the shadcn `alert-dialog` component, create the React island that manages add/delete with inline error handling, create the `/inventory` page that server-renders the initial product list, protect the new route in middleware, and add an inventory link to the dashboard.

### Changes Required:

#### 1. Install shadcn `alert-dialog`

**File**: `src/components/ui/alert-dialog.tsx` (created by shadcn CLI)

**Intent**: Provides the confirm dialog for the delete flow. Install with `npx shadcn@latest add alert-dialog`.

**Contract**: `@radix-ui/react-alert-dialog` added to `package.json`; `src/components/ui/alert-dialog.tsx` exists and exports `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel`.

#### 2. Inventory React island

**File**: `src/components/inventory/inventory-panel.tsx` (new file)

**Intent**: Full inventory UI as a client island — renders the add form, the product list with at-risk badges, and a confirm dialog for delete. Manages all mutation state locally after hydration.

**Contract**:
- Props: `initialProducts: ProductWithRisk[]`
- Local state: `products: ProductWithRisk[]` (initialized from props), `addError: string | null`, `deleteError: string | null`, `isSubmitting: boolean`, `pendingDeleteId: string | null`
- **Add form**: two inputs (`name` text, `expiry_date` date with `min` set to today's YYYY-MM-DD), a submit button disabled while `isSubmitting`; on submit POST to `/api/products` with `Content-Type: application/json`; on success GET `/api/products` to re-fetch the full sorted list and replace `products` with the result, then reset the form; on error set `addError`
- **Product list**: renders `products` in order (already sorted server-side); each row shows `name`, formatted `expiry_date`, an amber "At risk" badge when `is_at_risk === true`, and a trash icon delete button
- **Delete flow**: clicking delete sets `pendingDeleteId` and opens the `AlertDialog`; confirming calls `DELETE /api/products/:id`; on success filter the product out of `products`; on error set `deleteError`; cancelling clears `pendingDeleteId`
- Empty state: when `products.length === 0`, show a text message "No products yet — add one above"
- Errors (`addError`, `deleteError`) render as inline text near the relevant UI section; cleared on the next user action

**At-risk badge**: a `<span>` with amber Tailwind classes (e.g., `bg-amber-100 text-amber-800 text-xs font-medium px-2 py-0.5 rounded`) — no shadcn Badge needed.

#### 3. Inventory page

**File**: `src/pages/inventory.astro` (new file)

**Intent**: SSR page that fetches the initial product list server-side and passes it to the React island as props, avoiding a client-side loading flash.

**Contract**:
- Frontmatter: call `createClient(Astro.request.headers, Astro.cookies)`; if null, `initialProducts = []`; otherwise call `listProducts(supabase)` and assign the result; wrap in try/catch and fall back to `[]` on error
- Template: `<Layout title="My Inventory">` wrapping `<InventoryPanel initialProducts={initialProducts} client:load />`

#### 4. Add `/inventory` to protected routes

**File**: `src/middleware.ts`

**Intent**: The middleware already handles auth checks for `PROTECTED_ROUTES`; adding `/inventory` ensures unauthenticated users are redirected to sign-in.

**Contract**: `PROTECTED_ROUTES` array contains both `"/dashboard"` and `"/inventory"`.

#### 5. Add inventory link to dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: The dashboard is the landing page after sign-in; users need a way to reach `/inventory`. A simple link button is sufficient.

**Contract**: Add an `<a href="/inventory">` link (styled as a button using existing Tailwind classes consistent with the page) below the current welcome text.

### Success Criteria:

#### Automated Verification:

- TypeScript compilation passes: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Visiting `/inventory` while unauthenticated redirects to `/auth/signin`
- After sign-in, `/inventory` loads and shows the product list (initially empty or with existing rows)
- Adding a product with a valid name and future date adds it to the list immediately; the at-risk badge appears for dates ≤ today+3
- Adding a product with a past date shows a validation error from the server (inline, no page reload)
- Adding a product with an empty name shows a validation error inline
- Clicking the delete icon on a product opens the confirm dialog; confirming removes the row; cancelling leaves the list unchanged
- Dashboard shows the "Go to inventory" link; clicking it navigates to `/inventory`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next change.

---

## Testing Strategy

### Manual Testing Steps:

1. Start dev server: `npm run dev`
2. Sign in and navigate to `/inventory`
3. Add a product expiring in 5 days — no at-risk badge
4. Add a product expiring in 2 days — amber "At risk" badge visible
5. Add a product with today's date — amber "At risk" badge visible
6. Try adding a product with yesterday's date — inline error from server
7. Try adding a product with an empty name — inline error from server
8. Delete the 5-day product: confirm dialog appears; confirm removes the row
9. Cancel delete on the 2-day product: list unchanged
10. Sign out; visit `/inventory` directly — redirected to sign-in

## Migration Notes

No migration required — F-01 schema is complete.

## References

- Roadmap: `context/foundation/roadmap.md` — S-01 spec and at-risk risk note
- PRD: `context/foundation/prd.md` — FR-004, FR-005, FR-006, Non-Goals
- F-01 plan (archived): `context/archive/2026-05-31-data-schema/plan.md` — schema contract
- Auth API pattern: `src/pages/api/auth/signin.ts`
- Supabase client: `src/lib/supabase.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Product service + API routes

#### Automated

- [x] 1.1 Zod installed: `npm ls zod` shows a version — 03839e6
- [x] 1.2 TypeScript compilation passes: `npm run build` — 03839e6
- [x] 1.3 Linting passes: `npm run lint` — 03839e6

#### Manual

- [x] 1.4 POST /api/products (authenticated) returns 201 with `is_at_risk` — 03839e6
- [x] 1.5 GET /api/products (authenticated) returns sorted product list — 03839e6
- [x] 1.6 DELETE /api/products/:id returns 204; second call returns 404 — 03839e6
- [x] 1.7 Unauthenticated requests return 401 — 03839e6

### Phase 2: Inventory UI + page wiring

#### Automated

- [x] 2.1 TypeScript compilation passes: `npm run build` — 9208d8c
- [x] 2.2 Linting passes: `npm run lint` — 9208d8c

#### Manual

- [x] 2.3 `/inventory` unauthenticated redirects to sign-in — 9208d8c
- [x] 2.4 Product list loads on `/inventory` after sign-in — 9208d8c
- [x] 2.5 Add product with future date — row appears, at-risk badge shows for ≤3-day items — 9208d8c
- [x] 2.6 Add product with past date — inline error, no page reload (verified via curl: server returns 400 with inline error message) — 9208d8c
- [x] 2.7 Add product with empty name — inline validation error (verified via curl) — 9208d8c
- [x] 2.8 Delete with confirm — row removed; cancel — list unchanged — 9208d8c
- [x] 2.9 Dashboard inventory link navigates to `/inventory` — 9208d8c
