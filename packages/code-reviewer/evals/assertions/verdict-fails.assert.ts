/**
 * Static assertion: the reviewer must **fail** this fixture.
 *
 * The diff carries three planted defects, one each under
 * `implementation_correctness`, `idiomaticity` and `security_safety`. A model
 * that scores every criterion above `FAILING_SCORE_THRESHOLD` has, whatever else
 * its prose says, waved the change through — and that is the outcome CI would
 * act on. This is the cheapest, most decisive check in the suite: no judge, no
 * tokens, no nondeterminism.
 *
 * The verdict itself is computed once, by the provider, via the package's own
 * `deriveVerdict()`. Recomputing it here would put `FAILING_SCORE_THRESHOLD` in
 * two places and let the eval drift away from the product.
 */
import type { AssertionValueFunctionContext, GradingResult } from "promptfoo";

import { CRITERION_KEYS } from "../../src/index.js";
import { toReviewerOutput } from "../types.js";

export default function verdictFails(output: unknown, _context: AssertionValueFunctionContext): GradingResult {
  const review = toReviewerOutput(output);
  const { passed, failing } = review.verdict;

  if (!passed) {
    return {
      pass: true,
      score: 1,
      reason: `Review failed on ${failing.join(", ")} — as it should on a diff carrying three planted defects.`,
    };
  }

  // Name every score, not just the verdict: when this fires, the question is
  // always "how close was it?", and the answer decides whether the fixture is
  // too subtle or the threshold too low.
  const scores = CRITERION_KEYS.map((key) => `${key}=${review.criteria[key].score}`).join(", ");

  return {
    pass: false,
    score: 0,
    reason: `Review passed a diff with three planted defects. No criterion fell to the failing floor: ${scores}.`,
  };
}
