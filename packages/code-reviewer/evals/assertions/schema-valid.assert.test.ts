/**
 * Pins the one thing that is easy to get wrong here: `reviewResultSchema` is a
 * `strictObject`, and the adapter adds a `verdict` key the model never produced.
 * Forgetting to strip it would fail every model on every run for a reason that
 * has nothing to do with the models.
 */
import { describe, expect, it } from "vitest";

import schemaValid from "./schema-valid.assert.js";
import { assertionContext, criteria, reviewOutput } from "./reviews.test-helper.js";

const CONTEXT = assertionContext({ diff: "irrelevant to this assertion" });

describe("schema-valid", () => {
  it("passes on the provider's output, verdict and all", () => {
    const result = schemaValid(reviewOutput(criteria(7)), CONTEXT);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails with the zod issues when a criterion is missing", () => {
    const { security_safety: _dropped, ...five } = criteria(7);

    const result = schemaValid({ summary: "…", criteria: five, verdict: { passed: true, failing: [] } }, CONTEXT);

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("security_safety");
  });

  it("fails on a key the schema does not allow, since strictObject is the contract", () => {
    const result = schemaValid({ ...reviewOutput(criteria(7)), confidence: 0.9 }, CONTEXT);

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("confidence");
  });

  it("fails rather than throwing when the output is not an object at all", () => {
    const result = schemaValid("Looks good to me.", CONTEXT);

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("string");
  });
});
