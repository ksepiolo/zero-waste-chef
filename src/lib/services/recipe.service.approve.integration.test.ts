import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

/**
 * Proves what a mock cannot: atomicity (Risk #3) and set-identity (Risk #5) are Postgres
 * properties, exercised against the real local database seeded by `npx supabase db reset`
 * (supabase/seed.sql). Every other test in this project mocks the database entirely — this
 * file is the one exception, on purpose (test-plan.md §2 Risk Response Guidance).
 *
 * Skips cleanly, rather than hard-failing, when the local Supabase stack is not running —
 * see the reachability check below. `npm run test` must behave identically with or without
 * `npx supabase start` (Phase 4 criterion 4.3).
 */

const SENTINEL_NAME = "__test_force_delete_failure__";

const PRIMARY_USER = { email: "test@example.com", password: "Test1234!" };
const SECONDARY_USER = { email: "test2@example.com", password: "Test1234!" };

/** ISO date in the future — expiry_date has no bearing on approve_recipe, but the column is NOT NULL. */
function futureExpiry(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().split("T")[0];
}

async function isSupabaseReachable(): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Evaluated once at module load — before `describe.skipIf` reads it — so the skip decision
// and the printed reason are made together rather than the suite silently vanishing.
const supabaseReachable = await isSupabaseReachable();
if (!supabaseReachable) {
  // eslint-disable-next-line no-console -- deliberate: tells a dev why this suite is absent from the run
  console.log(
    "Skipping recipe.service.approve.integration.test.ts — local Supabase is not reachable. Run `npx supabase start` to include it.",
  );
}

interface ApproveRpcResult {
  recipe_id: string;
  deleted_ids: string[];
}

