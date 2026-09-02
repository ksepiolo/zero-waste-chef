/**
 * The model-output contract: six criteria, each scored 1–10 over a pull
 * request's diff, plus the pure rule that collapses those scores into the
 * pass/fail verdict CI hangs its labels on.
 *
 * Every `.describe()` here is prompt surface — under `Output.object` the model
 * reads them as field-level instructions, not as documentation.
 */
import { z } from "zod";

/**
 * The six criteria, in the order they are scored and rendered.
 *
 * Definitions and their 1-and-10 anchors live in `REVIEW_INSTRUCTIONS`
 * (`../prompts/reviews.ts`), sourced from
 * `context/changes/ci-cd-code-review/requirements.md`.
 */
export const CRITERION_KEYS = [
  "implementation_correctness",
  "idiomaticity",
  "complexity",
  "test_risk_coverage",
  "documentation",
  "security_safety",
] as const;

export const criterionKeySchema = z.enum(CRITERION_KEYS);
export type CriterionKey = z.infer<typeof criterionKeySchema>;

/**
 * One concrete problem behind a score.
 *
 * There is deliberately no `line` field: a unified diff carries no reliable
 * line numbering (the diff's own `@@` markers and any renumbering of the diff
 * text contradict each other), and a confidently wrong line number is worse
 * than none. `quote` is the locator instead.
 */
export const criterionIssueSchema = z.object({
  file: z.string().describe("Path of the file this issue is in, exactly as it appears in the diff."),
  quote: z
    .string()
    .describe(
      "A short verbatim excerpt from the diff — at most two lines — so a reader can find the spot. A locator, not the whole hunk.",
    ),
  explanation: z.string().describe("Why it is a problem, with the concrete failure it causes."),
  suggestion: z.string().describe("The smallest change that fixes it."),
});
export type CriterionIssue = z.infer<typeof criterionIssueSchema>;

export const criterionScoreSchema = z.object({
  score: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("1 is the worst outcome for this criterion, 10 the best. Use the whole scale."),
  rationale: z.string().describe("One or two sentences justifying this score against this criterion's definition."),
  issues: z
    .array(criterionIssueSchema)
    .describe("Concrete problems behind the score. Empty when nothing is wrong — do not invent issues to fill it."),
});
export type CriterionScore = z.infer<typeof criterionScoreSchema>;

/**
 * Keyed by criterion name rather than an array: the object shape makes "all six
 * present" a schema guarantee. An array would let the model return four and
 * still validate, and {@link deriveVerdict} depends on all six existing.
 * `strictObject` closes the other end — a seventh criterion is a contract
 * violation, not something to silently strip.
 */
export const reviewCriteriaSchema = z.strictObject({
  implementation_correctness: criterionScoreSchema.describe(
    "Does the code actually do what it claims, handling edge cases and error paths without introducing regressions?",
  ),
  idiomaticity: criterionScoreSchema.describe(
    "Does the code follow the language, framework, and project conventions a fluent reader would expect?",
  ),
  complexity: criterionScoreSchema.describe(
    "Is the solution as simple as the problem allows, without needless abstraction or convolution?",
  ),
  test_risk_coverage: criterionScoreSchema.describe(
    "Are the meaningful behaviors and risky paths exercised by tests proportional to their risk?",
  ),
  documentation: criterionScoreSchema.describe(
    "Are non-obvious decisions, public surfaces, and tricky code explained where a reader would need it?",
  ),
  security_safety: criterionScoreSchema.describe(
    "Does the change avoid introducing vulnerabilities, leaking secrets, or unsafe handling of untrusted input?",
  ),
});
export type ReviewCriteria = z.infer<typeof reviewCriteriaSchema>;

export const reviewResultSchema = z.strictObject({
  summary: z.string().describe("Two or three sentences on the overall state of the change."),
  criteria: reviewCriteriaSchema.describe("All six criteria, each scored with a rationale."),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

/** The pull request handed to the reviewer, consumed as inert data. */
export interface ReviewInputDiff {
  title: string;
  /** `null` when the pull request has no body — distinct from an empty string. */
  description: string | null;
  /** Unified diff, unmodified. */
  diff: string;
}

/**
 * A criterion scoring at or below this fails the review.
 *
 * A starting value, tuned against real pull requests (see the plan's Phase 4).
 * It is a single named constant precisely so tuning it is a one-line change
 * that its truth-table test moves with.
 */
export const FAILING_SCORE_THRESHOLD = 4;

export interface Verdict {
  passed: boolean;
  /** Which criteria fell to or below the floor — what makes a comment explain why. */
  failing: CriterionKey[];
}

/**
 * Collapses the six scores into the boolean the CI labels hang on.
 *
 * A per-criterion floor, not an average: averaging lets a 1 on
 * `security_safety` hide behind five 9s.
 */
export function deriveVerdict(criteria: ReviewCriteria): Verdict {
  const failing = CRITERION_KEYS.filter((key) => criteria[key].score <= FAILING_SCORE_THRESHOLD);

  return { passed: failing.length === 0, failing };
}
