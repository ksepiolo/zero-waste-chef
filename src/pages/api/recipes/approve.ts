import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

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

  const { data, error } = await supabase
    .rpc("approve_recipe", {
      p_title: result.data.title,
      p_ingredients: result.data.ingredients,
      // Sole conversion point: AI returns string[], the column is TEXT.
      p_instructions: result.data.instructions.join("\n"),
      p_used_product_ids: result.data.usedProductIds,
    })
    .overrideTypes<string>();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ id: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
