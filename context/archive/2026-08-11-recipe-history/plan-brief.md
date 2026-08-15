# Recipe History — Plan Brief

> Full plan: `context/changes/recipe-history/plan.md`

## What & Why

Recipes are currently written but never read back. S-02 built the whole generate → approve → save path, and every approved recipe lands in the `recipes` table where nothing ever looks at it. This slice adds `/recipes`: a read-only, newest-first list of the user's approved recipes, each expandable to its full ingredients, steps and the products it consumed. It satisfies **FR-010** and closes roadmap slice **S-03**.

## Starting Point

The database side is already done. F-01 created the `recipes` table with `title`, `ingredients TEXT[]`, `instructions TEXT`, `consumed_products JSONB` and `created_at`, full per-operation RLS, and — notably — the index `recipes_user_created_idx ON recipes(user_id, created_at DESC)`, which is exactly the query FR-010 needs. The `Recipe` type already exists in `src/types.ts`. What's missing is entirely app-layer: no read service function, no GET endpoint, no page, no route protection, no navigation link.

## Desired End State

A signed-in user reaches "Recipe history" from the dashboard or the inventory page and sees their approved recipes newest-first, 20 per page. Clicking a row expands it to the full recipe — ingredients, numbered steps, and the names of the products it used up. Previous/Next page through longer histories. Users with no recipes get an explanatory empty state; signed-out visitors are redirected to sign-in.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| List content | Full content, collapsed by default | The PRD parks "separate recipe detail page" as a non-goal on the grounds that content is visible in the list, so the list has to actually carry it. |
| Page architecture | React island, SSR-seeded | Matches the existing `InventoryPanel` pattern and is required anyway once pagination is interactive. |
| Volume handling | Offset pagination, 20 per page | Scales indefinitely without truncating; also the payload guard, since each entry carries a full recipe body. |
| Paging mechanics | `.range()` + `count: "exact"` | An exact count is cheap on a user-scoped indexed table and lets the UI show position and disable Next correctly. |
| Page-1 delivery | Server-rendered into props | First paint has content with no client round-trip; only Prev/Next hit the API. |
| Page state location | React state, not the URL | The island owns it and no other surface needs to deep-link to a page. |
| Navigation | Links on dashboard + inventory | Puts history one click from where recipes are approved, without a shared-nav refactor. |
| Scope | Strictly read-only | FR-010 asks only to view; the roadmap flags S-03 as the first slice to cut under deadline pressure. |
| Migration | None | The schema and its newest-first index already fit the slice exactly. |

## Scope

**In scope:**

- `listRecipes` service function (paged, `user_id`-filtered)
- `GET /api/recipes?page=N` endpoint
- `/recipes` page + `recipe-history-panel.tsx` island with expand and pagination
- `/recipes` added to `PROTECTED_ROUTES`
- Entry links on the dashboard and inventory pages

**Out of scope:**

- Delete recipe, "cook again", search/filter, separate detail page (all PRD non-goals or unrequested)
- Any database migration
- Changes to the generate/approve paths (S-02 is archived)
- Shared-navigation refactor (`Topbar.astro` stays as-is)
- Feeding historical titles into the AI prompt's `excludeTitles`

## Architecture / Approach

```
recipes.astro (SSR)  ──listRecipes(supabase, userId, 1)──►  Supabase
      │ props: { recipes, total }                             (recipes_user_created_idx)
      ▼
RecipeHistoryPanel (client:load)
      │ Prev/Next only
      ▼
GET /api/recipes?page=N ──listRecipes(supabase, userId, N)──► Supabase
```

One service function serves both the page and the endpoint. The service and endpoint follow the existing `product.service.ts` / `api/products/index.ts` shapes exactly; the page follows `inventory.astro`'s SSR-into-island pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | `listRecipes` + `GET /api/recipes` + paged type | Forgetting the app-layer `.eq("user_id", …)` filter that `lessons.md` mandates alongside RLS |
| 2. UI and navigation | `/recipes` page, island, route protection, entry links | `instructions` is newline-joined TEXT, not an array — rendering steps requires splitting it back |

**Prerequisites:** S-02 (`recipe-generation-loop`) — done and archived. At least one approved recipe in the database to verify against; more than 20 to exercise pagination.

**Estimated effort:** ~1 session across 2 phases. This is the smallest slice on the roadmap — no migration, no AI, no mutations.

## Open Risks & Assumptions

- **`consumed_products` can legitimately be an empty array.** The `approve_recipe` RPC coalesces a NULL aggregate to `'[]'` when no matching products remain at approval time. The UI must treat that as an absent section, not an error.
- **`consumed_products` is a one-way snapshot.** The underlying `products` rows are deleted in the same transaction, so the JSONB cannot be joined back and is the only surviving record of what a recipe consumed.
- **No test runner exists in this repo.** Verification is `typecheck` / `lint` / `build` plus the manual steps; standing up a framework is out of scope here (and is Module 3's territory).
- **Pagination is untestable without volume.** Exercising Prev/Next honestly needs 21+ approved recipes, which means seeding rather than approving by hand.

## Success Criteria (Summary)

- A user can see every recipe they've approved, newest first, and read it in full without leaving the list.
- The history is reachable in one click from both the dashboard and the inventory page, and is closed to signed-out visitors.
- A user's recipes are visible only to them — enforced by RLS *and* an app-layer `user_id` filter.
