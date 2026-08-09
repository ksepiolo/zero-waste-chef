# Recipe Generation Loop — Implementation Plan

## Overview

Implement S-02: a "Generate Recipe" button in the inventory panel calls OpenRouter (Gemini 2.0 Flash, `json_schema` strict mode) using the current user's at-risk products as input, returns a full recipe, displays an approval modal, and on approval, atomically snapshots products, inserts the recipe, and removes the used products via a single PostgreSQL RPC call.

## Current State Analysis

- `recipes` table has no `ingredients` column; `instructions` is `TEXT NOT NULL` (single string, not array)
- No `approve_recipe` PostgreSQL function exists; no existing migrations define any functions
- `OPENROUTER_API_KEY` not declared in `astro.config.mjs` env.schema or `.dev.vars.example`
- `Recipe` interface in `src/types.ts` has no `ingredients` field; `NewRecipe` derives from it via `Omit`
- No toast system installed; `src/components/ui/` has only `alert-dialog.tsx` and `button.tsx`
- `src/components/hooks/` directory does not exist
- No recipe service, generate endpoint, or approve endpoint

**Key existing assets:**
- `src/lib/services/product.service.ts` — `listProducts(supabase, userId)` already attaches `is_at_risk: boolean`; filter directly, no duplication
- `src/components/ui/alert-dialog.tsx` — installed and used for delete confirm; approval modal follows the same pattern
- `src/components/inventory/inventory-panel.tsx` — product list here; `addError`/`deleteError` + `isSubmitting` state patterns exist to mirror
- `zod ^4.4.3` — already installed; `lucide-react` already installed (`Loader2` icon for spinner)

## Desired End State

A logged-in user with at-risk products sees a "Generate Recipe" button below the product list. Clicking it calls OpenRouter and after ~5–15 seconds a recipe appears in an approval modal. The modal shows the full recipe (title, ingredient list, numbered steps) and the exact products that will be removed. Three footer actions: **Cancel** (returns to idle), **Generate Different Recipe** (closes modal, starts a new AI call), **Approve** (modal stays open, shows "Approving..." spinner, on success removes products from the list and closes the modal). Errors (API failure, UUID guardrail violation) surface as Sonner toast notifications. The "Generate Recipe" button disappears when no at-risk products remain.

### Key Decisions

- **Modal**: full recipe card — title + ingredients + numbered instructions + products to be removed
- **Loading UX**: button disabled + "Generating…" + `Loader2` spinner while `isGenerating`
- **Error UX**: Sonner toast (`toast.error`) — install via `npx shadcn@latest add sonner`
- **Regenerate**: explicit "Generate Different Recipe" button in modal footer (3-button modal)
- **Approve UX**: regular `Button` (not `AlertDialogAction`) — keeps modal open during async, closes on success by clearing `recipe` state
- **CPU guard**: `limits.cpu_ms: 5000` added to `wrangler.jsonc` in this change

## What We're NOT Doing

- Recipe history or list page (PRD §Non-Goals)
- Streaming AI responses (full recipe required before approval screen can render)
- Separate `/recipe/approve` page route
- Database-generated TypeScript types (`supabase gen types`)
- Retry logic on OpenRouter failure (user retries via "Generate Different Recipe")
- Ingredients search or filtering in the UI
- Handling concurrent deletes between generate and approve (V1 known limitation: if a product is deleted in another tab while the approval modal is open, its name disappears from "Will remove" but the RPC silently saves a partial snapshot with no error surfaced)

## Implementation Approach

**Foundation first, then top-down by layer.** Phase 1 fixes the three incompatibilities (env var, type, migration) and installs the toast system and CPU guard — everything Phase 2 imports must exist first. Phase 2 adds the service and endpoints, testable via curl without any UI. Phase 3 wires the React layer last. This ordering isolates breakage: if Phase 2 has an AI integration bug, Phase 3 isn't touched yet.

## Critical Implementation Details

**`instructions` type boundary**: The AI returns `instructions: string[]`; the DB stores `instructions TEXT`. The join (`instructions.join('\n')`) happens exactly once — in `approve.ts` before the RPC call. The service returns `string[]`, the hook stores `string[]`, the modal renders `string[]`. Only the approve endpoint converts.

**`approve` button keeps the dialog open**: The Approve button is a plain shadcn `Button` (not `AlertDialogAction`) so the dialog stays open while the RPC is in flight. On `onApproveSuccess`, the hook calls `setRecipe(null)` which closes the dialog via the `open={recipe !== null}` controlled prop. On error, the button re-enables and a toast fires — the user can retry without reopening.

