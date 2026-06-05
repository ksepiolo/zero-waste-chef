# Inventory Management — Plan Brief

> Full plan: `context/changes/inventory-management/plan.md`

## What & Why

Build S-01: a logged-in user can add products (name + expiry date), view their full list with at-risk badges for items expiring within 3 days, and delete any product via a confirm dialog — all on a new `/inventory` route. This closes the "visibility gap" from the PRD: the home screen immediately shows what needs to be used before it goes to waste.

## Starting Point

F-01 is complete: the `products` table exists in Supabase with RLS, and `Product`/`NewProduct` types are in `src/types.ts`. The dashboard is a skeleton (welcome + signout), auth is fully wired, and there is no product API or UI yet.

## Desired End State

`/inventory` renders a sorted product list (expiry date ASC) where at-risk products carry an amber "At risk" badge. Users add products via an inline form without page reloads; invalid dates (past) and empty names are rejected with inline errors. A confirm dialog guards every delete. The 3-day at-risk constant lives in one place — `src/lib/services/product.service.ts` — so S-02 can import it without re-implementing the logic.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Route location | New `/inventory` page | Dashboard may grow beyond inventory later | Plan |
| UX interaction model | React island + JSON fetch | No page reloads; follows existing React island pattern | Plan |
| At-risk indicator | Inline amber badge per row | Keeps natural date-sorted order; immediate per-item signal | Plan |
| Delete UX | Confirm dialog (shadcn AlertDialog) | Prevents accidental deletes; adds minimal scope | Plan |
| Past date validation | Reject expiry_date < today (server Zod) | Keeps inventory meaningful; past-expired items are waste not at-risk | Plan |
| Error display | Inline in React component | Consistent with fetch-based model; no page reload on error | Plan |
| At-risk logic location | `product.service.ts` (single source) | Roadmap risk note: must not be duplicated; S-02 depends on same constant | Roadmap |

## Scope

**In scope:**
- `GET /api/products`, `POST /api/products`, `DELETE /api/products/[id]` JSON endpoints
- `src/lib/services/product.service.ts` with `AT_RISK_DAYS`, `isAtRisk`, `listProducts`, `createProduct`, `deleteProduct`
- `ProductWithRisk` type added to `src/types.ts`
- `src/pages/inventory.astro` — SSR page with server-rendered initial product list
- `src/components/inventory/inventory-panel.tsx` — React island
- Middleware update: add `/inventory` to `PROTECTED_ROUTES`
- Dashboard update: add link to `/inventory`
- Install: `zod`, shadcn `alert-dialog`
- Delete: `src/product/product.handler.ts` (stale stub)

**Out of scope:**
- Product editing (PRD Non-Goal)
- Quantity tracking (PRD Non-Goal)
- Search/filter/sort controls (PRD Non-Goal)
- Notifications or polling
- Schema changes (F-01 complete)

## Architecture / Approach

Two-layer: Phase 1 is pure backend (service + 3 JSON endpoints, independently curl-testable). Phase 2 is the UI layer — a React island hydrated `client:load` with server-rendered `initialProducts` props to avoid loading flash. All mutations go through the JSON API; local React state reflects the result. At-risk computation happens server-side in the service before data reaches the client.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Product service + API | GET list, POST create, DELETE — curl-testable | `user_id` must be supplied on INSERT (no DB default) |
| 2. Inventory UI + page wiring | `/inventory` page with add form, list, delete confirm | shadcn alert-dialog install must complete before component can use it |

**Prerequisites:** F-01 done (products table + types) ✓; dev server runnable (`npm run dev`)
**Estimated effort:** ~1-2 sessions across 2 phases

## Open Risks & Assumptions

- Timezone handling: `isAtRisk` uses `new Date().toISOString().split('T')[0]` for "today" — this is UTC. If the user is in a timezone behind UTC, "today" server-side may differ from the user's local date by one day. Acceptable for MVP.
- Cloudflare Workers: all new code runs in the Workers runtime. No Node.js-only APIs used (Zod and Supabase JS are Workers-compatible).

## Success Criteria (Summary)

- A product with a 2-day expiry appears on `/inventory` with an amber "At risk" badge without page reload after adding
- Deleting a product via the confirm dialog removes it from the list immediately
- An unauthenticated visit to `/inventory` redirects to sign-in
