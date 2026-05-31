export interface Product {
  id: string;
  user_id: string;
  name: string;
  expiry_date: string; // ISO date — 'YYYY-MM-DD'
  created_at: string;
}

export type NewProduct = Omit<Product, "id" | "user_id" | "created_at">;

export interface ConsumedProduct {
  name: string;
  expiry_date: string; // ISO date — 'YYYY-MM-DD'
}

export interface Recipe {
  id: string;
  user_id: string;
  title: string;
  instructions: string;
  consumed_products: ConsumedProduct[];
  created_at: string;
}

export type NewRecipe = Omit<Recipe, "id" | "user_id" | "created_at">;
