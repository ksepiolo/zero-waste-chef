ALTER TABLE public.recipes ADD COLUMN ingredients TEXT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.approve_recipe(
  p_title TEXT,
  p_ingredients TEXT[],
  p_instructions TEXT,
  p_used_product_ids UUID[]
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_consumed_products JSONB;
  v_recipe_id UUID;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('name', name, 'expiry_date', expiry_date::TEXT))
  INTO v_consumed_products
  FROM products
  WHERE id = ANY(p_used_product_ids)
    AND user_id = auth.uid();

  INSERT INTO recipes (user_id, title, ingredients, instructions, consumed_products)
  VALUES (auth.uid(), p_title, p_ingredients, p_instructions, COALESCE(v_consumed_products, '[]'::JSONB))
  RETURNING id INTO v_recipe_id;

  DELETE FROM products
  WHERE id = ANY(p_used_product_ids)
    AND user_id = auth.uid();

  RETURN v_recipe_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_recipe(TEXT, TEXT[], TEXT, UUID[]) TO authenticated;
