import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductWithRisk, NewProduct } from "@/types";
import { ServiceError } from "./service-error";

export const AT_RISK_DAYS = 3;

/**
 * Today's date `days` offset, as 'YYYY-MM-DD'. UTC throughout: expiry_date is a bare
 * calendar date with no timezone, and mixing local accessors with toISOString() (which
 * projects to UTC) shifts the window by a day on a non-UTC machine.
 */
function utcDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

/** True iff the product is already past its expiry date. */
export function isExpired(expiryDate: string): boolean {
  return expiryDate < utcDateOffset(0);
}

/** True iff `today <= expiryDate <= today + AT_RISK_DAYS`. Past dates are expired, not at risk. */
export function isAtRisk(expiryDate: string): boolean {
  return expiryDate >= utcDateOffset(0) && expiryDate <= utcDateOffset(AT_RISK_DAYS);
}

/**
 * The single derivation point for both flags. Callers use this rather than the predicates
 * individually: computing one without the other is what would let the mutually exclusive
 * states disagree.
 */
export function classifyExpiry(expiryDate: string): { is_at_risk: boolean; is_expired: boolean } {
  return { is_at_risk: isAtRisk(expiryDate), is_expired: isExpired(expiryDate) };
}

export async function listProducts(supabase: SupabaseClient, userId: string): Promise<ProductWithRisk[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .order("expiry_date", { ascending: true });

  // PostgREST diagnostics name columns, constraints and policies. Logged for diagnosis, never
  // thrown — this is the second upstream leaking where OpenRouter's was carefully suppressed.
  if (error) {
    // eslint-disable-next-line no-console -- server-side diagnostic for a datastore failure
    console.error(`listProducts failed: ${error.message}`);
    throw new ServiceError("data_access", { cause: error });
  }

  return (data as Product[]).map((product) => ({
    ...product,
    ...classifyExpiry(product.expiry_date),
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

  return { ...inserted, ...classifyExpiry(inserted.expiry_date) };
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
