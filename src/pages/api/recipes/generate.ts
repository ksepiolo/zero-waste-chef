import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { listProducts } from "@/lib/services/product.service";
import { generateRecipe } from "@/lib/services/recipe.service";
import type { ExcludedProduct } from "@/types";
import { RECIPE_METHODS, RECIPE_TECHNIQUES, RECIPE_TIMES } from "@/types";

export const prerender = false;

// Body is optional — a first generation posts nothing. `excludeTitles` carries the
// recipes already shown this session so a regenerate returns something different.
// Bounded on both axes: these strings go straight into the prompt on a shared API key.
// The three parameters are closed enums for the same reason, and each defaults to "any"
// so a body omitting them stays valid.
const generateSchema = z.object({
  excludeTitles: z.array(z.string().max(120)).max(10).optional(),
  technique: z.enum(RECIPE_TECHNIQUES).default("any"),
  method: z.enum(RECIPE_METHODS).default("any"),
  time: z.enum(RECIPE_TIMES).default("any"),
});

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
  }
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    // No body at all — a first generation posts nothing. A body that is present but
    // malformed still falls through to validation below.
    body = {};
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues[0]?.message ?? "Validation error";
    return new Response(JSON.stringify({ error }), { status: 400 });
  }
  const excludeTitles = parsed.data.excludeTitles ?? [];
  const { technique, method, time } = parsed.data;

  try {
    const products = await listProducts(supabase, context.locals.user.id);

    // Narrow, deliberate exception to "generation is never blocked by inventory state":
    // that rule exists so an empty *at-risk* window is not an error. A recipe from nothing
    // is not a meaningful request. The UI hides the button in this state, so this branch is
    // reachable only by a direct API call.
    if (products.length === 0) {
      return new Response(JSON.stringify({ error: "Inventory is empty — add a product first" }), { status: 400 });
    }

    // Expired stock never reaches the model: it is sorted ahead of fresh stock in the
    // prompt and then required by the at-risk floor guard, so leaving it in makes a
    // year-old product a precondition for getting any recipe at all. The partition runs
    // here rather than inside the service so generateRecipe's signature and resolved
    // shape stay untouched.
    const usableProducts = products.filter((product) => !product.is_expired);
    // Always present, empty when nothing was held back — callers branch on length, not
    // on the key existing.
    const excludedExpired: ExcludedProduct[] = products
      .filter((product) => product.is_expired)
      .map(({ id, name }) => ({ id, name }));

    const recipe = await generateRecipe(usableProducts, excludeTitles, { technique, method, time });
    return new Response(JSON.stringify({ recipe, excluded_expired: excludedExpired }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
