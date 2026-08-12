# Recipe History Implementation Plan

## Overview

Give the user a `/recipes` page listing their previously approved recipes, newest first, 20 per page. Each entry shows title and date at a glance and expands to reveal the full ingredients, cooking steps and the products the recipe consumed. Read-only — no delete, no re-cook, no search.

This is slice **S-03** in `context/foundation/roadmap.md`, satisfying **FR-010** ("A user can view a list of previously generated and approved recipes", must-have).

## Current State Analysis

Recipes are written but never read back. `/10x` slice S-02 (`context/archive/2026-06-05-recipe-generation-loop/`) built the full write path — generate → approve → atomically save the recipe and delete the consumed products — but nothing in the app ever queries the `recipes` table. Every column the history view needs is already populated and currently unread.

What exists:

- **`recipes` table** (`supabase/migrations/20260531120000_initial_schema.sql:50-57`, extended at `supabase/migrations/20260607120000_approve_recipe.sql:1`) with `id`, `user_id`, `title`, `ingredients TEXT[]`, `instructions TEXT`, `consumed_products JSONB`, `created_at TIMESTAMPTZ`.
- **The exact index this slice needs**: `recipes_user_created_idx ON recipes(user_id, created_at DESC)` (`20260531120000_initial_schema.sql:62`), created in F-01 specifically to support `SELECT * FROM recipes WHERE user_id = $1 ORDER BY created_at DESC`.
- **Full RLS coverage** on `recipes` — per-operation policies for `authenticated` (own rows via `auth.uid() = user_id`) and explicit `USING (false)` denials for `anon` (`20260531120000_initial_schema.sql:64-92`).
- **Types**: `Recipe` and `ConsumedProduct` in `src/types.ts:13-26`, already matching the table shape.
- **`recipe.service.ts`** with `generateRecipe` and `approveRecipe` — but **no read function**.

What is missing:

- No `listRecipes` service function.
- No `GET /api/recipes` endpoint (`src/pages/api/recipes/` holds only `generate.ts` and `approve.ts`, both POST).
- No `/recipes` page, and no entry for it in `PROTECTED_ROUTES` (`src/middleware.ts:4` lists only `/dashboard`, `/inventory`).
- No navigation surface. `Topbar.astro` links only Dashboard and is not rendered by `Layout.astro`; `inventory.astro` has no navigation at all; `dashboard.astro:17` hardcodes a single "Go to Inventory" link.

Key constraint discovered: **`instructions` is a single TEXT column, not an array.** `approveRecipe` joins the AI's `string[]` with `"\n"` at `src/lib/services/recipe.service.ts:172` — described there as the "sole conversion point". The read path must therefore split on `\n` to render steps, and `Recipe.instructions` is correctly typed `string` (not `string[]`) at `src/types.ts:23`.

## Desired End State

A signed-in user can reach "Recipe history" from both the dashboard and the inventory page, and sees their approved recipes ordered newest-first. Each row shows the recipe title and the date it was approved; clicking a row expands it to the full ingredient list, numbered cooking steps, and the names of the products it consumed. With more than 20 recipes, Previous/Next controls page through them and the current position is shown. A user with no approved recipes sees an explanatory empty state rather than a blank page. A signed-out visitor to `/recipes` is redirected to sign-in.

Verify by: signing in as a user with at least one approved recipe, navigating to `/recipes`, expanding an entry and confirming the ingredients, steps and consumed products match what the approval modal showed at approval time; then signing out and confirming `/recipes` redirects.

### Key Discoveries:

