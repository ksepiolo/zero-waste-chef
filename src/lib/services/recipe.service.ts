import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { ApproveRecipeInput, GeneratedRecipe, ProductWithRisk, Recipe, RecipePage } from "@/types";
import { RECIPES_PAGE_SIZE } from "@/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Free tier. Supports json_schema strict mode; rate-limited per OpenRouter's
// free-model quota. Swap to "google/gemini-2.0-flash-001" (paid) if the limit bites.
const MODEL = "google/gemma-4-26b-a4b-it:free";
const GENERATION_TIMEOUT_MS = 30_000;
const MAX_PROMPT_PRODUCTS = 25;

const SYSTEM_PROMPT = `You are a practical home-cooking assistant. Rules:
- Techniques: use only sauté, boil, roast, bake, simmer, fry, stir-fry. Never: sous-vide, fermentation, dehydrating, smoking, pressure cooking.
- Equipment: assume stovetop, oven, one pot, one pan, knife, cutting board. No specialty appliances.
- Time: total recipe time (prep + cook) must not exceed 45 minutes.
- Pantry staples are always available: salt, pepper, oil, water, basic dried spices.
- Never ask follow-up questions. Always generate a recipe immediately.
- used_product_ids must contain only UUID strings from the list provided. Never invent or omit IDs.
- Variety: if the user lists already-suggested recipes, your answer must be a clearly different dish — change the cooking method, the dish format (soup / stir-fry / bake / salad / omelette), and the flavour profile. Renaming or lightly reworking an already-suggested dish is not acceptable.`;

// Deliberately uses ingredients unlikely to appear in a real fridge inventory. The
// few-shot anchors output *format*, and an example built on common staples (spinach,
// garlic) also anchors *content* — the model then returns the example dish back.
const FEW_SHOT_USER =
  "Create a recipe that prioritizes using these at-risk ingredients: canned chickpeas (id: aaa-bbb-111), lemon (id: ccc-ddd-222). Include the exact product IDs in used_product_ids.";

const FEW_SHOT_ASSISTANT = JSON.stringify({
  title: "Lemon Chickpea Skillet",
  ingredients: ["400g canned chickpeas, drained", "1 lemon, juiced and zested", "2 tbsp olive oil", "salt and pepper"],
  instructions: [
    "Heat oil in a pan over medium heat.",
    "Add drained chickpeas and fry for 6 minutes until they start to crisp.",
    "Stir through the lemon juice and zest and cook for 1 more minute.",
    "Season with salt and pepper and serve warm.",
  ],
  used_product_ids: ["aaa-bbb-111", "ccc-ddd-222"],
});

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "recipe",
    strict: true,
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Recipe name" },
        ingredients: {
          type: "array",
          items: { type: "string" },
          description: "Full ingredient list including quantities",
        },
        instructions: {
          type: "array",
          items: { type: "string" },
          description: "Step-by-step cooking instructions, one step per item",
        },
        used_product_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs of the at-risk products used in this recipe",
        },
      },
      required: ["title", "ingredients", "instructions", "used_product_ids"],
      additionalProperties: false,
      // Gemini 2.0 needs explicit ordering; used_product_ids last so the model
      // commits to the recipe before picking IDs.
      propertyOrdering: ["title", "ingredients", "instructions", "used_product_ids"],
    },
  },
};

const GeneratedRecipeSchema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.string()).min(1),
  instructions: z.array(z.string()).min(1),
  used_product_ids: z.array(z.uuid()).min(1),
});

function openRouterErrorMessage(status: number): string {
  if (status === 401 || status === 402) return "Recipe service unavailable — try again later";
  if (status === 429) return "Rate limited — try again shortly";
  return "Recipe generation failed";
}

