/**
 * Review and context builders shared by the assertion tests.
 *
 * Not a `.test.ts` file on purpose — vitest's `include` would pick it up and
 * report a suite with no tests. It still sits under `evals/`, so it is linted
 * and typechecked like everything else here, and it never ships: `evals/` is
 * `noEmit` and outside `tsconfig.build.json`.
 */
import type { AssertionValueFunctionContext } from "promptfoo";

import { CRITERION_KEYS, type CriterionIssue, type CriterionKey, type ReviewCriteria } from "../../src/index.js";
import type { ReviewerProviderOutput } from "../types.js";

/** One criterion's score, with no issues unless some are given. */
export function criterion(score: number, issues: CriterionIssue[] = []) {
  return { score, rationale: "Scored against the criterion definition.", issues };
}

/** All six criteria at `score`, before any per-criterion override. */
export function criteria(score: number, overrides: Partial<ReviewCriteria> = {}): ReviewCriteria {
  const base = Object.fromEntries(CRITERION_KEYS.map((key) => [key, criterion(score)])) as ReviewCriteria;

  return { ...base, ...overrides };
}

/**
 * The provider's output shape, with the verdict passed in rather than derived —
 * the assertions read `verdict`, they never recompute it, and a test that
 * recomputed it here would stop catching a provider that forgot to attach one.
 */
export function reviewOutput(scored: ReviewCriteria, failing: CriterionKey[] = []): ReviewerProviderOutput {
  return {
    summary: "A migration with defects worth blocking on.",
    criteria: scored,
    verdict: { passed: failing.length === 0, failing },
  };
}

/** One issue quoting `quote` out of the fixture's component. */
export function issue(quote: string): CriterionIssue {
  return {
    file: "src/components/item-list.tsx",
    quote,
    explanation: "The effect never re-runs, so the list shows the wrong category.",
    suggestion: "Add categoryId to the dependency array.",
  };
}

/** The second argument promptfoo passes an assertion. Only `vars` is read here. */
export function assertionContext(vars: Record<string, string>): AssertionValueFunctionContext {
  return {
    prompt: "{{diff}}",
    vars,
    test: { vars },
    logProbs: undefined,
    provider: undefined,
    providerResponse: undefined,
  };
}
