import { describe, expect, it } from "vitest";

import { RECIPE_METHODS, RECIPE_TECHNIQUES, RECIPE_TIMES } from "@/types";
import type { RecipeMethod, RecipeTechnique, RecipeTime } from "@/types";

import { buildSystemPrompt } from "./recipe-prompt";

const ALL_ANY = { technique: "any", method: "any", time: "any" } as const;

const NON_ANY_TECHNIQUES = RECIPE_TECHNIQUES.filter((technique): technique is Exclude<RecipeTechnique, "any"> => {
  return technique !== "any";
});
const NON_ANY_METHODS = RECIPE_METHODS.filter((method): method is Exclude<RecipeMethod, "any"> => method !== "any");
const NON_ANY_TIMES = RECIPE_TIMES.filter((time): time is Exclude<RecipeTime, "any"> => time !== "any");

// Phase 1 smoke test: proves the runner environment itself, not the prompt's contents.
describe("test environment", () => {
  it("resolves a relative service import and renders a prompt", () => {
    const prompt = buildSystemPrompt(ALL_ANY);

    expect(prompt.length).toBeGreaterThan(0);
  });

  it("loads a module importing astro:env/server without mocking", async () => {
    // recipe.service.ts pulls OPENROUTER_API_KEY from astro:env/server, which only resolves
    // when Astro's virtual-module plugin is registered. This import failing means
    // vitest.config.ts stopped going through getViteConfig().
    const recipeService = await import("@/lib/services/recipe.service");

    expect(recipeService.generateRecipe).toBeTypeOf("function");
  });

  it("runs with the clock pinned to UTC", () => {
    // Guards vitest.config.ts's env.TZ — the boundary tables in product.service.test.ts are
    // only deterministic if this holds.
    expect(new Date().getTimezoneOffset()).toBe(0);
  });
});

// The prompt that shipped before generation parameters existed, recovered verbatim from
// `git show d137c98^:src/lib/services/recipe.service.ts` (the SYSTEM_PROMPT const, 913
// bytes). This is the oracle recipe-prompt.ts:57-59 names as its acceptance criterion, and
// it comes from history rather than from the current implementation — copying the module's
// own output would only prove the module equals itself.
const PRE_PARAMETER_SYSTEM_PROMPT = `You are a practical home-cooking assistant. Rules:
- Techniques: use only sauté, boil, roast, bake, simmer, fry, stir-fry. Never: sous-vide, fermentation, dehydrating, smoking, pressure cooking.
- Equipment: assume stovetop, oven, one pot, one pan, knife, cutting board. No specialty appliances.
- Time: total recipe time (prep + cook) must not exceed 45 minutes.
- Pantry staples are always available: salt, pepper, oil, water, basic dried spices.
- Never ask follow-up questions. Always generate a recipe immediately.
- used_product_ids must contain only UUID strings from the list provided. Never invent or omit IDs.
- Variety: if the user lists already-suggested recipes, your answer must be a clearly different dish — change the cooking method, the dish format (soup / stir-fry / bake / salad / omelette), and the flavour profile. Renaming or lightly reworking an already-suggested dish is not acceptable.`;

/** The `- Techniques:` lines in a rendered prompt. There must be exactly one. */
function techniqueLines(prompt: string): string[] {
  return prompt.split("\n").filter((line) => line.startsWith("- Techniques:"));
}

describe("buildSystemPrompt", () => {
  it("reproduces the pre-parameter system prompt byte for byte when nothing is constrained", () => {
    expect(buildSystemPrompt(ALL_ANY)).toBe(PRE_PARAMETER_SYSTEM_PROMPT);
  });

  // A prompt carrying two conflicting technique instructions is ambiguous by construction:
  // the model follows one of them and the user's selection becomes a coin flip. The rule is
  // that a selection *rewrites* the generic line rather than being appended below it, so the
  // count is the assertion — not the wording, which is free to change.
  it.each(NON_ANY_TECHNIQUES)("renders exactly one Techniques line for technique '%s'", (technique) => {
    const lines = techniqueLines(buildSystemPrompt({ ...ALL_ANY, technique }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("use only sauté, boil, roast, bake, simmer, fry, stir-fry");
  });

  it("renders exactly one Techniques line when the technique is unconstrained", () => {
    expect(techniqueLines(buildSystemPrompt(ALL_ANY))).toHaveLength(1);
  });

  // The Never clause is the non-negotiable half of the technique rule: it bounds the
  // equipment the recipe may assume (prd.md's NFR — no professional equipment). A selected
  // technique rewrites the line, so the clause has to survive that rewrite.
  it.each(RECIPE_TECHNIQUES)("keeps the Never clause for technique '%s'", (technique) => {
    expect(buildSystemPrompt({ ...ALL_ANY, technique })).toContain(
      "Never: sous-vide, fermentation, dehydrating, smoking, pressure cooking.",
    );
  });

  // Oracle: types.ts:63-64 — "Every value is at or below the 45-minute cap the prompt
  // already enforced — the control only narrows it." So the rendered cap is the selection,
  // and no selection may widen it past 45.
  it.each([...NON_ANY_TIMES, "any"] as const)("caps total time at the selected value for time '%s'", (time) => {
    const capLine = /^- Time:.*?(\d+) minutes\.$/m.exec(buildSystemPrompt({ ...ALL_ANY, time }));
    const cap = Number(capLine?.[1]);

    expect(cap).toBe(time === "any" ? 45 : Number(time));
    expect(cap).toBeLessThanOrEqual(45);
  });

  // A dish-format line is emitted only for a selection; "any" adds no line at all, which is
  // what keeps the all-any render byte-identical to the pre-parameter prompt.
  it.each(NON_ANY_METHODS)("renders exactly one Dish format line for method '%s'", (method) => {
    const lines = buildSystemPrompt({ ...ALL_ANY, method })
      .split("\n")
      .filter((line) => line.startsWith("- Dish format:"));

    expect(lines).toHaveLength(1);
  });

  it("renders no Dish format line when the method is unconstrained", () => {
    expect(buildSystemPrompt(ALL_ANY)).not.toContain("- Dish format:");
  });
});
