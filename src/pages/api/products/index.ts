import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { listProducts, createProduct } from "@/lib/services/product.service";

export const prerender = false;

const createProductSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .refine((val) => val >= new Date().toISOString().split("T")[0], "Expiry date must be today or in the future"),
});

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
  }
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const products = await listProducts(supabase);
    return new Response(JSON.stringify({ products }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

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

  const result = createProductSchema.safeParse(body);
  if (!result.success) {
    const error = result.error.issues[0]?.message ?? "Validation error";
    return new Response(JSON.stringify({ error }), { status: 400 });
  }

  try {
    const product = await createProduct(supabase, context.locals.user.id, result.data);
    return new Response(JSON.stringify({ product }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