**UUID cross-validation placement**: The semantic UUID guardrail (verify all returned product IDs are in the original at-risk list) lives in `recipe.service.ts`, not in the endpoint. The endpoint receives an already-validated `GeneratedRecipe`.

**`approve_recipe` return typing**: No generated Database types in this project. Chain `.returns<string>()` after `.rpc()` so `data` is typed as `string | null` rather than `unknown`.

**Three-button modal layout**: `AlertDialogFooter` is `flex-col-reverse sm:flex-row sm:justify-end`. Render order for desktop left-to-right: Cancel → Generate Different Recipe → Approve. Cancel uses `AlertDialogCancel`; Generate Different uses `AlertDialogAction`; Approve uses plain `Button`.

---

## Phase 1: Foundation

### Overview

Fix the three preflight incompatibilities, install Sonner, apply the DB migration, and add the CPU guard. After this phase the codebase compiles cleanly with the new types and the `approve_recipe` function exists in the local Supabase instance. No new API routes yet.

### Changes Required

#### 1.1 OPENROUTER_API_KEY env declaration

**File**: `astro.config.mjs`

**Intent**: Declare the OpenRouter API key in the Astro env schema so it's importable via `astro:env/server`. Without this, any file that imports the key causes a build error.

**Contract**: Add `OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` to the `env.schema` object alongside `SUPABASE_URL` and `SUPABASE_KEY`. `optional: true` is consistent with the existing two vars and prevents CI build failures when the key isn't configured.

#### 1.2 OPENROUTER_API_KEY dev vars example

**File**: `.dev.vars.example`

**Intent**: Document the key for local Cloudflare dev parity with the existing `SUPABASE_URL`/`SUPABASE_KEY` entries.

**Contract**: Append `OPENROUTER_API_KEY=sk-or-v1-...` as a new line.

#### 1.3 Type additions to src/types.ts

**File**: `src/types.ts`

**Intent**: Add `ingredients: string[]` to `Recipe` (so `NewRecipe` inherits it automatically) and add the new `GeneratedRecipe` interface (the AI output DTO shared between the service, hook, and component).

**Contract**:
- `Recipe`: add `ingredients: string[]` between `title` and `instructions`. `NewRecipe = Omit<Recipe, "id" | "user_id" | "created_at">` requires no change.
- New interface after `NewRecipe`:

```typescript
export interface GeneratedRecipe {
  title: string;
  ingredients: string[];
  instructions: string[]; // array from AI; joined with '\n' only in approve endpoint
  used_product_ids: string[];
}
```

#### 1.4 DB migration

**File**: `supabase/migrations/20260607120000_approve_recipe.sql`

**Intent**: Add the `ingredients` column to `recipes` and create the `approve_recipe` plpgsql function. The function is the only atomic path for recipe insert + product delete — no client-side transaction is possible via PostgREST.

**Contract**: Three SQL statements in order:

1. `ALTER TABLE public.recipes ADD COLUMN ingredients TEXT[] NOT NULL DEFAULT '{}'`

2. `CREATE OR REPLACE FUNCTION public.approve_recipe(p_title TEXT, p_ingredients TEXT[], p_instructions TEXT, p_used_product_ids UUID[]) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER` — full body from `rgp-research.md` Finding 7:
   - Snapshots product `{name, expiry_date}` into `v_consumed_products JSONB` with `AND user_id = auth.uid()` guard
   - Inserts into `recipes` with `auth.uid()` as `user_id`
   - Deletes from `products` with `AND user_id = auth.uid()` guard
   - Returns the new `recipe.id`

3. `GRANT EXECUTE ON FUNCTION public.approve_recipe(TEXT, TEXT[], TEXT, UUID[]) TO authenticated`

Apply locally: `npx supabase db reset` (resets and re-applies all migrations).

#### 1.5 Sonner toast installation

**Files**: `src/components/ui/sonner.tsx` (generated) + `src/layouts/Layout.astro`

**Intent**: Install the toast system required for error UX. Sonner is the shadcn-native solution; no manual component authoring needed.

**Contract**:
1. Run `npx shadcn@latest add sonner` — creates `src/components/ui/sonner.tsx`
2. In `Layout.astro`: import `Toaster` from `@/components/ui/sonner` and render `<Toaster client:load />` inside `<body>` before `<slot />`

