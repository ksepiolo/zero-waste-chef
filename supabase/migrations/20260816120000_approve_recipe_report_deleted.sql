DROP FUNCTION IF EXISTS public.approve_recipe(TEXT, TEXT[], TEXT, UUID[]);

CREATE FUNCTION public.approve_recipe(
  p_title TEXT,
  p_ingredients TEXT[],
  p_instructions TEXT,
  p_used_product_ids UUID[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_consumed_products JSONB;
  v_recipe_id UUID;
  v_deleted_ids UUID[];
BEGIN
  SELECT jsonb_agg(jsonb_build_object('name', name, 'expiry_date', expiry_date::TEXT))
  INTO v_consumed_products
  FROM products
  WHERE id = ANY(p_used_product_ids)
    AND user_id = auth.uid();

  INSERT INTO recipes (user_id, title, ingredients, instructions, consumed_products)
  VALUES (auth.uid(), p_title, p_ingredients, p_instructions, COALESCE(v_consumed_products, '[]'::JSONB))
  RETURNING id INTO v_recipe_id;

  WITH deleted AS (
    DELETE FROM products
    WHERE id = ANY(p_used_product_ids)
      AND user_id = auth.uid()
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_deleted_ids FROM deleted;

  RETURN jsonb_build_object('recipe_id', v_recipe_id, 'deleted_ids', to_jsonb(v_deleted_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_recipe(TEXT, TEXT[], TEXT, UUID[]) TO authenticated;