describe.skipIf(!supabaseReachable)("approve_recipe — integration", () => {
  let primaryClient: SupabaseClient;
  let secondaryClient: SupabaseClient;
  let primaryUserId: string;
  let secondaryUserId: string;

  // Tracked and cleaned per-test rather than per-suite, so one test's leftovers can never
  // widen or narrow the set another test observes.
  let cleanupProducts: { client: SupabaseClient; id: string }[] = [];
  let cleanupRecipeTitles: { client: SupabaseClient; title: string }[] = [];

  beforeAll(async () => {
    // Reached only when `supabaseReachable` was true, which already required both to be
    // set — this is TypeScript narrowing the optional env fields, not a new runtime check.
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be set to run this suite");
    }

    // createClient()'s inferred return type carries generic defaults in a different order
    // than the bare `SupabaseClient` type used throughout the rest of the app (the same
    // type product.service.ts and recipe.service.ts take as a parameter) — the two are
    // structurally compatible, so a type-assertion cast is flagged as unnecessary even
    // though the direct assignment is not; disabling is narrower than widening every
    // helper in this file to a bespoke type just to satisfy the lint.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- createClient()'s and SupabaseClient's default generics differ only in ordering
    primaryClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- createClient()'s and SupabaseClient's default generics differ only in ordering
    secondaryClient = createClient(SUPABASE_URL, SUPABASE_KEY);

    const [primarySignIn, secondarySignIn] = await Promise.all([
      primaryClient.auth.signInWithPassword(PRIMARY_USER),
      secondaryClient.auth.signInWithPassword(SECONDARY_USER),
    ]);

    if (primarySignIn.error) throw primarySignIn.error;
    if (secondarySignIn.error) throw secondarySignIn.error;
    primaryUserId = primarySignIn.data.user.id;
    secondaryUserId = secondarySignIn.data.user.id;
  });

  afterEach(async () => {
    for (const { client, title } of cleanupRecipeTitles) {
      await client.from("recipes").delete().eq("title", title);
    }
    for (const { client, id } of cleanupProducts) {
      await client.from("products").delete().eq("id", id);
    }
    cleanupProducts = [];
    cleanupRecipeTitles = [];
  });

  async function insertProduct(client: SupabaseClient, userId: string, name: string): Promise<string> {
    const { data, error } = await client
      .from("products")
      .insert({ user_id: userId, name, expiry_date: futureExpiry() })
      .select("id")
      .single<{ id: string }>();

    if (error) throw error;
    cleanupProducts.push({ client, id: data.id });
    return data.id;
  }

  function trackRecipe(client: SupabaseClient, title: string): void {
    cleanupRecipeTitles.push({ client, title });
  }

  async function callApprove(
    client: SupabaseClient,
    title: string,
    usedProductIds: string[],
  ): Promise<{ data: ApproveRpcResult | null; error: PostgrestError | null }> {
    const { data, error } = await client
      .rpc("approve_recipe", {
        p_title: title,
        p_ingredients: ["1 test ingredient"],
        p_instructions: "test instructions",
        p_used_product_ids: usedProductIds,
      })
      .overrideTypes<ApproveRpcResult>();

    // Same narrowing as approveRecipe in recipe.service.ts — see the comment there for why
    // overrideTypes alone does not resolve to the plain object shape.
    return { data: data as unknown as ApproveRpcResult | null, error };
  }

  // Oracle: test-plan §2 Risk #3 — "a forced failure on the second write leaves neither
  // effect committed". The sentinel trigger (migration 20260816130000) forces the DELETE —
  // the statement *after* the INSERT — to fail, so a passing INSERT-then-fail sequence
  // proves the whole call rolled back rather than "the DELETE never got a chance to run".
  it("rolls back the whole call when the DELETE fails partway through", async () => {
    const title = `Integration Atomicity ${crypto.randomUUID()}`;
    const sentinelId = await insertProduct(primaryClient, primaryUserId, SENTINEL_NAME);
    trackRecipe(primaryClient, title);

    const { error } = await callApprove(primaryClient, title, [sentinelId]);

    expect(error).toBeTruthy();

    const { data: recipes } = await primaryClient.from("recipes").select("id").eq("title", title);
    expect(recipes).toStrictEqual([]);

    const { data: product } = await primaryClient
      .from("products")
      .select("id")
      .eq("id", sentinelId)
      .maybeSingle<{ id: string }>();
    expect(product?.id).toBe(sentinelId);

    // The trigger blocks any DELETE that targets this exact name — including the shared
    // afterEach's cleanup — so this row would otherwise leak across every test run.
    // Renaming first sidesteps it without weakening what the assertions above just proved.
    await primaryClient
      .from("products")
      .update({ name: `cleanup-${crypto.randomUUID()}` })
      .eq("id", sentinelId);
  });

  // Oracle: test-plan §2 Risk #5 — "the set returned in the approval payload and the set
  // deleted on confirm are provably the same set". Asserted as a set (order-independent),
  // never by length alone — a length match would pass even if the wrong ids were deleted.
  it("deletes exactly the sent set when every id is valid and owned", async () => {
    const title = `Integration Happy Path ${crypto.randomUUID()}`;
    const productA = await insertProduct(primaryClient, primaryUserId, `Product A ${crypto.randomUUID()}`);
    const productB = await insertProduct(primaryClient, primaryUserId, `Product B ${crypto.randomUUID()}`);
    trackRecipe(primaryClient, title);

    const { data, error } = await callApprove(primaryClient, title, [productA, productB]);

    expect(error).toBeNull();
    expect(new Set(data?.deleted_ids)).toStrictEqual(new Set([productA, productB]));

    const { data: recipes } = await primaryClient.from("recipes").select("id").eq("title", title);
    expect(recipes).toHaveLength(1);

    const { data: remaining } = await primaryClient.from("products").select("id").in("id", [productA, productB]);
    expect(remaining).toStrictEqual([]);
  });

  // A duplicate id in the request must not be treated as "delete twice" (which would error
  // on the second delete finding nothing) nor inflate the reported set.
  it("deletes once and reports no duplicate when the same id is sent twice", async () => {
    const title = `Integration Duplicate Id ${crypto.randomUUID()}`;
    const productId = await insertProduct(primaryClient, primaryUserId, `Product ${crypto.randomUUID()}`);
    trackRecipe(primaryClient, title);

    const { data, error } = await callApprove(primaryClient, title, [productId, productId]);

    expect(error).toBeNull();
    expect(data?.deleted_ids).toStrictEqual([productId]);

    const { data: remaining } = await primaryClient.from("products").select("id").eq("id", productId);
    expect(remaining).toStrictEqual([]);
  });

  // Oracle: PRD §Guardrails — a stale id (removed between generate and approve, e.g. by a
  // second tab) must not widen the deletion or error the whole approval; it is silently
  // excluded from deleted_ids and the caller can tell it apart from a valid delete.
  it("excludes a stale id without erroring, and the recipe still saves", async () => {
    const title = `Integration Stale Id ${crypto.randomUUID()}`;
    const staleId = await insertProduct(primaryClient, primaryUserId, `Stale ${crypto.randomUUID()}`);
    // Deleted directly — not via the RPC — so this is a genuinely stale id by the time
    // approve_recipe runs, not a duplicate of the atomicity test's forced-failure path.
    await primaryClient.from("products").delete().eq("id", staleId);
    cleanupProducts = cleanupProducts.filter((p) => p.id !== staleId);
    trackRecipe(primaryClient, title);

    const { data, error } = await callApprove(primaryClient, title, [staleId]);

    expect(error).toBeNull();
    expect(data?.deleted_ids).toStrictEqual([]);

    const { data: recipes } = await primaryClient.from("recipes").select("id").eq("title", title);
    expect(recipes).toHaveLength(1);
  });

  // Oracle: [[Always add an app-layer user_id filter alongside RLS on read and delete
  // queries]] — the ownership guarantee this lesson protects is exactly what this case
  // exercises: a foreign-owned id must be excluded, not deleted, and must not error the
  // approval it was smuggled into.
  it("excludes a foreign-owned id without deleting it or erroring", async () => {
    const title = `Integration Foreign Id ${crypto.randomUUID()}`;
    const foreignId = await insertProduct(secondaryClient, secondaryUserId, `Foreign ${crypto.randomUUID()}`);
    trackRecipe(primaryClient, title);

    const { data, error } = await callApprove(primaryClient, title, [foreignId]);

    expect(error).toBeNull();
    expect(data?.deleted_ids).toStrictEqual([]);

    const { data: stillOwned } = await secondaryClient
      .from("products")
      .select("id")
      .eq("id", foreignId)
      .maybeSingle<{ id: string }>();
    expect(stillOwned?.id).toBe(foreignId);

    const { data: recipes } = await primaryClient.from("recipes").select("id").eq("title", title);
    expect(recipes).toHaveLength(1);
  });
});
