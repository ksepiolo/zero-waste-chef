import type { APIRoute } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

import { POST } from "./generate";

// Same substitution as recipe.service.test.ts: the real key is absent under the runner, so
// a recognisable stand-in is what makes "the response body does not contain the key" a
// real assertion rather than a check that the string "undefined" is missing.
const { OPENROUTER_TEST_KEY } = vi.hoisted(() => ({ OPENROUTER_TEST_KEY: "sk-or-v1-endpoint-key-must-not-leak" }));

vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: OPENROUTER_TEST_KEY }));

/**
 * createClient() returns null whenever SUPABASE_URL/SUPABASE_KEY are unset, and the
 * endpoint short-circuits to 503 before reaching anything interesting. Without this stub
 * every test below would assert 503 and prove nothing. The inventory is served from a
 * mutable holder so each test sets the rows it needs. No local database is involved —
 * test-plan §3 Phase 1 is hermetic; the database layer is Phase 2's.
 */
interface QueryStub {
  select: () => QueryStub;
  eq: () => QueryStub;
  order: () => Promise<{ data: unknown; error: null }>;
}

const supabase = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/supabase", () => ({
  createClient: () => {
    const query: QueryStub = {
      select: () => query,
      eq: () => query,
      order: () => Promise.resolve({ data: supabase.rows, error: null }),
    };

    return { from: () => query };
  },
}));

const ENDPOINT_URL = "https://zero-waste-chef.test/api/recipes/generate";
const USER = { id: "11111111-1111-4111-8111-111111111111" };

/** Deterministic v4-shaped id — GeneratedRecipeSchema rejects non-UUID used_product_ids. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * A product `dayOffset` days from today, defaulting to 30 days out — so listProducts derives
 * is_at_risk = false against the real clock. Nothing in this file is at risk on purpose: the
 * at-risk floor guard is Risk #1's and is covered in recipe.service.test.ts, and letting it
 * fire here would mask which failure the endpoint is actually reporting. Every pre-existing
 * caller keeps the +30 default, so the exclusion cases below are the only past-dated rows.
 */
function productRow(n: number, dayOffset = 30): Product {
  const expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + dayOffset);

  return {
    id: uuid(n),
    user_id: USER.id,
    name: `Product ${n}`,
    expiry_date: expiry.toISOString().split("T")[0],
    created_at: "2026-08-01T00:00:00Z",
  };
}

type RouteContext = Parameters<APIRoute>[0];

/**
 * generate.ts reads exactly three things off its context: `request`, `cookies` (handed
 * straight to the stubbed createClient, which ignores it) and `locals.user`. Astro's real
 * APIContext is an order of magnitude wider and building it whole would be fiction, so the
 * cast is confined to this one helper — no test below needs `any`. Keep it here until a
 * third file needs it (test-plan §7: no fixture factories before the pattern repeats).
 */
function routeContext({ body, user = USER }: { body?: string; user?: { id: string } | null } = {}): RouteContext {
  const request = new Request(ENDPOINT_URL, body === undefined ? { method: "POST" } : { method: "POST", body });

  return { request, cookies: {}, locals: { user } } as unknown as RouteContext;
}

/** A well-formed OpenRouter success envelope; content is a JSON string, as in json_schema mode. */
function providerSuccess(usedProductIds: string[]): Response {
  const content = JSON.stringify({
    title: "Test dish",
    ingredients: ["1 unit of something"],
    instructions: ["Cook it."],
    used_product_ids: usedProductIds,
  });

  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

const UPSTREAM_MARKER = "acct_9931_quota_and_billing_metadata";
const UPSTREAM_BODY = JSON.stringify({
  error: { message: `Insufficient credits for ${UPSTREAM_MARKER}`, metadata: { key: OPENROUTER_TEST_KEY } },
});

beforeEach(() => {
  supabase.rows = [productRow(1)];
  // The service logs the upstream body on a non-2xx; stubbing keeps the suite readable.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  supabase.rows = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Oracle: test-plan §2 Risk #6 — a generation failure must never surface as success, and
// must carry "no fabricated recipe, and no provider key or raw upstream error body in the
// response". This file asserts the endpoint half of that. It never asserts a status code
// value: today every failure class collapses onto one flat 500, which the test plan calls
// wrong, and differentiating them is deferred to expired-product-handling. Pinning 500
// would pin the defect and break the moment the fix lands — so the assertion is the
// oracle-true one, "not a success".
describe("POST /api/recipes/generate — a failed generation is reported as a failure", () => {
  it("does not answer a provider failure with a success", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(UPSTREAM_BODY, { status: 503 })));

    const response = await POST(routeContext());

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  // approve_recipe deletes exactly the ids a recipe reports, so a `recipe` key present on a
  // failed generation is not a cosmetic bug — it is a deletion the user never agreed to,
  // one confirmation click away.
  it("returns no recipe payload when generation failed", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(UPSTREAM_BODY, { status: 503 })));

    const response = await POST(routeContext());
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty("recipe");
  });

  // The client renders the error field verbatim as a toast, so whatever survives into this
  // body is shown to the user — and the key is shared across the whole deployment.
  it("leaks neither the shared key nor the upstream body into the response", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(UPSTREAM_BODY, { status: 402 })));

    const response = await POST(routeContext());
    const body = await response.text();

    expect(body).not.toContain(OPENROUTER_TEST_KEY);
    expect(body).not.toContain(UPSTREAM_MARKER);
  });

  // A request the caller can no longer wait on has to come back. Left unhandled it is the
  // "indefinite wait" half of Risk #6: the spinner never clears and nothing tells the user
  // the generation is gone.
  it("answers a timed-out generation instead of leaving the caller waiting", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new DOMException("aborted due to timeout", "TimeoutError")));

    const response = await POST(routeContext());

    expect(response.ok).toBe(false);
  });
});

