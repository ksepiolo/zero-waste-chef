# Data Schema — Plan Brief

> Full plan: `context/changes/data-schema/plan.md`

## What & Why

Create the `products` and `recipes` tables in Supabase with Row Level Security so that every user's data is isolated at the database layer. This is F-01 — the foundation all other slices (S-01, S-02, S-03) depend on. Nothing can ship until this lands.

## Starting Point

The Supabase client and auth flow are complete. `supabase/migrations/` exists but is empty — no tables have ever been created. `src/types.ts` does not exist yet.

## Desired End State

Two tables live in the remote Supabase project, each scoped by `user_id` with RLS enforcing per-row isolation. `src/types.ts` exports the shared type vocabulary (`Product`, `Recipe`, and their insert DTOs) that S-01 and S-02 can import immediately. No Docker setup required to get here.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Recipe→products link | JSONB snapshot `consumed_products` in `recipes` | Products are hard-deleted at approval; snapshot survives and preserves waste-prevention context for history | Plan |
| Recipe content storage | `title TEXT` + `instructions TEXT` (two columns) | Separate fields let the history screen render titles without parsing raw AI output | Plan |
| Expiry date type | `DATE` | At-risk window is a date comparison; timestamp adds timezone complexity with no benefit | Plan |
| User cascade | `ON DELETE CASCADE` | No orphaned rows; no cleanup job; PRD has no account-recovery requirement | Plan |
| Product name uniqueness | No constraint | Two cartons of milk are two separate products; a constraint would cause confusing errors | Plan |
| Anon RLS | Explicit `USING (false)` on all operations | CLAUDE.md prohibits implicit deny; explicit policies are mandatory per project convention | Plan |
| TypeScript types | Hand-written in `src/types.ts` with insert DTOs | CLAUDE.md mandates `src/types.ts`; `NewProduct`/`NewRecipe` give API routes clean insert contracts | Plan |
| Migration verification | `supabase db push` → remote only | No local Docker for MVP; deadline is 2026-06-07 | Plan |

## Scope

**In scope:**
- `products` table: `id`, `user_id`, `name`, `expiry_date`, `created_at`
- `recipes` table: `id`, `user_id`, `title`, `instructions`, `consumed_products`, `created_at`
- Composite indexes: `products(user_id, expiry_date ASC)`, `recipes(user_id, created_at DESC)`
- RLS: 8 policies per table (SELECT/INSERT/UPDATE/DELETE × authenticated + anon)
- `src/types.ts`: `Product`, `NewProduct`, `ConsumedProduct`, `Recipe`, `NewRecipe`

**Out of scope:**
- Seed data (no local Docker for MVP — add test data via Supabase dashboard)
- `quantity`, `unit`, `category` columns (PRD non-goals)
- `recipe_products` join table (JSONB snapshot is sufficient)
- Supabase generated types (`supabase gen types`) — hand-written is enough

## Architecture / Approach

Single SQL migration file applied directly to the remote Supabase project via `supabase db push`. Both tables reference `auth.users(id)` for the RLS anchor (`auth.uid() = user_id`). No application-layer isolation — the DB enforces it. TypeScript types are hand-derived from the schema in Phase 2 and live in `src/types.ts` as the single type source for all slices.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. SQL Migration | Both tables, indexes, all 16 RLS policies applied to remote | `supabase link` must be run first; skipping it will make `db push` fail |
| 2. TypeScript Types | `src/types.ts` with full row types + insert DTOs | Types must stay in sync with schema manually — no auto-generation |

**Prerequisites:** Supabase CLI authenticated (`npx supabase login`); remote project reachable  
**Estimated effort:** ~1 session (1–2 hours)

## Open Risks & Assumptions

- `supabase link --project-ref aojqrsssylptdmkkuhnl` must succeed before `db push` — if the CLI isn't authenticated, this blocks Phase 1
- If the remote schema ever diverges from `src/types.ts` (e.g., a column is renamed), TypeScript won't catch it — manual sync required until Supabase generated types are adopted

## Success Criteria (Summary)

- `npx supabase db push` exits 0 and both tables appear in the remote Supabase dashboard with RLS enabled
- `npm run build` passes with `src/types.ts` in place
- A logged-in user can only read their own rows — confirmed via SQL editor isolation check
