import type { APIRoute } from "astro";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

/**
 * Proves Risk #4 (data isolation) against the real local database: GET /api/recipes,
 * called as the second seeded user, never includes a recipe the first seeded user owns.
 * Mocks `@/lib/supabase`'s createClient to return a real, already-signed-in client — see
 * plan.md's Critical Implementation Details.
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
    "Skipping recipes/index.integration.test.ts — local Supabase is not reachable. Run `npx supabase start` to include it.",
  );
}

type RouteContext = Parameters<APIRoute>[0];

/** GET /api/recipes reads `request`, `cookies` (both ignored by the mocked client), `url` and `locals.user`. */
function routeContext(user: { id: string } | null): RouteContext {
  const url = new URL("https://zero-waste-chef.test/api/recipes");
  const request = new Request(url, { method: "GET" });
  return { request, url, cookies: {}, locals: { user } } as unknown as RouteContext;
}

describe.skipIf(!supabaseReachable)("GET /api/recipes — cross-user isolation", () => {
  let primaryClient: SupabaseClient;
  let secondaryClient: SupabaseClient;
  let primaryUserId: string;
  let secondaryUserId: string;
  let cleanupTitles: string[] = [];

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
    for (const title of cleanupTitles) {
      await primaryClient.from("recipes").delete().eq("title", title);
    }
    cleanupTitles = [];
  });

  // Oracle: [[Always add an app-layer user_id filter alongside RLS on read and delete
  // queries]] — proven here at the route layer, against real RLS, rather than inferred
  // from reading listRecipes's .eq("user_id", userId) chain.
  it("never returns the first user's recipe to the second user", async () => {
    const title = `Isolation ${crypto.randomUUID()}`;
    cleanupTitles.push(title);

    // RLS's WITH CHECK (auth.uid() = user_id) allows this insert since primaryClient is
    // authenticated as primaryUserId; ingredients/consumed_products take their column defaults.
    const { data, error } = await primaryClient
      .from("recipes")
      .insert({ user_id: primaryUserId, title, instructions: "test instructions" })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;

    clientHolder.current = secondaryClient;
    const response = await GET(routeContext({ id: secondaryUserId }));
    const body = (await response.json()) as { recipes: { id: string }[] };

    expect(response.status).toBe(200);
    expect(body.recipes.some((recipe) => recipe.id === data.id)).toBe(false);
  });
});
