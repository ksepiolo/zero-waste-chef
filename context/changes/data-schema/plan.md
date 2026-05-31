# Data Schema Implementation Plan

## Overview

Create the Supabase data layer for Zero Waste Chef: `products` and `recipes` tables with Row Level Security, supporting all slices that depend on F-01. Migration is applied directly to the remote Supabase project (no local Docker required for MVP).

## Current State Analysis

- `supabase/migrations/` exists and is empty — clean slate for the first migration
- `src/lib/supabase.ts` uses `@supabase/ssr`; returns `null` without env vars; all callers null-check
- `src/types.ts` does not exist — must be created
- Mock handlers (`src/product/product.handler.ts`) have stale fields (`quantity`, `unit`) that are PRD non-goals — those files are S-01 scope to replace, not touched here
- Auth layer is complete: `auth.uid()` is the natural RLS anchor for all user-scoped data
- Remote Supabase project exists at `aojqrsssylptdmkkuhnl.supabase.co`

## Desired End State

After this plan is complete:
- `products` and `recipes` tables exist in the remote Supabase project with correct columns, indexes, and RLS
- Every user sees and can only modify their own rows — enforced at the database layer, not just in UI
- `src/types.ts` exports `Product`, `NewProduct`, `Recipe`, `NewRecipe`, `ConsumedProduct` — the shared type vocabulary for all slices above F-01
- S-01 and S-02 can begin without any schema changes

### Key Discoveries:

- CLAUDE.md mandates: separate RLS policies per SELECT/INSERT/UPDATE/DELETE per role (authenticated, anon); migration naming `YYYYMMDDHHmmss_short_description.sql`; types in `src/types.ts`
- PRD non-goals: no quantity tracking, no product editing — `quantity` and `unit` must NOT appear in the schema
- Products sort order: `expiry_date ASC` (PRD); recipes sort order: `created_at DESC` (PRD) — both need composite indexes with `user_id`
- `consumed_products` JSONB stores `{name, expiry_date}` per product — products are hard-deleted at recipe approval so FK references would orphan; snapshot survives deletion and preserves the waste-prevention context in recipe history
- `supabase db push` requires prior `supabase link` — see Critical Implementation Details

## What We're NOT Doing

- No local Docker / `supabase db reset` — remote-only for MVP
- No seed data — test data added manually via Supabase dashboard Table Editor
- No `quantity`, `unit`, or `category` columns — PRD non-goals
- No `recipe_products` join table — JSONB snapshot is sufficient and simpler
- No soft-delete on products — hard delete, cascade enforced by FK
- No Supabase generated types (`supabase gen types`) — hand-written types in `src/types.ts` are sufficient and more portable for this scope

## Implementation Approach

Two-phase, remote-first: write the SQL migration locally, push to remote, then export TypeScript types. Phase 2 does not depend on a running database — it is derived from the schema decisions made in Phase 1.

## Critical Implementation Details

**Linking to remote before push**: `supabase db push` will fail without a prior `supabase link`. The project ref is the subdomain of the Supabase URL: `aojqrsssylptdmkkuhnl`. Run `npx supabase login` once to authenticate, then `npx supabase link --project-ref aojqrsssylptdmkkuhnl`. Both commands are one-time setup steps; subsequent pushes need only `supabase db push`.

**Anon RLS policies are explicit DENY**: CLAUDE.md prohibits catch-all policies (`USING (true)`). The anon role must have explicit policies on every operation (`USING (false)` / `WITH CHECK (false)`), not just "no policy" — relying on implicit deny is fragile when Supabase grants change in a future version.

---

## Phase 1: SQL Migration — Tables, Indexes, RLS

### Overview

Create the initial migration file with both tables, composite indexes for the two primary query patterns, and full RLS (8 policies per table: 4 for authenticated, 4 for anon).

### Changes Required:

#### 1. Initial schema migration

**File**: `supabase/migrations/20260531120000_initial_schema.sql`

**Intent**: Define the complete data layer in a single idempotent migration — both tables, their indexes, and all RLS policies. One migration file keeps the schema history atomic and easy to inspect.

**Contract**: The file must produce the following schema when applied:

```sql
-- ============================================================
-- products
-- ============================================================
CREATE TABLE products (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  expiry_date DATE        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Supports: SELECT * FROM products WHERE user_id = $1 ORDER BY expiry_date ASC
-- Also drives the at-risk filter: expiry_date <= CURRENT_DATE + INTERVAL '3 days'
CREATE INDEX products_user_expiry_idx ON products(user_id, expiry_date ASC);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- authenticated: own rows only
CREATE POLICY "products_select_authenticated" ON products
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "products_insert_authenticated" ON products
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "products_update_authenticated" ON products
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "products_delete_authenticated" ON products
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- anon: explicit deny on all operations
CREATE POLICY "products_select_anon" ON products
  FOR SELECT TO anon USING (false);

CREATE POLICY "products_insert_anon" ON products
  FOR INSERT TO anon WITH CHECK (false);

CREATE POLICY "products_update_anon" ON products
  FOR UPDATE TO anon USING (false);

CREATE POLICY "products_delete_anon" ON products
  FOR DELETE TO anon USING (false);


-- ============================================================
-- recipes
-- ============================================================
CREATE TABLE recipes (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title              TEXT        NOT NULL,
  instructions       TEXT        NOT NULL,
  consumed_products  JSONB       NOT NULL DEFAULT '[]'::JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- consumed_products shape per entry: {"name": "Milk", "expiry_date": "2026-06-01"}

-- Supports: SELECT * FROM recipes WHERE user_id = $1 ORDER BY created_at DESC
CREATE INDEX recipes_user_created_idx ON recipes(user_id, created_at DESC);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- authenticated: own rows only
CREATE POLICY "recipes_select_authenticated" ON recipes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "recipes_insert_authenticated" ON recipes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "recipes_update_authenticated" ON recipes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "recipes_delete_authenticated" ON recipes
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- anon: explicit deny on all operations
CREATE POLICY "recipes_select_anon" ON recipes
  FOR SELECT TO anon USING (false);

CREATE POLICY "recipes_insert_anon" ON recipes
  FOR INSERT TO anon WITH CHECK (false);

CREATE POLICY "recipes_update_anon" ON recipes
  FOR UPDATE TO anon USING (false);

CREATE POLICY "recipes_delete_anon" ON recipes
  FOR DELETE TO anon USING (false);
```

