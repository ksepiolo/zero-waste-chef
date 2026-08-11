# Recipe Generation Loop — Plan Brief

> Full plan: `context/changes/recipe-generation-loop/plan.md`
> Research: `context/changes/recipe-generation-loop/research.md` + `rgp-research.md`

## What & Why

Implement S-02 (recipe generation loop): a logged-in user with expiring products can generate an AI recipe that uses those products, review the full recipe in an approval modal, and confirm — at which point the recipe is saved and the used products are removed from inventory in one atomic DB operation. The feature closes the core zero-waste loop: identify at-risk food → generate a recipe → act on it.

## Starting Point

The `recipes` table exists but has no `ingredients` column and no `approve_recipe` PostgreSQL function. No OpenRouter integration, no toast system, no recipe service or endpoints, and no React hook layer exists yet. The `listProducts()` service and `AlertDialog` component are reusable as-is.

## Desired End State

A "Generate Recipe" button appears below the product list whenever at-risk products exist. Clicking it calls OpenRouter (Gemini 2.0 Flash) and after a few seconds an approval modal opens showing the full recipe — title, ingredients, numbered steps — and the exact products to be removed. The user can Cancel (idle again), generate a different recipe, or Approve. On Approve the recipe is saved and the products disappear from the list in one transaction.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| AI model | `google/gemini-2.0-flash-001` | Cheapest model with reliable `json_schema` strict mode support | Research |
| Response format | `json_schema` strict + `propertyOrdering` | Guarantees all fields present; `propertyOrdering` required by Gemini 2.0 | Research |
| Temperature | 0.4 | Enough variation per run, low enough to respect the constraint system prompt | Research |
| Few-shot | 1 user/assistant pair | Google docs state zero-shot not preferred for Gemini | Research |
| Atomicity | `approve_recipe` plpgsql function via `supabase.rpc()` | PostgREST has no transaction API; only the DB function guarantees insert + delete as one unit | Research |
| Modal content | Full recipe card (title + ingredients + instructions + products to remove) | User needs to see what they're committing to before an irreversible action | Plan |
| Error UX | Sonner toast | Needs to be visible regardless of scroll position; inline would be hidden below a long product list | Plan |
| Regenerate | "Generate Different Recipe" button in modal | Explicit affordance; better than silent Cancel + re-click | Plan |
| Approve button | Plain `Button`, not `AlertDialogAction` | `AlertDialogAction` closes the dialog immediately; we need the modal open during the async RPC | Plan |
| CPU guard | `limits.cpu_ms: 5000` in `wrangler.jsonc` | Shipping the generate endpoint without a guard leaves billing exposed on the free tier | Plan |

## Scope

**In scope:**
- DB migration: `ingredients TEXT[]` column + `approve_recipe` plpgsql function
- New `recipe.service.ts` (OpenRouter call + Zod validation + UUID guardrail)
- New `POST /api/recipes/generate` and `POST /api/recipes/approve` endpoints
- New `useRecipeGeneration` hook (first hook in the codebase — creates `src/components/hooks/`)
- "Generate Recipe" button + 3-button approval modal in `inventory-panel.tsx`
- Sonner toast installation + `<Toaster>` in `Layout.astro`
- `OPENROUTER_API_KEY` env declaration + `.dev.vars.example` entry
- `limits.cpu_ms: 5000` in `wrangler.jsonc`

**Out of scope:**
- Recipe history/list page
- Streaming AI response
- Separate `/recipe/approve` route
- Database-generated TypeScript types
- Retry logic on AI failure

## Architecture / Approach

Two endpoints (`/generate`, `/approve`) stay intentionally separate: generation is the expensive AI path, approval is pure I/O. The React hook encapsulates both fetch calls and their loading states; the component only handles rendering. The `instructions: string[]` → `TEXT` join happens exactly once in the approve endpoint. The atomic approve flow runs entirely inside Postgres via `SECURITY INVOKER` + `auth.uid()` guards — satisfying the lessons.md rule at the DB level rather than the service layer.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Foundation | Env var, types, migration, Sonner, CPU guard | Migration conflicts if run against a DB with existing `ingredients` column |
| 2. Backend | `recipe.service.ts`, generate + approve endpoints | OpenRouter auth failure or UUID guardrail rejecting valid IDs |
| 3. UI | Hook + button + approval modal | AlertDialog controlled-open pattern; 3-button modal layout in shadcn footer |

**Prerequisites:** Local Supabase running (`npx supabase start`); `OPENROUTER_API_KEY` available in `.dev.vars`; CF Workers Paid plan for production deployment.  
**Estimated effort:** ~2–3 implementation sessions across 3 phases.

## Open Risks & Assumptions

- OpenRouter `google/gemini-2.0-flash-001` availability: if the model is unavailable, fallback to `openai/gpt-4o-mini` (same json_schema support, slightly higher cost)
- Sonner `npx shadcn@latest add sonner` generates compatible component — verify against installed shadcn version after running
- CF Workers Paid plan required before shipping the generate endpoint to production (free tier 10 ms CPU limit is borderline)

## Success Criteria (Summary)

- "Generate Recipe" button appears when at-risk products exist, is hidden when none exist
- Full recipe approval modal shows and all three actions work correctly
- After Approve: recipe saved in Supabase, used products removed from inventory in one atomic operation
