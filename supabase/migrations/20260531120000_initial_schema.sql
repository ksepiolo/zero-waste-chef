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