describe("POST /api/recipes/generate — request preconditions", () => {
  // Oracle: PRD §Guardrails "Data isolation" — inventory is per user, so an unauthenticated
  // caller has no inventory to generate from. The check must also come *before* the
  // provider call: an unauthenticated request that still spends the shared key is Risk #6's
  // resource-abuse neighbour.
  it("refuses an unauthenticated caller without calling the provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(routeContext({ user: null }));

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Oracle: generate.ts:51-57 names this as the one deliberate exception to "generation is
  // never blocked by inventory state" — that rule exists so an empty *at-risk* window is not
  // an error, and a recipe from nothing is not a meaningful request. The UI hides the
  // button in this state, so this branch is reachable only by a direct API call.
  it("refuses to generate from an empty inventory without calling the provider", async () => {
    supabase.rows = [];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(routeContext());

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Oracle: generate.ts:10-20 and :31-38 state the requirement — the first generation of a
// session posts no body at all, and every generation parameter is a closed enum defaulting
// to "any", so `{}` is a complete valid request. Read cold, swallowing a json() failure
// looks like a swallowed bug and is exactly the kind of thing a later refactor "fixes" into
// a 400 that breaks the primary flow. These two cases pin the intent, and the second one
// keeps the swallow from being mistaken for "any body is acceptable".
describe("POST /api/recipes/generate — an absent body is a valid request", () => {
  it("generates when the request carries no body at all", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(providerSuccess([uuid(1)])));

    const response = await POST(routeContext());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("recipe");
  });

  it("generates when the request body is present but unparseable", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(providerSuccess([uuid(1)])));

    const response = await POST(routeContext({ body: "not json at all" }));

    expect(response.status).toBe(200);
  });

  // The closed lists are a server-side contract, not a dropdown convenience: the endpoint
  // is reachable without the UI, and these values go straight into the prompt on a shared
  // key. A parseable body still has to clear validation.
  it("rejects a parseable body carrying an out-of-list parameter", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(routeContext({ body: JSON.stringify({ technique: "flambe" }) }));

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Oracle: research.md decisions D2 and D3a (resolved oracle, 2026-08-15) — an expired product
// is filtered out *before* the at-risk sort and the prompt cap, so it never reaches the model
// and never enters the at-risk floor set; and the response reports which products were
// excluded. Asserted at the outbound request rather than at the recipe, because the recipe is
// the stub's and only the prompt shows what the model was actually offered.
describe("POST /api/recipes/generate — expired products are excluded and reported", () => {
  const fresh = productRow(1);
  const expired = productRow(2, -1);

  /** Stubs a successful provider and hands back the outbound request body for inspection. */
  function stubProvider(usedProductIds: string[]): { outbound: () => string } {
    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((...args: unknown[]) => {
        // recipe.service.ts always sends a JSON string body; narrowing to that rather than
        // RequestInit keeps the capture from silently stringifying some other BodyInit.
        body = (args[1] as { body?: string }).body ?? "";
        return Promise.resolve(providerSuccess(usedProductIds));
      }),
    );

    return { outbound: () => body };
  }

  it("keeps an expired product out of the prompt", async () => {
    supabase.rows = [expired, fresh];
    const provider = stubProvider([fresh.id]);

    await POST(routeContext());

    // The fresh id proves the prompt really carries the inventory, so the negative below
    // cannot pass by the request simply not existing.
    expect(provider.outbound()).toContain(fresh.id);
    expect(provider.outbound()).not.toContain(expired.id);
    expect(provider.outbound()).not.toContain(expired.name);
  });

  it("still generates a recipe from the remaining fresh stock", async () => {
    supabase.rows = [expired, fresh];
    stubProvider([fresh.id]);

    const response = await POST(routeContext());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("recipe");
  });

  // Set identity, not a count: the user is shown these names, so reporting the wrong product
  // as skipped is the same defect as reporting the wrong number of them.
  it("reports exactly the products it excluded", async () => {
    supabase.rows = [expired, fresh];
    stubProvider([fresh.id]);

    const response = await POST(routeContext());
    const body = (await response.json()) as { excluded_expired: unknown };

    expect(body.excluded_expired).toEqual([{ id: expired.id, name: expired.name }]);
  });

  // The key is always present so the client needs no presence check — an absent key and an
  // empty list are the same fact, and only one of them is safe to consume.
  it("reports an empty exclusion list when nothing was expired", async () => {
    supabase.rows = [fresh];
    stubProvider([fresh.id]);

    const response = await POST(routeContext());
    const body = (await response.json()) as { excluded_expired: unknown };

    expect(body.excluded_expired).toEqual([]);
  });
});
