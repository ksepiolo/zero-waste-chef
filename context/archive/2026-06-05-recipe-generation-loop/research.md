---
date: 2026-06-07T00:00:00+02:00
researcher: Claude (10x-research)
git_commit: e67d84b0da769e301ad92d320765cbe28c43d4ee
branch: feature/recipe-generation-loop
repository: zero-waste-chef
topic: "S-02 recipe-generation-loop — codebase compatibility with supabase-rpc-docs.md and rgp-research.md"
tags: [research, codebase, recipe-generation, openrouter, supabase-rpc, cloudflare-workers]
status: complete
last_updated: 2026-06-07
last_updated_by: Claude (10x-research)
---

# Research: S-02 Recipe Generation Loop — Codebase Compatibility

**Date**: 2026-06-07  
**Git Commit**: `e67d84b0da769e301ad92d320765cbe28c43d4ee`  
**Branch**: `feature/recipe-generation-loop`

---

## Research Question

Review the codebase and decide whether `supabase-rpc-docs.md` and `rgp-research.md` are compatible with it, ahead of implementing S-02 (recipe generation loop): generate AI recipe → approval screen → approve → products removed.

---

## Summary

Both research documents are **substantially compatible** with the codebase. All schema claims in `rgp-research.md` are confirmed correct. The OpenRouter fetch pattern, Zod usage, and Supabase RPC concepts all apply without modification. However, **three concrete incompatibilities** must be fixed before implementation begins:

1. **`createClient` signature** — both docs show `createClient(cookies)` but the actual function is `createClient(requestHeaders, cookies)`. Every example using `createClient` is wrong in this single detail.
2. **`OPENROUTER_API_KEY` env var is undeclared** — not in `astro.config.mjs` env.schema, not in `.dev.vars.example`. Must be added before any route imports it.
3. **`Recipe` type in `src/types.ts` missing `ingredients`** — the type must gain `ingredients: string[]` before any code references it.

