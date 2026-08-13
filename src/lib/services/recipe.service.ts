import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { ApproveRecipeInput, GeneratedRecipe, ProductWithRisk } from "@/types";

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
// For the same reason it names no cooking technique and no vessel: the user turn now
// carries per-request technique/time rules, and a worked example that fries in a pan
// contradicts them. It also drops the "at-risk" framing, since the real user turn omits
// that requirement when nothing in the inventory is at risk.
const FEW_SHOT_USER =
  "Create a recipe using these ingredients: canned chickpeas (id: aaa-bbb-111), lemon (id: ccc-ddd-222). Include the exact product IDs in used_product_ids.";

const FEW_SHOT_ASSISTANT = JSON.stringify({
  title: "Lemon Chickpeas",
  ingredients: ["400g canned chickpeas, drained", "1 lemon, juiced and zested", "2 tbsp olive oil", "salt and pepper"],
  instructions: [
    "Drain and rinse the chickpeas.",
    "Zest and juice the lemon.",
    "Combine the chickpeas with the lemon juice, zest and olive oil.",
    "Season with salt and pepper and serve.",
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
          // Wording must not say "at-risk": the prompt list is the whole inventory, so a
          // recipe may legitimately use products that are not at risk — and approve_recipe
          // deletes exactly the IDs reported here.
          description: "IDs of the products from the provided list that this recipe uses",
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
  products: ProductWithRisk[],
  excludeTitles: string[] = [],
): Promise<GeneratedRecipe> {
  // At-risk first, then slice: the cap below would otherwise be able to drop every
  // at-risk product out of the prompt, silently breaking the whole point of the feature.
  // sort() is stable, so the expiry_date ordering from listProducts survives within
  // each group.
  const orderedProducts = [...products].sort((a, b) => Number(b.is_at_risk) - Number(a.is_at_risk));
  // Product names are user-supplied free text, so an unbounded inventory is unbounded
  // token spend on a shared API key. One recipe cannot use more than a handful anyway.
  const promptProducts = orderedProducts.slice(0, MAX_PROMPT_PRODUCTS);

  const atRiskProducts = promptProducts.filter((p) => p.is_at_risk);
  const otherProducts = promptProducts.filter((p) => !p.is_at_risk);
  const render = (list: ProductWithRisk[]) => list.map((p) => `${p.name} (id: ${p.id})`).join(", ");

  // With no at-risk products the prioritization requirement is omitted entirely rather
  // than stated over an empty list — FR-007: "generated freely from the full inventory".
  let userTurn: string;
  if (atRiskProducts.length > 0) {
    userTurn = `Create a recipe from this inventory.\nAt-risk ingredients (expiring soon) — the recipe must use at least one of these: ${render(atRiskProducts)}.`;
    if (otherProducts.length > 0) {
      userTurn += `\nOther available ingredients: ${render(otherProducts)}.`;
    }
    userTurn += `\nInclude the exact product IDs of ingredients you use in used_product_ids.`;
  } else {
    userTurn = `Create a recipe from this inventory: ${render(otherProducts)}. Include the exact product IDs of ingredients you use in used_product_ids.`;
  }

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

  // Sibling invariant. While the prompt list *was* the at-risk list, the cross-check above
  // structurally guaranteed FR-007's at-risk floor. Now that the whole inventory is sent,
  // a recipe using zero at-risk products would pass it — so assert the floor explicitly.
  if (atRiskProducts.length > 0) {
    const atRiskIds = new Set(atRiskProducts.map((p) => p.id));
    if (!recipe.used_product_ids.some((id) => atRiskIds.has(id))) {
      throw new Error("Model ignored all at-risk products — inventory guardrail violated");
    }
  }

  return recipe;
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
