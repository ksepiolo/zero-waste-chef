/**
 * Static assertion: the output still satisfies the package's own contract.
 *
 * This is the "could the model produce the contract at all?" check, kept
 * separate from "did the model review well?" — the same distinction the CLI
 * draws between exit code `1` (a failing review) and `3` (a broken reviewer).
 * Research flags malformed structured output as the likeliest failure mode for
 * the weaker challengers, and a review that does not parse is not a worse
 * review; it is no review.
 *
 * It is deliberately defence in depth. `createReviewAgent()` already validates
 * through `Output.object({ schema: reviewResultSchema })`, so in the normal path
 * a malformed response never reaches an assertion — the provider catches it and
 * returns `{ error }`. What this pins is that the object promptfoo hands the
 * assertions is still *exactly* the shipped schema: `reviewResultSchema` is a
 * `strictObject`, so an extra key the adapter started smuggling through would
 * fail here rather than quietly become part of the eval's contract.
 */
import type { AssertionValueFunctionContext, GradingResult } from "promptfoo";
import { z } from "zod";

import { reviewResultSchema } from "../../src/index.js";

export default function schemaValid(output: unknown, _context: AssertionValueFunctionContext): GradingResult {
  if (typeof output !== "object" || output === null) {
    return { pass: false, score: 0, reason: `Expected an object from the provider, got ${typeof output}.` };
  }

  // `verdict` is the adapter's own addition, not part of the model's response.
  // Strip it before parsing, or `strictObject` correctly rejects it.
  const { verdict: _verdict, ...review } = output as Record<string, unknown>;

  const parsed = reviewResultSchema.safeParse(review);

  if (parsed.success) {
    return { pass: true, score: 1, reason: "Output parses as reviewResultSchema." };
  }

  return {
    pass: false,
    score: 0,
    reason: `Output does not parse as reviewResultSchema: ${z.prettifyError(parsed.error)}`,
  };
}