#### 1.6 Cloudflare Workers CPU limit

**File**: `wrangler.jsonc`

**Intent**: Cap Worker CPU time at 5 seconds to prevent runaway billing when the generate endpoint is deployed. Required per `rgp-research.md` Finding 6 before the endpoint ships to production.

**Contract**: Add `"limits": { "cpu_ms": 5000 }` as a top-level key in the existing JSON object.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes with no errors on modified files
- `npm run lint` passes on all modified files
- Migration applies cleanly: `npx supabase db reset` exits 0

#### Manual Verification

- Supabase Studio shows `recipes.ingredients TEXT[]` column on the `recipes` table
- `approve_recipe` function visible under Database → Functions in Supabase Studio
- `src/components/ui/sonner.tsx` exists after shadcn install
- Browser devtools on any page shows no console errors related to `Toaster`

---

## Phase 2: Backend

### Overview

Create `recipe.service.ts` with the full OpenRouter integration (all Finding 8–12 enhancements applied) and the two API endpoints. After this phase both endpoints are curl-testable with a valid session cookie from the running dev server.

### Changes Required

#### 2.1 recipe.service.ts

**File**: `src/lib/services/recipe.service.ts`

**Intent**: Encapsulate the full OpenRouter call — system prompt, few-shot, schema, validation, and semantic ID guardrail — so the endpoint contains only routing logic. Importing `GeneratedRecipe` from `src/types.ts`.

**Contract**: Export `async function generateRecipe(atRiskProducts: ProductWithRisk[]): Promise<GeneratedRecipe>`.

The function:
- Builds `productList` string: `"${p.name} (id: ${p.id})"` joined by `", "`
- POSTs to `https://openrouter.ai/api/v1/chat/completions` with:
  - `model: 'google/gemini-2.0-flash-001'`
  - `temperature: 0.4` (Finding 10)
  - `messages`: [system (4-block prompt, Finding 8), few-shot user/assistant pair (Finding 11), actual user turn]
  - `response_format`: `json_schema` strict mode + `propertyOrdering: ['title', 'ingredients', 'instructions', 'used_product_ids']` (Finding 1 + Finding 9)
  - `plugins: [{ id: 'response-healing' }]` (Finding 3)
- Throws `Error(\`OpenRouter ${status}: ${text}\`)` on non-ok HTTP
- `JSON.parse(data.choices[0].message.content)` — note: content is a JSON string even in json_schema mode
- Validates with `GeneratedRecipeSchema` (inline Zod schema, Finding 12):
  ```typescript
  const GeneratedRecipeSchema = z.object({
    title: z.string().min(1),
    ingredients: z.array(z.string()).min(1),
    instructions: z.array(z.string()).min(1),
    used_product_ids: z.array(z.string().uuid()).min(1),
  });
  ```
- Cross-checks all `used_product_ids` are in `new Set(atRiskProducts.map(p => p.id))`; throws `Error('Model returned unknown product IDs — inventory guardrail violated')` on violation (Finding 12)
- Returns the validated object

**System prompt** (4-block, Finding 8):
```
You are a practical home-cooking assistant. Rules:
- Techniques: use only sauté, boil, roast, bake, simmer, fry, stir-fry. Never: sous-vide, fermentation, dehydrating, smoking, pressure cooking.
- Equipment: assume stovetop, oven, one pot, one pan, knife, cutting board. No specialty appliances.
- Time: total recipe time (prep + cook) must not exceed 45 minutes.
- Pantry staples are always available: salt, pepper, oil, water, basic dried spices.
- Never ask follow-up questions. Always generate a recipe immediately.
- used_product_ids must contain only UUID strings from the list provided. Never invent or omit IDs.
```

**Few-shot pair** (Finding 11): one user/assistant exchange with placeholder UUIDs `aaa-bbb-111`/`ccc-ddd-222` demonstrating correct UUID passthrough and compact format.

#### 2.2 /api/recipes/generate.ts

**File**: `src/pages/api/recipes/generate.ts`

**Intent**: Authenticated POST endpoint that fetches at-risk products for the current user and delegates AI generation to `generateRecipe()`. All AI logic stays in the service.

**Contract**:
```
export const prerender = false
export async function POST(context: APIContext): Promise<Response>
```

