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

// Generation parameters. Closed enums — these values reach the prompt, so free text is
// not an option. "any" leads every list and is the default: it means "no extra
// constraint", and the prompt then renders the rule it shipped with.
export const RECIPE_TECHNIQUES = [
  "any",
  "saute",
  "roast",
  "bake",
  "boil-simmer",
  "stir-fry",
  "fry",
  "no-cook",
] as const;
export const RECIPE_METHODS = ["any", "one-pot", "sheet-pan", "salad-assembly", "soup"] as const;
// Every value is at or below the 45-minute cap the prompt already enforced — the control
// only narrows it. Relaxing the cap is a product decision, not a side effect of this control.
export const RECIPE_TIMES = ["any", "15", "30", "45"] as const;

export type RecipeTechnique = (typeof RECIPE_TECHNIQUES)[number];
export type RecipeMethod = (typeof RECIPE_METHODS)[number];
export type RecipeTime = (typeof RECIPE_TIMES)[number];

export interface RecipeParams {
  technique: RecipeTechnique;
  method: RecipeMethod;
  time: RecipeTime;
}

export const DEFAULT_RECIPE_PARAMS: RecipeParams = { technique: "any", method: "any", time: "any" };

// Approval payload as it crosses the API boundary — camelCase ids, instructions still
// an array; the service performs the join before the RPC call.
export interface ApproveRecipeInput {
  title: string;
  ingredients: string[];
  instructions: string[];
  usedProductIds: string[];
}