- No migration is needed — table, columns and the newest-first index all exist (`supabase/migrations/20260531120000_initial_schema.sql:50-62`).
- `instructions` is newline-joined TEXT, joined at `src/lib/services/recipe.service.ts:172`; the read path must split it.
- `consumed_products` is a **snapshot** written by the `approve_recipe` RPC (`supabase/migrations/20260607120000_approve_recipe.sql:13-17`). The underlying `products` rows are deleted in the same transaction, so this JSONB is the only surviving record of what the recipe consumed. It cannot be joined back to `products`.
- `consumed_products` defaults to `'[]'::JSONB` and the RPC `COALESCE`s a NULL aggregate to `'[]'` (`20260607120000_approve_recipe.sql:20`) — so it is never NULL, but **can legitimately be an empty array** if the used products vanished between generation and approval.
- Lessons rule (`context/foundation/lessons.md:5-10`): every service function reading user-owned rows must take `userId` and chain `.eq("user_id", userId)` alongside RLS. `listProducts` (`src/lib/services/product.service.ts:17`) is the reference implementation.
- The API-route shape is uniform across `src/pages/api/products/index.ts` and `src/pages/api/recipes/{generate,approve}.ts`: `prerender = false`, null-check `createClient`, 503 on missing client, 401 on missing `context.locals.user`, zod-validate, 400 on validation failure, try/catch to 500.
- `inventory.astro:10-17` is the reference SSR-into-island pattern: create the client, guard on both `supabase` and `Astro.locals.user`, call the service in a try/catch that degrades to an empty list, pass the result as a prop to a `client:load` React component.

## What We're NOT Doing

- **No delete-recipe UI or endpoint.** FR-010 covers viewing only; the RLS delete policy exists but stays unused.
- **No "cook again" / re-approve flow.** The consumed products are gone, so re-approval has no coherent semantics.
- **No search or filtering.** Parked in the PRD Non-Goals (`context/foundation/roadmap.md:138`).
- **No separate recipe detail page or route.** Parked in the PRD Non-Goals (`context/foundation/roadmap.md:141`) — recipe content is visible in the list itself, which is precisely why entries expand.
- **No database migration.** The schema is already correct for this slice.
- **No changes to the generate or approve paths.** S-02 is archived and closed.
- **No shared-navigation refactor.** `Topbar.astro` stays as it is and stays out of `Layout.astro`; entry links are added inline to the two pages that need them.
- **No linking of history back into the generation prompt** (e.g. excluding historical titles from AI suggestions). `excludeTitles` remains session-scoped as built in S-02.

## Implementation Approach

Two phases, data layer then UI, so the read path can be verified independently of the rendering.

The data layer follows the existing service + endpoint split exactly: a `listRecipes` function in `recipe.service.ts` next to `approveRecipe`, and a `GET` handler in a new `src/pages/api/recipes/index.ts` mirroring the structure of `src/pages/api/products/index.ts`.

Paging is **offset-based** using PostgREST's `.range()` combined with `count: "exact"`. The exact count is cheap here — it is scoped to one user and served by `recipes_user_created_idx` — and returning the total lets the UI render the current position and disable Next at the last page, which a fetch-one-extra-row trick cannot do.

The page hydrates **page 1 from SSR**: `recipes.astro` calls `listRecipes` server-side and passes the first page plus the total as props, so first paint has content without a client round-trip. Only Previous/Next navigation calls `GET /api/recipes?page=N`. Page position lives in React state, not the URL — the island owns it, and no other surface needs to link to a specific page.

**This is a deliberate consistency choice with a known cost.** Keeping the page number out of the URL is the only reason `GET /api/recipes` exists at all: with `<a href="/recipes?page=N">` links and `Astro.url.searchParams`, the page would server-render every page and the endpoint, its validator, and the island's fetch / loading / error states would all be unnecessary (expansion alone is achievable with `<details name>`). We are paying that machinery to keep `/recipes` built the same way as `InventoryPanel` — the pattern every other interactive surface in this repo follows — and to get instant page turns instead of a full navigation. Accepted consequences: pages are not bookmarkable or shareable, and the browser Back button does not step through page history.

## Critical Implementation Details

**Instructions round-trip.** `approveRecipe` writes `instructions` as a single string joined with `"\n"` (`src/lib/services/recipe.service.ts:172`); the history view must split it back on `"\n"` to render numbered steps. Split at render time in the component — do not add a transform in the service, which would make `listRecipes` return something other than the `Recipe` type the table actually holds.

**Empty `consumed_products` is valid, not an error.** The `approve_recipe` RPC coalesces a NULL aggregate to `'[]'::JSONB` when no matching products remain at approval time (`supabase/migrations/20260607120000_approve_recipe.sql:20`). The UI must render an empty array as an absent section, not as a crash or a stray "Used:" label with nothing after it.

---

## Phase 1: Data layer — paged recipe reads

### Overview

Add the server-side read path: a paged, user-scoped service function and the `GET` endpoint the island will call for pages beyond the first.

### Changes Required:

#### 1. Paged-response type

**File**: `src/types.ts`

