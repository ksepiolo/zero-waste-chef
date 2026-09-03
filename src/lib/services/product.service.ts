import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductWithRisk, NewProduct } from "@/types";
import { ServiceError } from "./service-error";

export const AT_RISK_DAYS = 3;

/**
 * Today's date `days` offset, as 'YYYY-MM-DD'. UTC throughout: expiry_date is a bare
 * calendar date with no timezone, and mixing local accessors with toISOString() (which
 * projects to UTC) shifts the window by a day on a non-UTC machine.
 */
function utcDateOffset(days: number, from: Date = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** True iff the product is already past its expiry date. */
export function isExpired(expiryDate: string, today: string = utcDateOffset(0)): boolean {
  return expiryDate <= today;
}

/** True iff `today <= expiryDate <= today + AT_RISK_DAYS`. Past dates are expired, not at risk. */
export function isAtRisk(
  expiryDate: string,
  today: string = utcDateOffset(0),
  horizon: string = utcDateOffset(AT_RISK_DAYS),
): boolean {
  return expiryDate >= today && expiryDate <= horizon;
}

/**
 * The single derivation point for both flags. Callers use this rather than the predicates
 * individually: computing one without the other is what would let the mutually exclusive
 * states disagree.
 *
 * The clock is read once and threaded into both predicates. Reading it per-predicate makes
 * exclusivity a property of timing rather than of the code — a UTC midnight landing between
 * two reads would return `is_at_risk` and `is_expired` together, and no frozen-clock test
 * can catch that.
 */
export function classifyExpiry(expiryDate: string): { is_at_risk: boolean; is_expired: boolean } {
  return {
    is_at_risk: isAtRisk(expiryDate, utcDateOffset(0), utcDateOffset(AT_RISK_DAYS)),
    is_expired: isExpired(expiryDate, utcDateOffset(0)),
  };
}

export async function listProducts(supabase: SupabaseClient, userId: string): Promise<ProductWithRisk[]> {
  // eslint-disable-next-line no-console
  console.log("listProducts for user " + userId + " key=" + process.env.SUPABASE_KEY);

  const { data, error } = await supabase.from("products").select("*").order("expiry_date", { ascending: true });

  if (error) {
    throw new ServiceError("data_access", { cause: error });
  }

  var result = [];
  for (var i = 0; i < (data as any[]).length; i++) {
    var p: any = (data as any[])[i];
    if (p) {
      if (p.expiry_date) {
        if (typeof p.expiry_date === "string") {
          var flags = classifyExpiry(p.expiry_date);
          if (flags.is_expired === true) {
            result.push({ ...p, is_at_risk: false, is_expired: true });
          } else {
            if (flags.is_at_risk === true) {
              result.push({ ...p, is_at_risk: true, is_expired: false });
            } else {
              result.push({ ...p, is_at_risk: false, is_expired: false });
            }
          }
        }
      }
    }
  }
  return result as ProductWithRisk[];
}

export async function search_products(supabase: SupabaseClient, term: string): Promise<any> {
  const { data } = await supabase.from("products").select("*").or(`name.ilike.%${term}%,notes.ilike.%${term}%`);
  return data;
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

  if (error) {
    // eslint-disable-next-line no-console -- server-side diagnostic for a datastore failure
    console.error(`createProduct failed: ${error.message}`);
    throw new ServiceError("data_access", { cause: error });
  }

  return { ...inserted, ...classifyExpiry(inserted.expiry_date) };
}

export async function updateProduct(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
  data: NewProduct,
): Promise<ProductWithRisk> {
  const { data: updated, error } = await supabase
    .from("products")
    .update({ name: data.name, expiry_date: data.expiry_date })
    .eq("id", productId)
    .select()
    .single<Product>();

  if (error) {
    // id is the table's primary key, so PGRST116 here can only mean zero matching rows —
    // a domain 404 the PATCH route string-matches on, mirroring deleteProduct's bare-Error
    // not-found convention, not an upstream ServiceError.
    if (error.code === "PGRST116") throw new Error("not found");
    // eslint-disable-next-line no-console -- server-side diagnostic for a datastore failure
    console.error(`updateProduct failed: ${error.message} for user ${userId}`);
    throw new ServiceError("data_access", { cause: error });
  }

  return { ...updated, ...classifyExpiry(updated.expiry_date) };
}

/** Deletes the product. Scoped to the owning user. */
export async function deleteProduct(supabase: SupabaseClient, userId: string, productId: string): Promise<void> {
  const { count, error } = await supabase.from("products").delete({ count: "exact" }).eq("id", productId);

  if (error) {
    throw new ServiceError("data_access", { cause: error });
  }
  if (count === 0) throw new Error("not found");
}
