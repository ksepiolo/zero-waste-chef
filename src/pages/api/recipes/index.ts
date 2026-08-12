import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { listRecipes } from "@/lib/services/recipe.service";

export const prerender = false;

// max(1000) rejects rather than clamps, so a hand-crafted ?page=99999999 cannot push a
// pointless large offset at the database and the caller is told the request was wrong.
const pageSchema = z.coerce
  .number()
  .int()
  .min(1, "Page must be 1 or greater")
  .max(1000, "Page is out of range")
  .default(1);

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
  }
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Normalize null → undefined: searchParams.get returns null when absent, and
  // z.coerce runs Number(null) === 0, which fails min(1) and would 400 the bare
  // GET /api/recipes. Only undefined triggers .default().
  const result = pageSchema.safeParse(context.url.searchParams.get("page") ?? undefined);
  if (!result.success) {
    const error = result.error.issues[0]?.message ?? "Validation error";
    return new Response(JSON.stringify({ error }), { status: 400 });
  }

  try {
    const page = await listRecipes(supabase, context.locals.user.id, result.data);
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
