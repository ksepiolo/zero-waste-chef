import type { RecipeParams, RecipeMethod, RecipeTechnique } from "@/types";

// Deliberately free of `astro:env` imports. recipe.service.ts pulls OPENROUTER_API_KEY
// from that virtual module, which only resolves inside an Astro build — a plain node
// script importing it dies with ServerOnlyModule before reaching any prompt code. Keeping
// the prompt here (and type-only on the @/types import, so node's type stripping erases
// it) is what makes the Any/Any/Any byte-identity check runnable outside a build.

const NEVER_CLAUSE = "Never: sous-vide, fermentation, dehydrating, smoking, pressure cooking.";

const ANY_TECHNIQUE_LINE = `- Techniques: use only sauté, boil, roast, bake, simmer, fry, stir-fry. ${NEVER_CLAUSE}`;

// A selection *rewrites* the Techniques line rather than appending a preference below it.
// Appending leaves the model with two conflicting instructions, and it follows the first.
const TECHNIQUE_LINES: Record<Exclude<RecipeTechnique, "any">, string> = {
  saute: `- Techniques: sautéing is the required primary cooking technique. ${NEVER_CLAUSE}`,
  roast: `- Techniques: roasting is the required primary cooking technique. ${NEVER_CLAUSE}`,
  bake: `- Techniques: baking is the required primary cooking technique. ${NEVER_CLAUSE}`,
  "boil-simmer": `- Techniques: boiling or simmering is the required primary cooking technique. ${NEVER_CLAUSE}`,
  "stir-fry": `- Techniques: stir-frying is the required primary cooking technique. ${NEVER_CLAUSE}`,
  fry: `- Techniques: frying is the required primary cooking technique. ${NEVER_CLAUSE}`,
  "no-cook": `- Techniques: the dish must require no cooking at all — no heat at any step. ${NEVER_CLAUSE}`,
};

// Emitted only for a non-"any" method, so Any adds no line at all.
const METHOD_LINES: Record<Exclude<RecipeMethod, "any">, string> = {
  "one-pot": "- Dish format: the recipe must be a one-pot dish — everything cooks in a single pot or pan.",
  "sheet-pan": "- Dish format: the recipe must be a sheet-pan dish — everything cooks together on one tray.",
  "salad-assembly":
    "- Dish format: the recipe must be a salad or an assembled dish — components combined rather than cooked into one another.",
  soup: "- Dish format: the recipe must be a soup.",
};

const timeLine = (minutes: string) => `- Time: total recipe time (prep + cook) must not exceed ${minutes} minutes.`;

// The Variety rule fires on a regenerate, and it names the axes the model should change.
// A pinned technique or method must be struck from that list: telling the model to "change
// the cooking method" while another rule requires sautéing is the same contradiction the
// technique line is rewritten to avoid. With both dimensions pinned the only room left is
// flavour and preparation — not the ingredients themselves, which the user turn pins to the
// at-risk floor. All-"any" reproduces the original wording exactly.
function varietyLine(params: RecipeParams): string {
  const axes: string[] = [];
  if (params.technique === "any") axes.push("the cooking method");
  if (params.method === "any") axes.push("the dish format (soup / stir-fry / bake / salad / omelette)");
  axes.push("the flavour profile");
  if (axes.length === 1) axes.push("how the same ingredients are prepared");

  const joined = axes.length > 2 ? `${axes.slice(0, -1).join(", ")}, and ${axes[axes.length - 1]}` : axes.join(" and ");

  return `- Variety: if the user lists already-suggested recipes, your answer must be a clearly different dish — change ${joined}. Renaming or lightly reworking an already-suggested dish is not acceptable.`;
}

/**
 * Renders the system rules for one request.
 *
 * `{ technique: "any", method: "any", time: "any" }` must reproduce the pre-parameter
 * SYSTEM_PROMPT byte for byte — that is the acceptance test for this module, and the
 * reason the Any branches reuse the original text verbatim instead of restating it.
 */
export function buildSystemPrompt(params: RecipeParams): string {
  const lines = [
    "You are a practical home-cooking assistant. Rules:",
    params.technique === "any" ? ANY_TECHNIQUE_LINE : TECHNIQUE_LINES[params.technique],
  ];

  if (params.method !== "any") {
    lines.push(METHOD_LINES[params.method]);
  }

  lines.push(
    "- Equipment: assume stovetop, oven, one pot, one pan, knife, cutting board. No specialty appliances.",
    timeLine(params.time === "any" ? "45" : params.time),
    "- Pantry staples are always available: salt, pepper, oil, water, basic dried spices.",
    "- Never ask follow-up questions. Always generate a recipe immediately.",
    "- used_product_ids must contain only UUID strings from the list provided. Never invent or omit IDs.",
    varietyLine(params),
  );

  return lines.join("\n");
}

// Deliberately uses ingredients unlikely to appear in a real fridge inventory. The
// few-shot anchors output *format*, and an example built on common staples (spinach,
// garlic) also anchors *content* — the model then returns the example dish back.
// For the same reason it names no cooking technique and no vessel: the user turn now
// carries per-request technique/time rules, and a worked example that fries in a pan
// contradicts them. It also drops the "at-risk" framing, since the real user turn omits
// that requirement when nothing in the inventory is at risk.
export const FEW_SHOT_USER =
  "Create a recipe using these ingredients: canned chickpeas (id: aaa-bbb-111), lemon (id: ccc-ddd-222). Include the exact product IDs in used_product_ids.";

export const FEW_SHOT_ASSISTANT = JSON.stringify({
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
