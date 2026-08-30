import type { APIRoute } from "astro";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

/**
 * Proves Risk #4 (data isolation) against the real local database: DELETE
 * /api/products/[id], called as the second seeded user against the first seeded user's
 * product id, is rejected and does not delete the row. Mocks `@/lib/supabase`'s
 * createClient to return a real, already-signed-in client — see plan.md's Critical
 * Implementation Details.
 *
 * Skips cleanly, rather than hard-failing, when the local Supabase stack is not running —
 * mirrors recipe.service.approve.integration.test.ts's reachability guard.
 */

const PRIMARY_USER = { email: "test@example.com", password: "Test1234!" };
const SECONDARY_USER = { email: "test2@example.com", password: "Test1234!" };

const clientHolder = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock("@/lib/supabase", () => ({ createClient: () => clientHolder.current }));

import { DELETE, PATCH } from "./[id]";

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
    "Skipping products/[id].integration.test.ts — local Supabase is not reachable. Run `npx supabase start` to include it.",
  );
}

/** ISO date in the future — expiry_date is NOT NULL and has no bearing on isolation. */
function futureExpiry(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().split("T")[0];
}

type RouteContext = Parameters<APIRoute>[0];

/** DELETE /api/products/[id] reads `request`, `cookies` (both ignored by the mocked client), `params.id` and `locals.user`. */
function routeContext(id: string, user: { id: string } | null): RouteContext {
  const request = new Request(`https://zero-waste-chef.test/api/products/${id}`, { method: "DELETE" });
  return { request, cookies: {}, params: { id }, locals: { user } } as unknown as RouteContext;
}

/** PATCH /api/products/[id] additionally reads a JSON body. */
function patchRouteContext(
  id: string,
  user: { id: string } | null,
  body: { name: string; expiry_date: string },
): RouteContext {
  const request = new Request(`https://zero-waste-chef.test/api/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return { request, cookies: {}, params: { id }, locals: { user } } as unknown as RouteContext;
}

describe.skipIf(!supabaseReachable)("DELETE /api/products/[id] — cross-user isolation", () => {
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
    clientHolder.current = null;
  });

  // Oracle: [[Always add an app-layer user_id filter alongside RLS on read and delete
  // queries]] — deleteProduct's count===0 branch collapses "foreign" and "nonexistent" into
  // the same 404 by design (plan.md's Key Discoveries), so this asserts the non-leaking
  // rejection and, separately, that the row genuinely survives — not inferred from the
  // status code alone.
  it("rejects a foreign product id with 404 and leaves the row intact", async () => {
    const { data, error } = await primaryClient
      .from("products")
      .insert({ user_id: primaryUserId, name: `Isolation ${crypto.randomUUID()}`, expiry_date: futureExpiry() })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    cleanupIds.push(data.id);

    clientHolder.current = secondaryClient;
    const response = await DELETE(routeContext(data.id, { id: secondaryUserId }));

    expect(response.status).toBe(404);

    const { data: stillOwned } = await primaryClient
      .from("products")
      .select("id")
      .eq("id", data.id)
      .maybeSingle<{ id: string }>();
    expect(stillOwned?.id).toBe(data.id);
  });
});

describe.skipIf(!supabaseReachable)("PATCH /api/products/[id] — cross-user isolation", () => {
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
    clientHolder.current = null;
  });

  // Oracle: [[Always add an app-layer user_id filter alongside RLS on read and delete
  // queries]] — updateProduct's PGRST116 branch collapses "foreign" and "nonexistent" into
  // the same 404 by design (plan.md's Key Discoveries), so this asserts the non-leaking
  // rejection and, separately, that the row's name/expiry_date genuinely survive — not
  // inferred from the status code alone.
  it("rejects a foreign product id with 404 and leaves the row unchanged", async () => {
    const originalName = `Isolation ${crypto.randomUUID()}`;
    const originalExpiry = futureExpiry();
    const { data, error } = await primaryClient
      .from("products")
      .insert({ user_id: primaryUserId, name: originalName, expiry_date: originalExpiry })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    cleanupIds.push(data.id);

    clientHolder.current = secondaryClient;
    const response = await PATCH(
      patchRouteContext(data.id, { id: secondaryUserId }, { name: "Hijacked", expiry_date: futureExpiry() }),
    );

    expect(response.status).toBe(404);

    const { data: stillOwned } = await primaryClient
      .from("products")
      .select("name, expiry_date")
      .eq("id", data.id)
      .maybeSingle<{ name: string; expiry_date: string }>();
    expect(stillOwned?.name).toBe(originalName);
    expect(stillOwned?.expiry_date).toBe(originalExpiry);
  });
});
