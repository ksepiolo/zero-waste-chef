import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { deleteProduct, updateProduct } from "@/lib/services/product.service";
import { productSchema } from "@/lib/services/product.schema";

export const prerender = false;

export const PATCH: APIRoute = async (context) => {
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const result = productSchema.safeParse(body);
  if (!result.success) {
    const error = result.error.issues[0]?.message ?? "Validation error";
    return new Response(JSON.stringify({ error }), { status: 400 });
  }

  try {
    const product = await updateProduct(supabase, context.locals.user.id, id, result.data);
    return new Response(JSON.stringify({ product }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "not found") {
      return new Response(JSON.stringify({ error: "Product not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

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