**Intent**: Give the service and the endpoint a shared return shape carrying both the page of rows and the total count, so the UI can compute page position without a second request.

**Contract**: Add `RecipePage` — `{ recipes: Recipe[]; total: number }`. Also export the page size as a named constant so the service, the endpoint validator and the UI all agree on it: `export const RECIPES_PAGE_SIZE = 20;` **in this file**, next to `RecipePage`.

The constant must **not** live in `recipe.service.ts`. That module imports `OPENROUTER_API_KEY` from `astro:env/server` (`src/lib/services/recipe.service.ts:3`), and Astro throws `ServerOnlyModule` — "The astro:env/server module is only available server-side" — whenever that virtual module is loaded in the client environment (`node_modules/astro/dist/env/vite-plugin-env.js:65-70`). The client island in Phase 2 needs `RECIPES_PAGE_SIZE`, so importing it from the service would fail the build and, were it to slip through, put a secret-access key in the client bundle. `src/types.ts` has no runtime imports at all, so it is safe from both environments.

#### 2. `listRecipes` service function

**File**: `src/lib/services/recipe.service.ts`

**Intent**: Read one page of the signed-in user's recipes, newest first, so the page and endpoint have a single query to share.

**Contract**: `listRecipes(supabase: SupabaseClient, userId: string, page: number): Promise<RecipePage>`, where `page` is 1-based. Select from `recipes` with `{ count: "exact" }`, chain `.eq("user_id", userId)` per the lessons rule at `context/foundation/lessons.md:5`, order by `created_at` descending, and apply `.range()` for the requested page. Throw `new Error(error.message)` on failure and treat a null `count` as `0`, matching how `listProducts` (`src/lib/services/product.service.ts:20`) surfaces errors. Import `RECIPES_PAGE_SIZE` from `@/types` — do not redeclare it here (see §1).

A page beyond the end of the data returns an empty `recipes` array with the true `total` — PostgREST does not error on an out-of-range `.range()`. The UI treats that as the last page rather than an error.

#### 3. `GET /api/recipes` endpoint

**File**: `src/pages/api/recipes/index.ts` (new)

**Intent**: Expose the paged read to the client island so Previous/Next can fetch without a full page reload.

**Contract**: `export const prerender = false;` and a `GET: APIRoute` following the established shape in `src/pages/api/products/index.ts:16-35` — 503 when `createClient` returns null, 401 when `context.locals.user` is absent, then the service call in a try/catch returning 500 with the error message. Parse `page` from `context.url.searchParams` with zod, rejecting failures with 400 and the first issue message (`result.error.issues[0]?.message`, as in `src/pages/api/products/index.ts:55`). Success responds 200 with the `RecipePage` body and `Content-Type: application/json`.

The schema and its input, exactly:

```ts
const pageSchema = z.coerce.number().int().min(1, "Page must be 1 or greater").max(1000, "Page is out of range").default(1);
// Normalize null → undefined: searchParams.get returns null when absent, and
// z.coerce runs Number(null) === 0, which fails min(1) and would 400 the
// bare GET /api/recipes (criterion 1.6). Only undefined triggers .default().
const result = pageSchema.safeParse(context.url.searchParams.get("page") ?? undefined);
```

The `max(1000)` cap rejects with 400 rather than clamping, so a hand-crafted `?page=99999999` cannot push a pointless large offset at the database and the caller is told the request was wrong instead of silently getting page 1000.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- `GET /api/recipes` returns 401 when called without a session cookie
- `GET /api/recipes?page=0` and `?page=abc` return 400

#### Manual Verification:

- Signed in, `GET /api/recipes` returns the user's recipes newest-first with a correct `total`
- With more than 20 recipes, `?page=2` returns the next 20 and the same `total`
- A second user's session sees only their own recipes at the same URL

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: UI and navigation — history page, island, entry points

### Overview

Render the history at `/recipes` as an SSR page feeding a React island, protect the route, and add the two entry links.

### Changes Required:

#### 1. Route protection

**File**: `src/middleware.ts`

**Intent**: Stop signed-out visitors reaching the history page, matching how `/dashboard` and `/inventory` are handled.

**Contract**: Add `"/recipes"` to the `PROTECTED_ROUTES` array at `src/middleware.ts:4`. No other change — the existing `startsWith` check and redirect already cover it.

