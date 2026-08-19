import type { APIRoute } from "astro";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

/**
 * Proves Risk #4 (data isolation) against the real local database: GET /api/products,
 * called as the second seeded user, never includes a product the first seeded user owns.
 * Every route builds its Supabase client from request cookies via createClient(), not from
 * locals, so exercising real RLS means substituting what createClient returns — see
 * plan.md's Critical Implementation Details for why this mocks a real, signed-in client
 * rather than a query stub.
 *
 * Skips cleanly, rather than hard-failing, when the local Supabase stack is not running —
 * mirrors recipe.service.approve.integration.test.ts's reachability guard.
 */

const PRIMARY_USER = { email: "test@example.com", password: "Test1234!" };
const SECONDARY_USER = { email: "test2@example.com", password: "Test1234!" };

const clientHolder = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock("@/lib/supabase", () => ({ createClient: () => clientHolder.current }));

import { GET } from "./index";

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
    "Skipping products/index.integration.test.ts — local Supabase is not reachable. Run `npx supabase start` to include it.",
  );
}

/** ISO date in the future — expiry_date is NOT NULL and has no bearing on isolation. */
function futureExpiry(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().split("T")[0];
}

type RouteContext = Parameters<APIRoute>[0];

/** GET /api/products reads only `request`, `cookies` (both ignored by the mocked client) and `locals.user`. */
function routeContext(user: { id: string } | null): RouteContext {
  const request = new Request("https://zero-waste-chef.test/api/products", { method: "GET" });
  return { request, cookies: {}, locals: { user } } as unknown as RouteContext;
}

describe.skipIf(!supabaseReachable)("GET /api/products — cross-user isolation", () => {
  let primaryClient: SupabaseClient;
  let secondaryClient: SupabaseClient;
  let primaryUserId: string;
  let secondaryUserId: string;
  let cleanupIds: string[] = [];

  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be set to run this suite");
    }

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
    for (const id of cleanupIds) {
      await primaryClient.from("products").delete().eq("id", id);
    }
    cleanupIds = [];
  });

  // Oracle: [[Always add an app-layer user_id filter alongside RLS on read and delete
  // queries]] — proven here at the route layer, against real RLS, rather than inferred
  // from reading listProducts's .eq("user_id", userId) chain.
  it("never returns the first user's product to the second user", async () => {
    const { data, error } = await primaryClient
      .from("products")
      .insert({ user_id: primaryUserId, name: `Isolation ${crypto.randomUUID()}`, expiry_date: futureExpiry() })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    cleanupIds.push(data.id);

    clientHolder.current = secondaryClient;
    const response = await GET(routeContext({ id: secondaryUserId }));
    const body = (await response.json()) as { products: { id: string }[] };

    expect(response.status).toBe(200);
    expect(body.products.some((product) => product.id === data.id)).toBe(false);
  });
});