export async function generateRecipe(
  atRiskProducts: ProductWithRisk[],
  excludeTitles: string[] = [],
): Promise<GeneratedRecipe> {
  // Product names are user-supplied free text, so an unbounded inventory is unbounded
  // token spend on a shared API key. One recipe cannot use more than a handful anyway.
  const promptProducts = atRiskProducts.slice(0, MAX_PROMPT_PRODUCTS);
  const productList = promptProducts.map((p) => `${p.name} (id: ${p.id})`).join(", ");

  let userTurn = `Create a recipe that prioritizes using these at-risk ingredients: ${productList}. Include the exact product IDs of ingredients you use in used_product_ids.`;
  if (excludeTitles.length > 0) {
    userTurn += `\nAlready suggested, do not repeat or reword: ${excludeTitles.map((t) => `"${t}"`).join(", ")}. Give a different dish.`;
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      // Free-tier queueing has been observed at 27s. Without a signal a hung upstream
      // never settles, so the caller's spinner never clears.
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://zero-waste-chef.ksepiolo.workers.dev",
      },
      body: JSON.stringify({
        model: MODEL,
        // Constraint adherence matters most on the first pass; on a regenerate the user
        // has explicitly asked for something else, so trade some obedience for spread.
        temperature: excludeTitles.length > 0 ? 0.9 : 0.4,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: FEW_SHOT_USER },
          { role: "assistant", content: FEW_SHOT_ASSISTANT },
          { role: "user", content: userTurn },
        ],
        response_format: RESPONSE_FORMAT,
        plugins: [{ id: "response-healing" }],
      }),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("Recipe generation timed out — try again");
    }
    throw err;
  }

  if (!response.ok) {
    const text = await response.text();
    // The upstream body carries account and quota metadata for the shared API key.
    // Log it for diagnosis; the thrown message is what reaches the user's toast.
    // eslint-disable-next-line no-console -- server-side diagnostic for an external failure
    console.error(`OpenRouter ${response.status}: ${text}`);
    throw new Error(openRouterErrorMessage(response.status));
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response");
  }

  // Content is a JSON string even in json_schema mode.
  const recipe = GeneratedRecipeSchema.parse(JSON.parse(content));

  // Schema validates syntax, not semantics — cross-check the IDs against the inventory.
  const validIds = new Set(promptProducts.map((p) => p.id));
  if (!recipe.used_product_ids.every((id) => validIds.has(id))) {
    throw new Error("Model returned unknown product IDs — inventory guardrail violated");
  }

  return recipe;
}

/**
 * Reads one page of the user's approved recipes, newest first. `page` is 1-based.
 * A page beyond the end returns an empty array with the true total — PostgREST does
 * not error on an out-of-range .range(), and the UI treats that as the last page.
 */
export async function listRecipes(supabase: SupabaseClient, userId: string, page: number): Promise<RecipePage> {
  const from = (page - 1) * RECIPES_PAGE_SIZE;

  const { data, count, error } = await supabase
    .from("recipes")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, from + RECIPES_PAGE_SIZE - 1);

  if (error) throw new Error(error.message);

  return { recipes: data as Recipe[], total: count ?? 0 };
}

/**
 * Atomically snapshots the used products, inserts the recipe and deletes the products.
 * The RPC is the only transactional path — PostgREST cannot span the three statements.
 */
export async function approveRecipe(supabase: SupabaseClient, input: ApproveRecipeInput): Promise<string> {
  const { data, error } = await supabase
    .rpc("approve_recipe", {
      p_title: input.title,
      p_ingredients: input.ingredients,
      // Sole conversion point: AI returns string[], the column is TEXT.
      p_instructions: input.instructions.join("\n"),
      p_used_product_ids: input.usedProductIds,
    })
    .overrideTypes<string>();

  if (error) throw new Error(error.message);

  // approve_recipe RETURNS UUID — a scalar. With no generated Database types supabase-js
  // infers an array shape, so overrideTypes<string> resolves to a branded union rather
  // than plain string. Narrow it here; the request itself is unchanged.
  const id = data as unknown as string | null;
  if (!id) throw new Error("Recipe was not saved");

  return id;
}