#### 2. History page

**File**: `src/pages/recipes.astro` (new)

**Intent**: Server-render the first page of recipes and hand it to the island, so the list is present on first paint.

**Contract**: Mirror `src/pages/inventory.astro:1-29` — create the Supabase client from `Astro.request.headers` and `Astro.cookies`, guard on both the client and `Astro.locals.user`, call `listRecipes(supabase, user.id, 1)` in a try/catch, and render `<RecipeHistoryPanel initialPage={…} loadError={…} client:load />` inside `<Layout title="Recipe history">` using the same `bg-cosmic` wrapper and gradient heading treatment as the inventory page.

**Diverge from `inventory.astro` on one point**: the catch must not degrade silently to an empty page. Track a `loadError` boolean — `false` on success, `true` when the client is null, the service throws, or the user guard fails — and pass it to the island alongside `initialPage`. Without it, a transient Supabase failure renders the empty state and tells the user their entire recipe history is gone. That is tolerable for inventory, where a missing product is re-addable in seconds; it is not tolerable here, because `consumed_products` is a one-way snapshot the user cannot reconstruct.

#### 3. History island

**File**: `src/components/recipes/recipe-history-panel.tsx` (new)

**Intent**: Render the list with per-entry expansion and page navigation, fetching later pages from the API.

**Contract**: Props `{ initialPage: RecipePage; loadError: boolean }`. Holds the current `RecipePage`, the 1-based page number, a loading flag, an error string and the id of the expanded entry (single-expand — opening one collapses the other, keeping the list scannable).

Each entry renders title and a human-readable `created_at` date in a row styled like the inventory list items (`src/components/inventory/inventory-panel.tsx:164-190`). Format the date with an **explicit locale and time zone** — `new Date(r.created_at).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })` — never a bare `toLocaleDateString()`. `client:load` means Astro server-renders this island before hydrating it, so an implicit locale resolves to Cloudflare's default on the server and the visitor's on the client, producing a React hydration mismatch and, for a `TIMESTAMPTZ` near midnight, two different calendar days. Pinning both arguments makes the two renders byte-identical. (There is no local precedent to copy: `inventory-panel.tsx` prints the raw `expiry_date` string, and no `toLocale*` call exists anywhere in `src/`.); the row is a `<button>` toggling expansion, carrying `aria-expanded` and controlling the panel via `aria-controls`. The expanded panel renders `ingredients` as a `<ul>`, `instructions.split("\n")` as an `<ol>`, and the `consumed_products` names — omitting the consumed-products block entirely when the array is empty.

Previous/Next buttons appear only when `total > RECIPES_PAGE_SIZE`, are disabled at the respective ends and while loading, and show the current position against `Math.ceil(total / RECIPES_PAGE_SIZE)`. Navigation fetches `/api/recipes?page=N`, replaces the held page on success, and on failure leaves the current page intact while surfacing the error — reuse the `toast.error` pattern from `inventory-panel.tsx:41`, which works because `Layout.astro:23` already mounts the `Toaster`. Collapse any expanded entry when the page changes, so the expansion state cannot point at a row that is no longer rendered.

An empty `recipes` array on page 1 renders an empty state in the style of `inventory-panel.tsx:161` — a muted line explaining that approved recipes will appear here. `loadError` takes precedence over it: when true, render a distinct "Couldn't load your recipes — refresh to try again" line instead, never the empty state. The two must be visually and textually separable, so a failed read is never mistaken for an empty history.

#### 4. Entry links

**Files**: `src/pages/dashboard.astro`, `src/pages/inventory.astro`

**Intent**: Make the page reachable from the dashboard hub and from the inventory page where recipes are approved.

**Contract**: On the dashboard, add a "Recipe history" link to `/recipes` beside the existing "Go to Inventory" anchor (`src/pages/dashboard.astro:17-22`), reusing its classes. On the inventory page, add a link to `/recipes` near the heading (`src/pages/inventory.astro:22-26`) — the inventory page currently has no navigation, so this is a plain inline anchor, not a nav component.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Signed out, `GET /recipes` redirects to `/auth/signin`

#### Manual Verification:

