/**
 * Shared shapes for the promptfoo eval harness.
 *
 * promptfoo types `context.vars` as `Record<string, string | object>`, so every
 * consumer would otherwise re-narrow the same three fields by hand. The provider
 * (`reviewer.provider.ts`) reads all three to build the prompt; the assertions
 * read `diff` to anchor quotes against. One declaration keeps them agreeing.
 *
 * Nothing here is exported from the package — `evals/` is typechecked by
 * `tsconfig.evals.json` (`noEmit`) and never reaches `dist/`.
 */
import type { ReviewInputDiff } from "../src/index.js";

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
 * Narrows promptfoo's untyped `vars` bag to {@link ReviewVars}.
 *
 * Throws rather than defaulting: a missing var means the config is wrong, and a
 * silent empty-string fallback would review an empty diff and score it, which
 * looks like a model failure rather than a configuration one.
 */
export function toReviewVars(vars: Record<string, unknown> | undefined): ReviewVars {
  const title = requireString(vars, "title");
  const description = requireString(vars, "description");
  const diff = requireString(vars, "diff");

  return { title, description, diff };
}

/** Converts {@link ReviewVars} to the package's own input type. */
export function toReviewInput(vars: ReviewVars): ReviewInputDiff {
  return { title: vars.title, description: vars.description, diff: vars.diff };
}

function requireString(vars: Record<string, unknown> | undefined, key: keyof ReviewVars): string {
  const value = vars?.[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Eval config error: test var "${key}" is missing or not a non-empty string.`);
  }

  return value;
}
