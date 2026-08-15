import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

import { isAtRisk, listProducts } from "./product.service";

// The clock is frozen so the boundary table means the same thing on every machine and in
// every month; vitest.config.ts pins TZ=UTC to match workerd, so the local-date arithmetic
// isAtRisk() performs cannot drift with the developer's timezone.
const FROZEN_NOW = new Date("2026-08-15T12:00:00Z");

/** ISO date string `days` after the frozen clock. Offsets are always non-negative here. */
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

describe("isAtRisk", () => {
  // Oracle: prd.md:31 — an at-risk product is one "expiring within 3 days from today's
  // date", and prd.md:98 restates the window as the 3-day at-risk window. "Within 3 days"
  // includes the third day, so +3 is inside the window and +4 is the first day outside it.
  //
  // Deliberately no negative offsets: today isAtRisk() returns true for every past date,
  // and whether an already-expired product should still count as at-risk is the oracle
  // question owned by expired-product-handling (test-plan §3 Phase 1b). Asserting either
  // answer here would write a row that phase must immediately rewrite.
  it.each([
    { offset: 0, label: "expires today", expected: true },
    { offset: 1, label: "expires tomorrow", expected: true },
    { offset: 3, label: "expires on the last day of the window", expected: true },
    { offset: 4, label: "expires the day after the window closes", expected: false },
  ])("returns $expected for a product that $label (day $offset)", ({ offset, expected }) => {
    expect(isAtRisk(expiryIn(offset))).toBe(expected);
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
  // Oracle: types.ts:11 — ProductWithRisk is `Product & { is_at_risk: boolean }`, a Product
  // *plus* a derived flag. The products table stores no such column, so the flag has to be
  // computed per row on read; a row that arrives without it must still come back with it.
  it("derives is_at_risk for every returned row", async () => {
    const supabase = stubSupabase([
      productRow({ id: "at-risk", expiry_date: expiryIn(1) }),
      productRow({ id: "safe", expiry_date: expiryIn(30) }),
    ]);

    const products = await listProducts(supabase, "user-1");

    expect(products).toHaveLength(2);
    expect(products.map((product) => [product.id, product.is_at_risk])).toStrictEqual([
      ["at-risk", true],
      ["safe", false],
    ]);
  });

  // The flag is server-derived, never passed through. A row carrying a stale or forged
  // is_at_risk must be overwritten by the computed value, not trusted.
  it("recomputes is_at_risk instead of trusting a value present on the row", async () => {
    const supabase = stubSupabase([{ ...productRow({ id: "safe", expiry_date: expiryIn(30) }), is_at_risk: true }]);

    const [product] = await listProducts(supabase, "user-1");

    expect(product.is_at_risk).toBe(false);
  });
});