Flow:
1. `createClient(context.request.headers, context.cookies)` → null → 503 `"Service unavailable"`
2. `context.locals.user` → null → 401 `{ error: "Unauthorized" }`
3. `listProducts(supabase, user.id)` → filter `p.is_at_risk` → if empty → 400 `{ error: "No at-risk products" }`
4. `await generateRecipe(atRiskProducts)` in try/catch → catch: 500 `{ error: err.message }`
5. 200 `{ recipe }` — the `GeneratedRecipe` object

#### 2.3 /api/recipes/approve.ts

**File**: `src/pages/api/recipes/approve.ts`

**Intent**: Authenticated POST endpoint that validates the recipe body and calls the `approve_recipe` Supabase RPC. Contains the sole `instructions.join('\n')` conversion.

**Contract**:
```
export const prerender = false
export async function POST(context: APIContext): Promise<Response>
```

Zod body schema (inline, parse body with `z.object({ title, ingredients, instructions, usedProductIds })`):
- `title: z.string().min(1)`
- `ingredients: z.array(z.string()).min(1)`
- `instructions: z.array(z.string()).min(1)` — joined to string before RPC
- `usedProductIds: z.array(z.string().uuid()).min(1)`

Parse error → 400 `{ error: parseError.message }`.

RPC call:
```typescript
const { data, error } = await supabase
  .rpc('approve_recipe', {
    p_title: body.title,
    p_ingredients: body.ingredients,
    p_instructions: body.instructions.join('\n'),
    p_used_product_ids: body.usedProductIds,
  })
  .returns<string>();
```

Return 200 `{ id: data }` on success; 500 `{ error: error.message }` on RPC error.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes
- `npm run lint` passes
- Both endpoint files exist: `src/pages/api/recipes/generate.ts`, `src/pages/api/recipes/approve.ts`

#### Manual Verification

- `POST /api/recipes/generate` with valid session cookie returns 200 with `{ recipe: { title, ingredients, instructions, used_product_ids } }` when at-risk products exist
- `POST /api/recipes/generate` returns 400 `{ error: "No at-risk products" }` when no at-risk products exist
- `POST /api/recipes/approve` with valid auth + recipe body returns 200 `{ id: "uuid" }`
- Supabase dashboard shows new row in `recipes` with `ingredients` populated, `instructions` as a `\n`-joined string, and `consumed_products` as a non-empty JSON array of `{name, expiry_date}` for the used products
- Products referenced in `usedProductIds` are deleted from `products` table (verify in Supabase Studio)
- Both endpoints return 401 with no auth cookie

---

## Phase 3: UI

### Overview

Create the `use-recipe-generation` hook (first hook in the codebase, creates `src/components/hooks/`), then modify `inventory-panel.tsx` to add the Generate button and the three-action approval modal.

### Changes Required

#### 3.1 use-recipe-generation.ts

**File**: `src/components/hooks/use-recipe-generation.ts`

**Intent**: Encapsulate the generate/approve fetch calls and their loading states so the component only handles rendering. The hook exposes typed state and three actions; errors are re-thrown for the component to handle via `toast.error`.

**Contract**:

```typescript
export function useRecipeGeneration(options?: {
  onApproveSuccess?: (usedProductIds: string[]) => void;
}): {
  isGenerating: boolean;
  isApproving: boolean;
  recipe: GeneratedRecipe | null;
  generate: () => Promise<void>;
  approve: () => Promise<void>;
  reset: () => void;
}
```

`generate()`:
- Sets `isGenerating = true`, clears any existing `recipe`
- `POST /api/recipes/generate` (no body)
- On non-ok: throws `Error(json.error ?? 'Failed to generate recipe')`
- On success: sets `recipe` to the returned `GeneratedRecipe`
- `finally`: sets `isGenerating = false`

`approve()`:
- Captures current `recipe` in a local const (safe across async boundary)
- Sets `isApproving = true`
- `POST /api/recipes/approve` with `{ title, ingredients, instructions, usedProductIds: recipe.used_product_ids }`
- On non-ok: throws `Error(json.error ?? 'Failed to approve recipe')`
- On success: calls `options?.onApproveSuccess?.(capturedRecipe.used_product_ids)`, then sets `recipe = null`
- `finally`: sets `isApproving = false`

`reset()`: sets `recipe = null` (returns to idle without starting a new generation).

All three functions use `useCallback`; state managed with `useState`.

#### 3.2 inventory-panel.tsx modifications

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Add the Generate button (conditional on at-risk products) and the recipe approval modal (conditional on `recipe !== null`) to the existing panel. Wire the hook so approved recipes remove their products from local state.

