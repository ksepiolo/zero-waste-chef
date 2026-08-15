import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./recipe-prompt";

// Phase 1 smoke test: proves the runner environment itself, not the prompt's contents.
// The real assertions on buildSystemPrompt (byte identity against the pre-parameter
// SYSTEM_PROMPT, the one-Techniques-line invariant, the time cap) arrive in Phase 2.
describe("test environment", () => {
  it("resolves a relative service import and renders a prompt", () => {
    const prompt = buildSystemPrompt({ technique: "any", method: "any", time: "any" });

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
    // Guards vitest.config.ts's env.TZ — the boundary tables in Phase 2 are only
    // deterministic if this holds.
    expect(new Date().getTimezoneOffset()).toBe(0);
  });
});
