import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";
import { ServiceError } from "./service-error";

import { classifyExpiry, deleteProduct, listProducts, updateProduct } from "./product.service";

// The clock is frozen so the boundary table means the same thing on every machine and in
// every month; vitest.config.ts pins TZ=UTC to match workerd, so the local-date arithmetic
// isAtRisk() performs cannot drift with the developer's timezone.
const FROZEN_NOW = new Date("2026-08-15T12:00:00Z");

/** ISO date string `days` from the frozen clock; negative offsets are past dates. */
function expiryIn(days: number): string {
  const date = new Date(FROZEN_NOW);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// Oracle: prd.md:31 — an at-risk product is one "expiring within 3 days from today's
// date", and prd.md:98 restates the window as the 3-day at-risk window. "Within 3 days"
// includes the third day, so +3 is inside the window and +4 is the first day outside it.
// The lower bound comes from the resolved oracle in
// context/changes/testing-recipe-generation-core/research.md, "Resolved Oracle — expired
// products", decision D1: three mutually exclusive states, where a past date is `expired`
// and therefore *not* at-risk. The negative rows the earlier suite deferred to Phase 1b
// are the ones below.
const CLASSIFICATION_TABLE = [
  { offset: -365, label: "expired a year ago", is_at_risk: false, is_expired: true },
  { offset: -30, label: "expired a month ago", is_at_risk: false, is_expired: true },
  { offset: -1, label: "expired yesterday", is_at_risk: false, is_expired: true },
  { offset: 0, label: "expires today", is_at_risk: true, is_expired: false },
  { offset: 1, label: "expires tomorrow", is_at_risk: true, is_expired: false },
  { offset: 3, label: "expires on the last day of the window", is_at_risk: true, is_expired: false },
  { offset: 4, label: "expires the day after the window closes", is_at_risk: false, is_expired: false },
];

describe("classifyExpiry", () => {
  it.each(CLASSIFICATION_TABLE)(
    "classifies a product that $label (day $offset) as at_risk=$is_at_risk expired=$is_expired",
    ({ offset, is_at_risk, is_expired }) => {
      expect(classifyExpiry(expiryIn(offset))).toStrictEqual({ is_at_risk, is_expired });
    },
  );

  // D1's states are mutually exclusive, and the two booleans can only encode that if they
  // are never both true. This is the property a second derivation site would break, which
  // is why classifyExpiry is the only thing callers use.
  it.each(CLASSIFICATION_TABLE)("never reports a product that $label as both at-risk and expired", ({ offset }) => {
    const { is_at_risk, is_expired } = classifyExpiry(expiryIn(offset));

    expect(is_at_risk && is_expired).toBe(false);
  });
});

interface QueryStub {
  select: () => QueryStub;
  eq: () => QueryStub;
  order: () => Promise<{ data: unknown; error: null }>;
}

/**
 * Minimal stand-in for the Supabase query builder listProducts drives. The chain is
 * thenable only at .order(), which is where listProducts awaits it.
 */
function stubSupabase(rows: unknown[]): SupabaseClient {
  const query: QueryStub = {
    select: () => query,
    eq: () => query,
    order: () => Promise.resolve({ data: rows, error: null }),
  };

  return { from: () => query } as unknown as SupabaseClient;
}

function productRow(overrides: Partial<Product> & Pick<Product, "id" | "expiry_date">): Product {
  return {
    user_id: "user-1",
    name: "Product",
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("listProducts", () => {
  // Oracle: ProductWithRisk is `Product & { is_at_risk: boolean; is_expired: boolean }`, a
  // Product *plus* two derived flags. The products table stores neither column, so both
  // have to be computed per row on read; a row that arrives without them must still come
  // back with them.
  it("derives both expiry flags for every returned row", async () => {
    const supabase = stubSupabase([
      productRow({ id: "expired", expiry_date: expiryIn(-1) }),
      productRow({ id: "at-risk", expiry_date: expiryIn(1) }),
      productRow({ id: "safe", expiry_date: expiryIn(30) }),
    ]);

    const products = await listProducts(supabase, "user-1");

    expect(products).toHaveLength(3);
    expect(products.map((product) => [product.id, product.is_at_risk, product.is_expired])).toStrictEqual([
      ["expired", false, true],
      ["at-risk", true, false],
      ["safe", false, false],
    ]);
  });

  // The flags are server-derived, never passed through. A row carrying stale or forged
  // values must be overwritten by the computed ones, not trusted.
  it("recomputes both flags instead of trusting values present on the row", async () => {
    const supabase = stubSupabase([
      { ...productRow({ id: "safe", expiry_date: expiryIn(30) }), is_at_risk: true, is_expired: true },
    ]);

    const [product] = await listProducts(supabase, "user-1");

    expect(product.is_at_risk).toBe(false);
    expect(product.is_expired).toBe(false);
  });
});

interface DeleteQueryStub {
  delete: () => DeleteQueryStub;
  eq: () => DeleteQueryStub;
  then: PromiseLike<{ count: number; error: null }>["then"];
}

/** Minimal stand-in for the delete().eq().eq() chain deleteProduct awaits directly. */
function stubDeleteChain(count: number): SupabaseClient {
  const result = { count, error: null };
  const query: DeleteQueryStub = {
    delete: () => query,
    eq: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };

  return { from: () => query } as unknown as SupabaseClient;
}

describe("deleteProduct", () => {
  // Mutation coverage gap: no test anywhere exercised the success path (a row actually
  // deleted, count !== 0), so a mutant forcing the "not found" branch unconditionally
  // survived — the same defect class would ship a delete button that always answers 404.
  it("resolves without throwing when the row is deleted", async () => {
    const supabase = stubDeleteChain(1);

    await expect(deleteProduct(supabase, "user-1", "product-1")).resolves.toBeUndefined();
  });
});

interface UpdateQueryStub {
  update: () => UpdateQueryStub;
  eq: () => UpdateQueryStub;
  select: () => UpdateQueryStub;
  single: () => Promise<{ data: unknown; error: { code: string; message: string } | null }>;
}

/** Minimal stand-in for the update().eq().eq().select().single() chain updateProduct awaits. */
function stubUpdateChain(result: { data: unknown; error: { code: string; message: string } | null }): SupabaseClient {
  const query: UpdateQueryStub = {
    update: () => query,
    eq: () => query,
    select: () => query,
    single: () => Promise.resolve(result),
  };

  return { from: () => query } as unknown as SupabaseClient;
}

describe("updateProduct", () => {
  // Oracle: plan.md Phase 1 #3 — on success, the returned row is re-classified via
  // classifyExpiry rather than trusting whatever expiry flags (if any) the row carries.
  it("returns the updated row with classifyExpiry re-applied", async () => {
    const updated = productRow({ id: "product-1", name: "Milk", expiry_date: expiryIn(1) });
    const supabase = stubUpdateChain({ data: updated, error: null });

    const result = await updateProduct(supabase, "user-1", "product-1", { name: "Milk", expiry_date: expiryIn(1) });

    expect(result).toStrictEqual({ ...updated, is_at_risk: true, is_expired: false });
  });

  // Oracle: plan.md Phase 1 #3 — id is the primary key, so PGRST116 here can only mean zero
  // matching rows; this is the domain 404 the PATCH route string-matches on, not a
  // ServiceError, mirroring deleteProduct's bare-Error not-found convention.
  it("throws a bare not-found error when PGRST116 is returned", async () => {
    const supabase = stubUpdateChain({ data: null, error: { code: "PGRST116", message: "no rows" } });

    await expect(
      updateProduct(supabase, "user-1", "product-1", { name: "Milk", expiry_date: expiryIn(1) }),
    ).rejects.toThrow("not found");
  });

  // Oracle: plan.md Phase 1 #3 — any other error shape is an upstream datastore failure,
  // classified as ServiceError("data_access") like createProduct/deleteProduct/listProducts.
  it("throws a ServiceError with kind data_access for any other failure", async () => {
    const supabase = stubUpdateChain({ data: null, error: { code: "500", message: "connection refused" } });

    await expect(
      updateProduct(supabase, "user-1", "product-1", { name: "Milk", expiry_date: expiryIn(1) }),
    ).rejects.toThrow(ServiceError);
  });
});
