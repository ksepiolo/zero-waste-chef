import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { ApproveRecipeInput, GeneratedRecipe, ProductWithRisk, Recipe, RecipePage, RecipeParams } from "@/types";
import { DEFAULT_RECIPE_PARAMS, RECIPES_PAGE_SIZE } from "@/types";
import { buildSystemPrompt, FEW_SHOT_USER, FEW_SHOT_ASSISTANT } from "./recipe-prompt";
import { ServiceError, type ServiceErrorKind } from "./service-error";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Free tier. Supports json_schema strict mode; rate-limited per OpenRouter's
// free-model quota. Swap to "google/gemini-2.0-flash-001" (paid) if the limit bites.
const MODEL = "google/gemma-4-26b-a4b-it:free";
const GENERATION_TIMEOUT_MS = 30_000;
const MAX_PROMPT_PRODUCTS = 25;

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

/**
 * The failure class an upstream status belongs to. The wording each one carries lives in
 * service-error.ts; this function only decides which class we are in — 401/402 is our account
 * being unusable, 429 is worth retrying shortly, anything else is a fault we cannot attribute.
 */
function openRouterErrorKind(status: number): ServiceErrorKind {
  if (status === 401 || status === 402) return "provider_unavailable";
  if (status === 429) return "rate_limit";
  return "upstream_fault";
}

export async function generateRecipe(
  products: ProductWithRisk[],
  excludeTitles: string[] = [],
  params: RecipeParams = DEFAULT_RECIPE_PARAMS,
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
  // Names are user free text (validated only as a ≤255-char string) and the user turn is
  // now newline-delimited and multi-section — an embedded newline could otherwise forge an
  // "Other available ingredients:" header and demote the at-risk framing.
  const sanitizeName = (name: string) => name.replace(/[\r\n]+/g, " ").slice(0, 60);
  const render = (list: ProductWithRisk[]) => list.map((p) => `${sanitizeName(p.name)} (id: ${p.id})`).join(", ");

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
          { role: "system", content: buildSystemPrompt(params) },
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
      throw new ServiceError("timeout", { cause: err });
    }
    // Deliberately still a bare rethrow: a transport failure is not a timeout, and telling the
    // user to wait and retry is the one thing that will not help. It surfaces as the
    // endpoint's generic 500 rather than being mislabelled as a class it is not.
    throw err;
  }

  if (!response.ok) {
    const text = await response.text();
    // The upstream body carries account and quota metadata for the shared API key.
    // Log it for diagnosis; the thrown message is what reaches the user's toast.
    // eslint-disable-next-line no-console -- server-side diagnostic for an external failure
    console.error(`OpenRouter ${response.status}: ${text}`);
    throw new ServiceError(openRouterErrorKind(response.status));
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    // eslint-disable-next-line no-console -- the cause is only distinguishable in the log
    console.error("OpenRouter returned an empty response");
    throw new ServiceError("unusable_model_response");
  }

  // Content is a JSON string even in json_schema mode.
  const recipe = GeneratedRecipeSchema.parse(JSON.parse(content));

  // Schema validates syntax, not semantics — cross-check the IDs against the inventory.
  const validIds = new Set(promptProducts.map((p) => p.id));
  if (!recipe.used_product_ids.every((id) => validIds.has(id))) {
    // eslint-disable-next-line no-console -- the cause is only distinguishable in the log
    console.error("Model returned unknown product IDs — inventory guardrail violated");
    throw new ServiceError("unusable_model_response");
  }

  // Sibling invariant. While the prompt list *was* the at-risk list, the cross-check above
  // structurally guaranteed FR-007's at-risk floor. Now that the whole inventory is sent,
  // a recipe using zero at-risk products would pass it — so assert the floor explicitly.
  if (atRiskProducts.length > 0) {
    const atRiskIds = new Set(atRiskProducts.map((p) => p.id));
    if (!recipe.used_product_ids.some((id) => atRiskIds.has(id))) {
      // eslint-disable-next-line no-console -- the cause is only distinguishable in the log
      console.error("Model ignored all at-risk products — inventory guardrail violated");
      throw new ServiceError("unusable_model_response");
    }
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
