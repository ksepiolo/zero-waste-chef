import { describe, expect, it } from "vitest";

import {
  CRITERION_KEYS,
  FAILING_SCORE_THRESHOLD,
  criterionScoreSchema,
  deriveVerdict,
  reviewResultSchema,
  type CriterionKey,
  type ReviewCriteria,
} from "./reviews.js";

function criterion(score: number) {
  return {
    score,
    rationale: "Scored against the criterion definition.",
    issues: [
      {
        file: "src/a.ts",
        quote: "+await risky();",
        explanation: "The promise can reject and nothing catches it, crashing the process.",
        suggestion: "Wrap the await in try/catch and surface the error.",
      },
    ],
  };
}

/** Every criterion at `score`, so a test can vary exactly one of them. */
function criteriaAll(score: number): ReviewCriteria {
  return Object.fromEntries(CRITERION_KEYS.map((key) => [key, criterion(score)])) as ReviewCriteria;
}

function result(criteria: ReviewCriteria = criteriaAll(8)) {
  return { summary: "Sound overall, one rough edge.", criteria };
}

describe("criterionScoreSchema", () => {
  it("parses a well-formed criterion", () => {
    expect(criterionScoreSchema.safeParse(criterion(7)).success).toBe(true);
  });

  it("accepts an empty issues array — a clean criterion is a valid answer", () => {
    expect(criterionScoreSchema.safeParse({ ...criterion(10), issues: [] }).success).toBe(true);
  });

  it.each([
    ["below the scale", 0],
    ["above the scale", 11],
    ["fractional", 3.5],
    ["negative", -1],
  ])("rejects a %s score", (_label, score) => {
    expect(criterionScoreSchema.safeParse(criterion(score)).success).toBe(false);
  });

  it.each([1, 10])("accepts the boundary score %i", (score) => {
    expect(criterionScoreSchema.safeParse(criterion(score)).success).toBe(true);
  });

  it("rejects an issue carrying no quote — quotes are the only locator a diff allows", () => {
    const withoutQuote = { ...criterion(5), issues: [{ file: "a.ts", explanation: "x", suggestion: "y" }] };

    expect(criterionScoreSchema.safeParse(withoutQuote).success).toBe(false);
  });
});

describe("reviewResultSchema", () => {
  it("parses a well-formed rubric payload", () => {
    const parsed = reviewResultSchema.safeParse(result());

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.criteria.security_safety.score).toBe(8);
  });

  it("rejects a result missing its summary", () => {
    const { summary: _summary, ...withoutSummary } = result();

    expect(reviewResultSchema.safeParse(withoutSummary).success).toBe(false);
  });

  // The verdict rule reads all six unconditionally, so a partial payload must
  // never reach it. This is the mutant that survived in `tool-loop-agent` F1:
  // swapping the schema for `z.looseObject({})` left every test passing.
  it.each(CRITERION_KEYS)("rejects a payload missing %s", (missing: CriterionKey) => {
    const criteria = criteriaAll(8);
    const { [missing]: _dropped, ...partial } = criteria;

    expect(reviewResultSchema.safeParse({ ...result(), criteria: partial }).success).toBe(false);
  });

  it("rejects a seventh criterion rather than silently stripping it", () => {
    const criteria = { ...criteriaAll(8), architectural_fit: criterion(6) };

    expect(reviewResultSchema.safeParse({ ...result(), criteria }).success).toBe(false);
  });

  it("rejects an out-of-range score nested inside the criteria object", () => {
    const criteria = { ...criteriaAll(8), complexity: criterion(0) };

    expect(reviewResultSchema.safeParse({ ...result(), criteria }).success).toBe(false);
  });

  it("rejects an unrelated top-level key", () => {
    expect(reviewResultSchema.safeParse({ ...result(), findings: [] }).success).toBe(false);
  });
});

describe("deriveVerdict", () => {
  it("passes when every criterion sits above the floor", () => {
    expect(deriveVerdict(criteriaAll(FAILING_SCORE_THRESHOLD + 1))).toStrictEqual({ passed: true, failing: [] });
  });

  it("passes at the boundary — the floor itself is the first failing score", () => {
    expect(deriveVerdict(criteriaAll(10)).passed).toBe(true);
    expect(deriveVerdict(criteriaAll(FAILING_SCORE_THRESHOLD)).passed).toBe(false);
  });

  it.each(CRITERION_KEYS)("fails on %s alone, and names it", (key: CriterionKey) => {
    const criteria = { ...criteriaAll(9), [key]: criterion(FAILING_SCORE_THRESHOLD) };

    expect(deriveVerdict(criteria)).toStrictEqual({ passed: false, failing: [key] });
  });

  it.each(CRITERION_KEYS)("passes when %s sits exactly one above the floor", (key: CriterionKey) => {
    const criteria = { ...criteriaAll(9), [key]: criterion(FAILING_SCORE_THRESHOLD + 1) };

    expect(deriveVerdict(criteria).passed).toBe(true);
  });

  it("does not average — one floor score sinks five perfect ones", () => {
    const criteria = { ...criteriaAll(10), security_safety: criterion(1) };

    expect(deriveVerdict(criteria)).toStrictEqual({ passed: false, failing: ["security_safety"] });
  });

  it("lists every failing criterion in CRITERION_KEYS order", () => {
    const criteria = { ...criteriaAll(9), documentation: criterion(2), complexity: criterion(3) };

    expect(deriveVerdict(criteria).failing).toStrictEqual(["complexity", "documentation"]);
  });

  it("fails with all six listed when nothing clears the floor", () => {
    expect(deriveVerdict(criteriaAll(1)).failing).toStrictEqual([...CRITERION_KEYS]);
  });
});