**Contract**:

**Imports to add**: `useRecipeGeneration` from `@/components/hooks/use-recipe-generation`; `GeneratedRecipe` from `@/types`; `toast` from `sonner`; `Loader2` from `lucide-react`; additional AlertDialog sub-components already imported (`AlertDialogAction` is present; verify all needed variants are imported).

**Hook initialization** at top of component:
```typescript
const { isGenerating, isApproving, recipe, generate, approve, reset } = useRecipeGeneration({
  onApproveSuccess: (usedIds) =>
    setProducts((prev) => prev.filter((p) => !usedIds.includes(p.id))),
});
```

**Error handling wrappers** — inline async handlers:
```typescript
const handleGenerate = async () => {
  try { await generate(); }
  catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to generate recipe'); }
};
const handleApprove = async () => {
  try { await approve(); }
  catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save recipe'); }
};
```

**Generate button** — rendered after the product list `<ul>`, inside the panel container, visible only when `products.some((p) => p.is_at_risk)`:
```tsx
{products.some((p) => p.is_at_risk) && (
  <Button
    onClick={() => void handleGenerate()}
    disabled={isGenerating || isApproving}
    className="mt-4 w-full"
  >
    {isGenerating ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Generating...
      </>
    ) : (
      "Generate Recipe"
    )}
  </Button>
)}
```

**Recipe approval modal** — a second `AlertDialog` (separate from the delete dialog), placed after the existing AlertDialog:

