/**
 * Shared shapes for the promptfoo eval harness.
 *
 * promptfoo types `context.vars` as `Record<string, string | object>` and hands
 * an assertion its `output` untyped, so every consumer would otherwise re-narrow
 * the same values by hand. The provider (`reviewer.provider.ts`) reads all three
 * vars to build the prompt; the assertions read `diff` to anchor quotes against
 * and the review itself to grade. One declaration keeps them agreeing.
 *
 * Nothing here is exported from the package — `evals/` is typechecked by
 * `evals/tsconfig.json` (`noEmit`) and never reaches `dist/`.
 */
import type { ReviewInputDiff, ReviewResult, Verdict } from "../src/index.js";

/**
 * The `vars` block of a test case in `promptfooconfig.yaml`.
 *
 * Deliberately assignable to {@link ReviewInputDiff} minus its `null`
 * description: YAML has no way to express "absent" that survives promptfoo's
 * var substitution, so a test case always supplies a description string. The
 * eval therefore always exercises the reviewer's primary scoring path rather
 * than its no-description fallback.
 */
export interface ReviewVars {
  /** The pull request title, as the author wrote it. */
  title: string;
  /** The pull request body. See the note above on why this is never `null`. */
  description: string;
  /** Unified diff, loaded by promptfoo from `file://fixtures/*.diff`. */
  diff: string;
}

/**
 * What an assertion receives as `output`: the review plus its derived verdict.
 *
 * It lives here rather than beside the provider because both ends need it and a
 * type in the middle keeps the assertions from importing the provider — they run
 * in a separate promptfoo module load and have no business constructing one.
 */
export type ReviewerProviderOutput = ReviewResult & { verdict: Verdict };

/**
 * Narrows promptfoo's untyped `vars` bag to {@link ReviewVars}.
 *
 * Throws rather than defaulting: a missing var means the config is wrong, and a
 * silent empty-string fallback would review an empty diff and score it, which
 * looks like a model failure rather than a configuration one.
 */
export function toReviewVars(vars: Record<string, unknown> | undefined): ReviewVars {
  const title = requireVar(vars, "title");
  const description = requireVar(vars, "description");
  const diff = requireVar(vars, "diff");

  return { title, description, diff };
}

/** Converts {@link ReviewVars} to the package's own input type. */
export function toReviewInput(vars: ReviewVars): ReviewInputDiff {
  return { title: vars.title, description: vars.description, diff: vars.diff };
}

/**
 * Reads one var, or throws. Exported because an assertion needs `diff` alone —
 * demanding the whole {@link ReviewVars} there would report a missing `title` as
 * the reason a quote-anchoring check failed.
 */
export function requireVar(vars: Record<string, unknown> | undefined, key: keyof ReviewVars): string {
  const value = vars?.[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Eval config error: test var "${key}" is missing or not a non-empty string.`);
  }

  return value;
}

/**
 * Narrows an assertion's `output` argument to {@link ReviewerProviderOutput}.
 *
 * promptfoo passes structured provider output to assertions untouched, so this
 * only ever fails if `reviewer.provider.ts` itself is broken — a case its own
 * unit test covers. Throwing is therefore the right shape: promptfoo turns a
 * thrown assertion into one failed cell carrying the message, and a review that
 * genuinely did not parse never gets this far (the provider returns `{ error }`
 * instead, and promptfoo records the row as an error rather than a failure).
 */
export function toReviewerOutput(output: unknown): ReviewerProviderOutput {
  if (typeof output !== "object" || output === null) {
    throw new Error(`Eval harness error: expected the provider's review object, got ${typeof output}.`);
  }

  const candidate = output as Partial<ReviewerProviderOutput>;

  if (candidate.criteria === undefined || candidate.verdict === undefined) {
    throw new Error(
      "Eval harness error: provider output is missing `criteria` or `verdict`. " +
        "reviewer.provider.ts must return the review with its derived verdict attached.",
    );
  }

  return candidate as ReviewerProviderOutput;
}
