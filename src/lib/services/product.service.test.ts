import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

import { classifyExpiry, deleteProduct, listProducts } from "./product.service";

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