### Success Criteria:

#### Automated Verification:

- Supabase CLI is linked: `npx supabase link --project-ref aojqrsssylptdmkkuhnl` exits 0
- Migration applies cleanly: `npx supabase db push` exits 0 with no errors

#### Manual Verification:

- Supabase dashboard → Table Editor shows `products` with columns: `id`, `user_id`, `name`, `expiry_date`, `created_at`
- Supabase dashboard → Table Editor shows `recipes` with columns: `id`, `user_id`, `title`, `instructions`, `consumed_products`, `created_at`
- Both tables show RLS as enabled
- Authentication → Policies shows 8 policies on `products` and 8 on `recipes` (4 authenticated + 4 anon each)
- Quick isolation check: insert a test row via SQL editor (`INSERT INTO products ... VALUES ('00000000-0000-0000-0000-000000000099', ...)`), confirm it is not returned by a SELECT running as a different `auth.uid()`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: TypeScript Types

### Overview

Create `src/types.ts` with the shared type vocabulary for all slices. These types are hand-derived from the Phase 1 schema — they give API routes, service functions, and React components a single source of truth for entity shapes and insert DTOs.

### Changes Required:

#### 1. Shared entity types

**File**: `src/types.ts`

**Intent**: Provide `Product` and `Recipe` as the canonical row shapes, `NewProduct` and `NewRecipe` as insert DTOs (without auto-generated fields), and `ConsumedProduct` as the typed shape for entries in `recipes.consumed_products`.

**Contract**:

```typescript
export type Product = {
  id: string;
  user_id: string;
  name: string;
  expiry_date: string; // ISO date — 'YYYY-MM-DD'
  created_at: string;
};

export type NewProduct = Omit<Product, "id" | "user_id" | "created_at">;

export type ConsumedProduct = {
  name: string;
  expiry_date: string; // ISO date — 'YYYY-MM-DD'
};

export type Recipe = {
  id: string;
  user_id: string;
  title: string;
  instructions: string;
  consumed_products: ConsumedProduct[];
  created_at: string;
};

export type NewRecipe = Omit<Recipe, "id" | "user_id" | "created_at">;
```

### Success Criteria:

#### Automated Verification:

- TypeScript compilation passes: `npm run build` exits 0
- Linting passes: `npm run lint` exits 0

#### Manual Verification:

- Import `Product` from `@/types` in any file; confirm IDE shows all five fields with correct types
- Import `NewProduct`; confirm it exposes only `name` and `expiry_date`

---

## Testing Strategy

### Manual Testing Steps:

1. After `supabase db push`, open Supabase dashboard → SQL Editor
2. Run: `SELECT * FROM products LIMIT 1;` — should return empty (not an error)
3. Run: `SELECT * FROM recipes LIMIT 1;` — should return empty (not an error)
4. Open Table Editor → `products` → RLS tab — confirm 8 policies listed
5. Confirm TypeScript compiles cleanly with `npm run build`

## Migration Notes

- This is the first migration in the project; it establishes the baseline schema
- Subsequent migrations (added in later slices) will layer on top without modifying this file
- If the migration needs to be rolled back, use the Supabase dashboard → Migrations to revert, or drop tables manually via SQL Editor

## References

- Roadmap: `context/foundation/roadmap.md` — F-01 spec
- PRD: `context/foundation/prd.md` — FR-004, FR-007, FR-009, data-isolation NFR
- Supabase client: `src/lib/supabase.ts`
- CLAUDE.md — RLS policy rules, migration naming convention, types location

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: SQL Migration — Tables, Indexes, RLS

#### Automated

- [x] 1.1 Supabase CLI linked: `npx supabase link --project-ref aojqrsssylptdmkkuhnl` exits 0
- [x] 1.2 Migration applies cleanly: `npx supabase db push` exits 0

#### Manual

- [x] 1.3 Dashboard shows `products` table with correct columns
- [x] 1.4 Dashboard shows `recipes` table with correct columns
- [x] 1.5 RLS enabled on both tables, 8 policies each visible in dashboard
- [x] 1.6 Isolation check: test row not visible across different `auth.uid()`

### Phase 2: TypeScript Types

#### Automated

- [ ] 2.1 TypeScript compilation passes: `npm run build` exits 0
- [ ] 2.2 Linting passes: `npm run lint` exits 0

#### Manual

- [ ] 2.3 `Product` import from `@/types` shows all five fields in IDE
- [ ] 2.4 `NewProduct` import shows only `name` and `expiry_date`
