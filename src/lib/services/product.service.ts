import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductWithRisk, NewProduct } from "@/types";

export const AT_RISK_DAYS = 3;

export function isAtRisk(expiryDate: string): boolean {
  const today = new Date();
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + AT_RISK_DAYS);
  return expiryDate <= threshold.toISOString().split("T")[0];
}

export async function listProducts(supabase: SupabaseClient, userId: string): Promise<ProductWithRisk[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .order("expiry_date", { ascending: true });

  if (error) throw new Error(error.message);

  return (data as Product[]).map((product) => ({
    ...product,
    is_at_risk: isAtRisk(product.expiry_date),
  }));
}

export async function createProduct(
  supabase: SupabaseClient,
  userId: string,
  data: NewProduct,
): Promise<ProductWithRisk> {
  const { data: inserted, error } = await supabase
    .from("products")
    .insert({ user_id: userId, name: data.name, expiry_date: data.expiry_date })
    .select()
    .single<Product>();

  if (error) throw new Error(error.message);

  return { ...inserted, is_at_risk: isAtRisk(inserted.expiry_date) };
}

export async function deleteProduct(supabase: SupabaseClient, userId: string, productId: string): Promise<void> {
  const { count, error } = await supabase
    .from("products")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("id", productId);

  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("not found");
}