Beyond these fixes, there are **five implementation gaps** (things the docs prescribe but the codebase doesn't have yet): a new migration, two new API endpoints, a new service file, and UI additions to `inventory-panel.tsx`.

---

## Detailed Findings

### A. Database Schema — All Claims Verified

Sub-agent confirmed every schema claim in `rgp-research.md` Finding 7 against `supabase/migrations/20260531120000_initial_schema.sql`:

| Claim | Status | SQL Reference |
|---|---|---|
| `recipes.instructions` is `TEXT NOT NULL` (not `TEXT[]`) | **CONFIRMED** | line 54 |
| `recipes.consumed_products` is `JSONB NOT NULL DEFAULT '[]'` | **CONFIRMED** | line 55 |
| `recipes` table has NO `ingredients` column | **CONFIRMED** | complete table def lines 50–57 |
| `products` columns: id, user_id, name, expiry_date, created_at | **CONFIRMED** | lines 4–10 |
| `approve_recipe` function does NOT exist yet | **CONFIRMED** | no SQL functions in any migration |

The `ConsumedProduct` shape `{name, expiry_date}` in `rgp-research.md` exactly matches `src/types.ts:13-16`.

The migration in `rgp-research.md` Finding 7 is valid SQL and non-breaking: it adds a column with a default, creates a function, and grants EXECUTE. Safe to apply with no data migration.

---

### B. API and Service Layer — Two Incompatibilities Found

#### B1. `createClient` signature mismatch (INCOMPATIBILITY)

**Actual signature** (`src/lib/supabase.ts`):
```typescript
export function createClient(requestHeaders: Headers, cookies: AstroCookies): SupabaseClient | null
```

**`supabase-rpc-docs.md` example** (line 8):
```typescript
const supabase = createClient(cookies);  // ← WRONG: missing requestHeaders
```

**`rgp-research.md` Finding 7 CF Workers call** (line 232):
```typescript
const { data: recipeId, error } = await locals.supabase.rpc(...)  // ← WRONG: no locals.supabase in this codebase
```

**Correct pattern** (from every existing API route in `src/pages/api/`):
```typescript
const supabase = createClient(context.request.headers, context.cookies);
if (!supabase) return new Response("Service unavailable", { status: 503 });
```

This two-argument pattern must be used in all new API routes (`/api/recipes/generate`, `/api/recipes/approve`).

#### B2. `OPENROUTER_API_KEY` undeclared (INCOMPATIBILITY)

`astro.config.mjs` env.schema currently has only `SUPABASE_URL` and `SUPABASE_KEY`. `OPENROUTER_API_KEY` is not declared anywhere. Importing from `astro:env/server` without declaring it in `env.schema` causes a build error.

**Fix required before implementation:**
```typescript
// astro.config.mjs → env.schema
OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
```

Also add to `.dev.vars.example` for documentation parity with `SUPABASE_URL`/`SUPABASE_KEY`.

#### B3. At-risk logic — fully compatible, re-usable as-is

`src/lib/services/product.service.ts` exports:
- `AT_RISK_DAYS = 3` (line 4)
- `isAtRisk(expiryDate: string): boolean` (lines 6–11)
- `listProducts(supabase, userId)` which already attaches `is_at_risk: boolean` to each product (line 24)

The generate endpoint can call `listProducts()` and filter: `products.filter(p => p.is_at_risk)`. No duplication of at-risk logic needed.

#### B4. user_id + RLS discipline — fully compatible

Lessons.md rule ("always pass user_id alongside RLS") is already followed by all existing service functions. The proposed `approve_recipe` PostgreSQL function uses `AND user_id = auth.uid()` in both the SELECT snapshot and the DELETE, which satisfies the lesson's requirement at the database level — stronger than the service-layer `.eq("user_id", userId)` guard. No conflict.

---

### C. `src/types.ts` — Requires Update

Current `Recipe` interface (`src/types.ts:18-24`):
```typescript
export interface Recipe {
  id: string;
  user_id: string;
  title: string;
  instructions: string;          // single string — matches current DB column
  consumed_products: ConsumedProduct[];
  created_at: string;
  // ← NO ingredients field
}
```

After the migration adds `ingredients TEXT[]`, the type must become:
```typescript
export interface Recipe {
  id: string;
  user_id: string;
  title: string;
  ingredients: string[];         // ← ADD
  instructions: string;
  consumed_products: ConsumedProduct[];
  created_at: string;
}
```

`NewRecipe` (`Omit<Recipe, "id" | "user_id" | "created_at">`) will automatically pick up `ingredients` once `Recipe` is updated.

---

### D. UI Integration Points

#### D1. Where the generate button belongs

The product list lives in `src/components/inventory/inventory-panel.tsx`. The component receives `initialProducts: ProductWithRisk[]` as a prop and manages state client-side. The "Generate Recipe" button should be rendered inside this component, visible only when `products.some(p => p.is_at_risk)`.

Existing at-risk badge: amber `bg-amber-100 text-amber-800` inline badge per product (line 148). The button can use the `Button` variant="default" from `src/components/ui/button.tsx`.

#### D2. Approval screen pattern

No recipe UI exists yet. The `AlertDialog` component (`src/components/ui/alert-dialog.tsx`) is already installed and used for the delete confirmation. The recipe approval screen can follow the same pattern: trigger → modal with recipe content + product removal list + confirm/cancel.

The approval UI needs to show exactly what `rgp-research.md` Finding 7 calls "the contract": the recipe and the precise list of products to be removed.

#### D3. `src/components/hooks/` does not exist

The CLAUDE.md convention says "extract hooks to `src/components/hooks/`". This directory must be created when the first hook is added (e.g., `use-recipe-generation.ts`).

#### D4. Server-side data fetching pattern

`src/pages/inventory.astro` fetches products server-side and passes them as `initialProducts` prop to `<InventoryPanel client:load>`. The recipe generate/approve flow is client-initiated (button click → fetch), so the new endpoints will be called from the React component via `fetch()`, not from the Astro page. This matches the existing pattern for add/delete product in `inventory-panel.tsx`.

---

### E. Research Documents Assessment

#### `supabase-rpc-docs.md` — compatible with one fix

Accurate documentation of the Supabase RPC pattern. The only issue is the `createClient(cookies)` call on line 8 — must be `createClient(request.headers, cookies)` per this codebase's actual signature. All other content (`.rpc()` method, parameter naming, `.returns<T>()`, array/JSONB passing) is correct and applicable.

#### `rgp-research.md` — compatible with two fixes

Findings 1–7 are all verified correct against the codebase. Findings 8–12 (system prompt, `propertyOrdering`, temperature, few-shot, Zod validation) are additive enhancements that don't conflict with anything — they should all be applied during implementation.

Two corrections required:
1. **Finding 7 CF Workers call** (`locals.supabase`): replace with `createClient(context.request.headers, context.cookies)` (see B1).
2. **Proposed service shape at bottom**: system prompt is the old single-sentence version — the expanded 4-block system prompt from Finding 8 supersedes it.

The "Correctness check" table at the end of `rgp-research.md` accurately identifies which findings need implementation work — that table is itself a reliable planning input.

---

## Code References

- `supabase/migrations/20260531120000_initial_schema.sql:50-57` — complete `recipes` table definition (no ingredients, TEXT instructions)
- `supabase/migrations/20260531120000_initial_schema.sql:4-10` — `products` table
- `src/lib/supabase.ts` — `createClient(requestHeaders, cookies)` actual signature
- `src/lib/services/product.service.ts:4` — `AT_RISK_DAYS = 3` constant
- `src/lib/services/product.service.ts:6-11` — `isAtRisk()` — re-use, do not duplicate
- `src/lib/services/product.service.ts:13-26` — `listProducts()` — call this and filter `is_at_risk` for generate endpoint
- `src/types.ts:18-24` — `Recipe` interface — needs `ingredients: string[]`
- `src/components/inventory/inventory-panel.tsx:139-168` — product list render — generate button goes here
- `src/components/inventory/inventory-panel.tsx:148` — at-risk badge amber style
- `src/components/ui/button.tsx` — Button component available
- `src/components/ui/alert-dialog.tsx` — AlertDialog available for approval screen
- `src/pages/inventory.astro:1-29` — server-side data fetch pattern to replicate
- `src/pages/api/products/index.ts:17,38` — correct `createClient(context.request.headers, context.cookies)` pattern
- `astro.config.mjs:17-22` — env.schema — `OPENROUTER_API_KEY` must be added here

---

## Architecture Insights

**Two-endpoint design is correct.** `/api/recipes/generate` is the expensive path (OpenRouter call + Zod parse); `/api/recipes/approve` is pure I/O (Supabase RPC). Keeping them separate lets the user review and cancel without committing.

**Non-streaming is correct.** The approval screen needs the full recipe before it can render. Streaming would require a streaming-compatible UI component with no benefit here.

**Atomic approve via PostgreSQL function is the only safe option.** `supabase-js` has no transaction API; two sequential PostgREST calls cannot be atomic. The `approve_recipe` plpgsql function is the right pattern and its `SECURITY INVOKER` + `auth.uid()` guards satisfy the project's RLS discipline.

**`instructions: string[]` → `TEXT` join.** The AI schema returns `instructions` as `string[]` for display purposes. The DB stores it as a single `TEXT`. The service layer must join with `\n` before passing to the RPC. The `Recipe.instructions: string` type stays as-is; the UI can split on `\n` to render steps.

**Zod is already installed** (`zod ^4.4.3`). No new dependency. `GeneratedRecipeSchema` from Finding 12 can be defined in `recipe.service.ts` inline.

---

## Historical Context

- `context/archive/2026-05-31-data-schema/` — F-01: established the current `products` + `recipes` schema with RLS. The `consumed_products JSONB` design (snapshot, not FK) was an intentional choice — it means recipe history survives product deletion. The `approve_recipe` function must preserve this by snapshotting before DELETE.
- `context/foundation/lessons.md` — one rule: "always add app-layer user_id filter alongside RLS on read and delete queries". The `approve_recipe` plpgsql function uses `AND user_id = auth.uid()` on both the snapshot SELECT and the DELETE, which satisfies this rule at the DB level.

---

## Implementation Gap List

The following must be created/modified to implement S-02. This is the complete delta from current codebase to a working feature:

| # | Type | File / Action | Detail |
|---|---|---|---|
| 1 | Fix | `astro.config.mjs` | Add `OPENROUTER_API_KEY` to env.schema |
| 2 | Fix | `.dev.vars.example` | Add `OPENROUTER_API_KEY=` line |
| 3 | Fix | `src/types.ts` | Add `ingredients: string[]` to `Recipe` interface |
| 4 | New migration | `supabase/migrations/<ts>_approve_recipe.sql` | `ALTER TABLE recipes ADD COLUMN ingredients TEXT[]` + `CREATE FUNCTION approve_recipe(...)` + `GRANT EXECUTE` |
| 5 | New file | `src/lib/services/recipe.service.ts` | `generateRecipe(atRiskProducts)` — OpenRouter fetch with Finding 8 system prompt + Finding 9 propertyOrdering + Finding 10 temperature + Finding 11 few-shot + Finding 12 Zod validation |
| 6 | New file | `src/pages/api/recipes/generate.ts` | `POST` — calls `listProducts`, filters at-risk, calls `generateRecipe()`, returns recipe JSON |
| 7 | New file | `src/pages/api/recipes/approve.ts` | `POST` — validates body, calls `supabase.rpc('approve_recipe', ...)`, returns `{id}` |
| 8 | Modify | `src/components/inventory/inventory-panel.tsx` | Add "Generate Recipe" button (visible when at-risk products exist) + recipe approval modal using `AlertDialog` |

---

## Open Questions

1. **Approval screen placement** — inline modal in `inventory-panel.tsx` using `AlertDialog`, or a dedicated `/recipe/approve` page? Modal is simpler and avoids a page navigation. Page allows deep-linking and back-button. Given PRD §Non-Goals parks "separate recipe detail page", modal is the correct default.
2. **`ingredients` instructions display** — the approval screen can split `instructions` on `\n` to render as a numbered list. No schema change needed for display.
3. **Error UX on generate failure** — OpenRouter API down / rate limit. Should surface as inline error (same pattern as `errorMessage` state in `inventory-panel.tsx`, line ~75).
