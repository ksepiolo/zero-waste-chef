import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteProduct } from "@/lib/services/product.service";

export const prerender = false;

export const DELETE: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
  }
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { id } = context.params;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing product id" }), { status: 400 });
  }

  try {
    await deleteProduct(supabase, context.locals.user.id, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "not found") {
      return new Response(JSON.stringify({ error: "Product not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
