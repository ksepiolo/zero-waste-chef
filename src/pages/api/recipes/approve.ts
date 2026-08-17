import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { approveRecipe } from "@/lib/services/recipe.service";
import { ServiceError } from "@/lib/services/service-error";

export const prerender = false;

const approveRecipeSchema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.string()).min(1),
  instructions: z.array(z.string()).min(1),
  usedProductIds: z.array(z.uuid()).min(1),
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
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const result = approveRecipeSchema.safeParse(body);
  if (!result.success) {
    const error = result.error.issues[0]?.message ?? "Validation error";
    return new Response(JSON.stringify({ error }), { status: 400 });
  }

  try {
    const { id, deletedIds } = await approveRecipe(supabase, result.data);
    return new Response(JSON.stringify({ id, deletedIds }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // The allowlist is a *type*, not a habit: only a ServiceError — which the service layer
    // constructs from a fixed table of statuses and copy we wrote — can set the status and
    // reach the toast. Anything else is a bug in our own code or a library throwing from
    // somewhere unexpected, and its message is by definition not something we have vetted.
    if (err instanceof ServiceError) {
      return new Response(JSON.stringify({ error: err.message }), { status: err.status });
    }

    // eslint-disable-next-line no-console -- an unconverted throw is a defect worth surfacing
    console.error("Unhandled error in POST /api/recipes/approve:", err);
    return new Response(JSON.stringify({ error: "Something went wrong — try again" }), { status: 500 });
  }
};
