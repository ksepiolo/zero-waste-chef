import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { listProducts } from "@/lib/services/product.service";
import { generateRecipe } from "@/lib/services/recipe.service";

export const prerender = false;

// Body is optional — a first generation posts nothing. `excludeTitles` carries the
// recipes already shown this session so a regenerate returns something different.
const generateSchema = z.object({
  excludeTitles: z.array(z.string()).max(20).optional(),
});

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
  }
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let excludeTitles: string[] = [];
  try {
    const parsed = generateSchema.safeParse(await context.request.json());
    if (parsed.success) {
      excludeTitles = parsed.data.excludeTitles ?? [];
    }
  } catch {
    // No body, or unparseable — treat as a first generation with nothing to exclude.
  }

  try {
    const products = await listProducts(supabase, context.locals.user.id);
    const atRiskProducts = products.filter((p) => p.is_at_risk);

    if (atRiskProducts.length === 0) {
      return new Response(JSON.stringify({ error: "No at-risk products" }), { status: 400 });
    }

    const recipe = await generateRecipe(atRiskProducts, excludeTitles);
    return new Response(JSON.stringify({ recipe }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
