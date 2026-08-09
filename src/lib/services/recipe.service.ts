import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { GeneratedRecipe, ProductWithRisk } from "@/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Free tier. Supports json_schema strict mode; rate-limited per OpenRouter's
// free-model quota. Swap to "google/gemini-2.0-flash-001" (paid) if the limit bites.
const MODEL = "google/gemma-4-26b-a4b-it:free";

const SYSTEM_PROMPT = `You are a practical home-cooking assistant. Rules:
- Techniques: use only sauté, boil, roast, bake, simmer, fry, stir-fry. Never: sous-vide, fermentation, dehydrating, smoking, pressure cooking.
- Equipment: assume stovetop, oven, one pot, one pan, knife, cutting board. No specialty appliances.
- Time: total recipe time (prep + cook) must not exceed 45 minutes.
- Pantry staples are always available: salt, pepper, oil, water, basic dried spices.
- Never ask follow-up questions. Always generate a recipe immediately.
- used_product_ids must contain only UUID strings from the list provided. Never invent or omit IDs.`;

const FEW_SHOT_USER =
  "Create a recipe that prioritizes using these at-risk ingredients: spinach (id: aaa-bbb-111), garlic (id: ccc-ddd-222). Include the exact product IDs in used_product_ids.";

const FEW_SHOT_ASSISTANT = JSON.stringify({
  title: "Garlic Sautéed Spinach",
  ingredients: ["200g fresh spinach", "3 cloves garlic, minced", "2 tbsp olive oil", "salt to taste"],
  instructions: [
    "Heat oil in a pan over medium heat.",
    "Add garlic and sauté for 1 minute until fragrant.",
    "Add spinach and cook for 3 minutes, stirring, until wilted.",
    "Season with salt and serve immediately.",
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

export async function generateRecipe(atRiskProducts: ProductWithRisk[]): Promise<GeneratedRecipe> {
  const productList = atRiskProducts.map((p) => `${p.name} (id: ${p.id})`).join(", ");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://zero-waste-chef.ksepiolo.workers.dev",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: FEW_SHOT_USER },
        { role: "assistant", content: FEW_SHOT_ASSISTANT },
        {
          role: "user",
          content: `Create a recipe that prioritizes using these at-risk ingredients: ${productList}. Include the exact product IDs of ingredients you use in used_product_ids.`,
        },
      ],
      response_format: RESPONSE_FORMAT,
      plugins: [{ id: "response-healing" }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response");
  }

  // Content is a JSON string even in json_schema mode.
  const recipe = GeneratedRecipeSchema.parse(JSON.parse(content));

  // Schema validates syntax, not semantics — cross-check the IDs against the inventory.
  const validIds = new Set(atRiskProducts.map((p) => p.id));
  if (!recipe.used_product_ids.every((id) => validIds.has(id))) {
    throw new Error("Model returned unknown product IDs — inventory guardrail violated");
  }

  return recipe;
}
