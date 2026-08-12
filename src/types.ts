export interface Product {
  id: string;
  user_id: string;
  name: string;
  expiry_date: string; // ISO date — 'YYYY-MM-DD'
  created_at: string;
}

export type NewProduct = Omit<Product, "id" | "user_id" | "created_at">;

export type ProductWithRisk = Product & { is_at_risk: boolean };

export interface ConsumedProduct {
  name: string;
  expiry_date: string; // ISO date — 'YYYY-MM-DD'
}

export interface Recipe {
  id: string;
  user_id: string;
  title: string;
  ingredients: string[];
  instructions: string;
  consumed_products: ConsumedProduct[];
  created_at: string;
}

export type NewRecipe = Omit<Recipe, "id" | "user_id" | "created_at">;

// One page of recipe history plus the total row count, so the UI can render its
// position without a second request.
export interface RecipePage {
  recipes: Recipe[];
  total: number;
}

// Lives here, not in recipe.service.ts: that module imports astro:env/server, which
// throws ServerOnlyModule if pulled into the client bundle. The history island needs
// this constant, and src/types.ts has no runtime imports at all.
export const RECIPES_PAGE_SIZE = 20;

export interface GeneratedRecipe {
  title: string;
  ingredients: string[];
  instructions: string[]; // array from AI; joined with '\n' only in approve endpoint
  used_product_ids: string[];
}

// Approval payload as it crosses the API boundary — camelCase ids, instructions still
// an array; the service performs the join before the RPC call.
export interface ApproveRecipeInput {
  title: string;
  ingredients: string[];
  instructions: string[];
  usedProductIds: string[];
}