```tsx
<AlertDialog open={recipe !== null} onOpenChange={(open) => { if (!open) reset(); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{recipe?.title}</AlertDialogTitle>
    </AlertDialogHeader>

    {/* Ingredients */}
    <ul className="list-disc pl-5 text-sm space-y-1">
      {recipe?.ingredients.map((ing, i) => <li key={i}>{ing}</li>)}
    </ul>

    {/* Instructions */}
    <ol className="list-decimal pl-5 text-sm space-y-1 mt-2">
      {recipe?.instructions.map((step, i) => <li key={i}>{step}</li>)}
    </ol>

    {/* Products to be removed */}
    <AlertDialogDescription className="mt-3">
      Will remove from inventory:{" "}
      {products
        .filter((p) => recipe?.used_product_ids.includes(p.id))
        .map((p) => p.name)
        .join(", ")}
    </AlertDialogDescription>

    <AlertDialogFooter>
      <AlertDialogCancel onClick={reset}>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => void handleGenerate()}>
        Generate Different Recipe
      </AlertDialogAction>
      <Button
        onClick={() => void handleApprove()}
        disabled={isApproving}
      >
        {isApproving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Approving...
          </>
        ) : (
          "Approve"
        )}
      </Button>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Note: "Generate Different Recipe" uses `AlertDialogAction` (closes dialog on click); generation immediately restarts and the modal re-opens when the new recipe arrives. The Approve button is a plain `Button` — the dialog stays open during the async, closes on success when `recipe` is set to null.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes
- `npm run lint` passes
- `src/components/hooks/use-recipe-generation.ts` exists

#### Manual Verification

- "Generate Recipe" button visible below product list only when ≥1 at-risk product exists
- "Generate Recipe" button not visible when no at-risk products exist
- Button shows `Loader2` spinner + "Generating..." and is disabled during generation
- Approval modal appears with: recipe title as heading, full ingredient list, numbered instruction steps, product names to be removed
- Cancel closes modal; product list unchanged; Generate button re-enabled
- "Generate Different Recipe" closes modal, button shows "Generating..." again, new recipe modal opens
- Approve shows "Approving..." on the button, modal stays open during RPC call
- After successful Approve: modal closes, used products disappear from product list
- If no at-risk products remain after Approve, Generate button also disappears
- Toast appears on generate error (e.g., disconnect from OpenRouter)
- Toast appears on approve error (e.g., network failure during RPC)
- No console errors during the happy path

---

## Testing Strategy

### Manual Testing Steps

1. Add 2+ products with expiry dates within 3 days → at-risk badge appears + Generate button appears
2. Click Generate → button shows spinner for several seconds → modal opens with full recipe
3. Verify modal shows: title, ingredient list (quantities included), numbered steps, product names
4. Click Cancel → modal closes, products unchanged, Generate button re-enabled
5. Click Generate again → new recipe arrives (may differ from first)
6. Click "Generate Different Recipe" in modal → modal closes, new generation starts, new recipe appears
7. Click Approve → "Approving..." spinner on button → modal closes → used products gone from list
8. If all at-risk products were used, Generate button disappears
9. Test error path: disconnect network, click Generate → toast with error message appears

### Integration Verification

- Supabase Studio: after Approve, confirm `recipes` row has `ingredients` array, `instructions` as `\n`-joined string, `consumed_products` as JSON snapshot
- Supabase Studio: confirm deleted product IDs no longer in `products` table
- Supabase Studio: confirm `consumed_products` snapshot is correct even after products are deleted (snapshot taken before DELETE, in same transaction)

## Performance Considerations

- OpenRouter call (5–15 s wall time) consumes zero CF Workers CPU (network I/O exempt). Total CPU per generate request: ~3–6 ms.
- `limits.cpu_ms: 5000` in `wrangler.jsonc` is a safety ceiling, not a binding constraint for this endpoint under normal conditions.
- Paid CF Workers plan required for production (free tier hard limit is 10 ms CPU).

## Migration Notes

`ALTER TABLE ... ADD COLUMN ... DEFAULT '{}'` is non-breaking: existing rows get an empty array, no data backfill needed. The `approve_recipe` function is a new object with no existing callers.

## References

- Research: `context/changes/recipe-generation-loop/research.md`
- AI research: `context/changes/recipe-generation-loop/rgp-research.md`
- RPC docs: `context/changes/recipe-generation-loop/supabase-rpc-docs.md`
- Existing product service: `src/lib/services/product.service.ts`
- Existing panel: `src/components/inventory/inventory-panel.tsx`
- Existing migration: `supabase/migrations/20260531120000_initial_schema.sql`
- Lessons: `context/foundation/lessons.md` — `auth.uid()` guards in `approve_recipe` satisfy the app-layer user_id rule at the DB level

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Foundation

#### Automated

- [x] 1.1 `npm run typecheck` passes with no errors on modified files
- [x] 1.2 `npm run lint` passes on all modified files
- [x] 1.3 Migration applies cleanly: `npx supabase db reset` exits 0

#### Manual

- [x] 1.4 Supabase Studio shows `recipes.ingredients TEXT[]` column
- [x] 1.5 `approve_recipe` function visible in Supabase Studio under Database → Functions
- [x] 1.6 `src/components/ui/sonner.tsx` exists after shadcn install
- [x] 1.7 Browser shows no console errors related to `Toaster` on any page

### Phase 2: Backend

#### Automated

- [x] 2.1 `npm run typecheck` passes — 66b9996
- [x] 2.2 `npm run lint` passes — 66b9996
- [x] 2.3 Both endpoint files exist at correct paths — 66b9996

#### Manual

- [x] 2.4 `POST /api/recipes/generate` returns 200 with recipe JSON when at-risk products exist — 66b9996
- [x] 2.5 `POST /api/recipes/generate` returns 400 when no at-risk products — 66b9996
- [x] 2.6 `POST /api/recipes/approve` returns 200 `{ id: uuid }` with valid auth + body — 66b9996
- [x] 2.7 Supabase Studio shows new recipe row with `ingredients` populated, `instructions` as a `\n`-joined string, and `consumed_products` as a non-empty JSON array of `{name, expiry_date}` for the used products — 66b9996
- [x] 2.8 Used products deleted from `products` table after approve call — 66b9996
- [x] 2.9 Both endpoints return 401 with no auth cookie — 66b9996

### Phase 3: UI

#### Automated

- [x] 3.1 `npm run typecheck` passes
- [x] 3.2 `npm run lint` passes
- [x] 3.3 `src/components/hooks/use-recipe-generation.ts` exists

#### Manual

- [x] 3.4 "Generate Recipe" button visible only when ≥1 at-risk product exists
- [x] 3.5 Button shows spinner + "Generating..." and is disabled during generation
- [x] 3.6 Approval modal shows title, ingredient list, numbered steps, products to remove
- [x] 3.7 Cancel closes modal; product list unchanged; Generate button re-enabled
- [x] 3.8 "Generate Different Recipe" closes modal and starts new generation
- [x] 3.9 Approve shows "Approving..." spinner; modal stays open during RPC; closes on success
- [x] 3.10 Used products removed from product list after successful Approve
- [x] 3.11 Toast appears on generate error
- [x] 3.12 Toast appears on approve error
- [x] 3.13 No console errors on the happy path