- `/recipes` lists approved recipes newest-first with correct dates
- Expanding an entry shows ingredients, numbered steps and consumed product names matching what was approved
- Expanding a second entry collapses the first
- A recipe with an empty `consumed_products` renders without a stray or broken section
- With more than 20 recipes, Next loads the following page, Previous returns, position is correct and both buttons disable at their respective ends
- With 20 or fewer recipes, no pagination controls appear
- A user with no approved recipes sees the empty state
- "Recipe history" is reachable from both the dashboard and the inventory page
- With the Supabase env vars unset (forcing `createClient` to return null), `/recipes` shows the load-error line, not the empty state

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

The repository has no test runner configured (`package.json` exposes `typecheck`, `lint`, `build` only, and there are no test files under `src/`). Standing up a test framework is out of scope for this slice — verification is the type checker, the linter, the build, and the manual steps below.

### Manual Testing Steps:

1. Sign in as a user with at least one approved recipe; navigate to `/recipes` from the dashboard link.
2. Confirm entries are ordered newest-first and each shows a readable approval date.
3. Expand an entry; confirm the ingredients, steps and consumed products match what the approval modal displayed at approval time.
4. Expand a second entry; confirm the first collapses.
5. Approve a new recipe from `/inventory`, then follow the inventory page's history link and confirm the new recipe is at the top.
6. Seed or approve more than 20 recipes; page forward and back, checking position, content and button disabled states at both ends.
7. Sign out and request `/recipes` directly — confirm the redirect to `/auth/signin`.
8. Sign in as a second user and confirm the first user's recipes are not visible.

## Performance Considerations

The query is served entirely by `recipes_user_created_idx` (`user_id, created_at DESC`) — both the filter and the sort. The `count: "exact"` companion query is scoped to a single user's rows and is not a concern at MVP volumes.

Page 1 is server-rendered, so the common case costs no client round-trip. Because entries carry full ingredient and instruction bodies, the 20-row page size is also the payload guard — it is the reason the list is paged rather than fetched whole.

## Migration Notes

None. No schema change, no data backfill. Existing recipes written by S-02 are immediately visible on deploy — the read path is purely additive, and nothing in this slice writes to the database.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-03
- PRD requirement: `context/foundation/prd.md` — FR-010
- Lessons rule (app-layer `user_id` filter): `context/foundation/lessons.md:5-10`
- Upstream slice (write path): `context/archive/2026-06-05-recipe-generation-loop/plan.md`
- Schema: `supabase/migrations/20260531120000_initial_schema.sql:50-92`
- Approve RPC (source of `consumed_products`): `supabase/migrations/20260607120000_approve_recipe.sql`
- Service pattern to mirror: `src/lib/services/product.service.ts:13-26`
- Endpoint pattern to mirror: `src/pages/api/products/index.ts:16-35`
- SSR-into-island pattern to mirror: `src/pages/inventory.astro:1-29`
- List/empty-state styling to mirror: `src/components/inventory/inventory-panel.tsx:158-210`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — paged recipe reads

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Build succeeds: `npm run build`
- [x] 1.4 `GET /api/recipes` returns 401 without a session cookie
- [x] 1.5 `GET /api/recipes?page=0` and `?page=abc` return 400

#### Manual

- [ ] 1.6 Signed in, `GET /api/recipes` returns recipes newest-first with a correct `total`
- [ ] 1.7 With more than 20 recipes, `?page=2` returns the next 20 and the same `total`
- [ ] 1.8 A second user's session sees only their own recipes at the same URL

### Phase 2: UI and navigation — history page, island, entry points

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Build succeeds: `npm run build`
- [ ] 2.4 Signed out, `GET /recipes` redirects to `/auth/signin`

#### Manual

- [ ] 2.5 `/recipes` lists approved recipes newest-first with correct dates
- [ ] 2.6 Expanding an entry shows ingredients, numbered steps and consumed product names matching approval
- [ ] 2.7 Expanding a second entry collapses the first
- [ ] 2.8 A recipe with empty `consumed_products` renders without a stray or broken section
- [ ] 2.9 Pagination pages forward and back correctly with correct disabled states at both ends
- [ ] 2.10 With 20 or fewer recipes, no pagination controls appear
- [ ] 2.11 A user with no approved recipes sees the empty state
- [ ] 2.12 "Recipe history" is reachable from both the dashboard and the inventory page
- [ ] 2.13 With Supabase env vars unset, `/recipes` shows the load-error line, not the empty state
