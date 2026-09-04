/**
 * Static assertion: every issue's `quote` really occurs in the diff.
 *
 * `quote` is the reviewer's only locator — the schema deliberately has no `line`
 * field, because a unified diff carries no reliable line numbering. That makes a
 * hallucinated quote the worst failure the reviewer can have short of not
 * answering: the finding cannot be checked, cannot be found, and reads exactly
 * like a real one.
 *
 * Matching is whitespace-normalised, not exact. Models reflow indentation and
 * routinely drop (or keep) the leading `+`/`-` column when quoting a diff, so an
 * exact-substring check would report formatting as hallucination. Both variants
 * are tried: markers stripped from every line, and markers left in place. A
 * quote counts as anchored if either lands.
 *
 * The score is the *fraction* anchored rather than a boolean, so one stray quote
 * in an otherwise well-located review shows up in the grid without flunking the
 * cell — see {@link ANCHORED_FRACTION_FLOOR}.
 */
import type { AssertionValueFunctionContext, GradingResult } from "promptfoo";

import { CRITERION_KEYS } from "../../src/index.js";
import { requireVar, toReviewerOutput } from "../types.js";

/**
 * Below this share of anchored quotes the review's locators stop being usable.
 *
 * A single unanchored quote among five is a model paraphrasing under pressure;
 * a third of them unanchored means it is inventing evidence. The floor is a
 * judgement call, stated once here rather than buried in a comparison.
 */
export const ANCHORED_FRACTION_FLOOR = 0.8;

/** How many characters of an unanchored quote to echo back in the reason. */
const QUOTE_EXCERPT_LIMIT = 120;

export default function quotesAnchored(output: unknown, context: AssertionValueFunctionContext): GradingResult {
  const review = toReviewerOutput(output);
  const diff = requireVar(context.vars, "diff");

  // Normalised once, not once per quote: the fixture diff is ~10 KB.
  const haystacks: Haystacks = { stripped: normalize(diff, true), kept: normalize(diff, false) };

  const quotes = CRITERION_KEYS.flatMap((key) =>
    review.criteria[key].issues.map((issue) => ({ criterion: key, file: issue.file, quote: issue.quote })),
  );

  if (quotes.length === 0) {
    // Vacuously anchored. Whether a review with no issues at all is acceptable
    // is `verdict-fails.assert.ts`'s question, not this one's.
    return { pass: true, score: 1, reason: "The review reported no issues, so there are no quotes to anchor." };
  }

  const unanchored = quotes.filter(({ quote }) => !isAnchored(quote, haystacks));
  const score = (quotes.length - unanchored.length) / quotes.length;

  if (unanchored.length === 0) {
    return { pass: true, score: 1, reason: `All ${quotes.length} issue quotes occur in the diff.` };
  }

  const listed = unanchored
    .map(({ criterion, file, quote }) => `  - ${criterion} (${file}): ${excerpt(quote)}`)
    .join("\n");

  return {
    pass: score >= ANCHORED_FRACTION_FLOOR,
    score,
    reason: `${unanchored.length} of ${quotes.length} issue quotes are not in the diff:\n${listed}`,
  };
}

/** The diff normalised both ways, so each quote can be tried against either. */
interface Haystacks {
  /** Every line's leading `+`/`-` removed. */
  stripped: string;
  /** Markers left in place, for a quote that kept them. */
  kept: string;
}

function isAnchored(quote: string, haystacks: Haystacks): boolean {
  const stripped = normalize(quote, true);
  const kept = normalize(quote, false);

  // An empty quote is not "found everywhere" — it is a missing locator.
  if (stripped === "" && kept === "") {
    return false;
  }

  return haystacks.stripped.includes(stripped) || haystacks.kept.includes(kept);
}

/**
 * Collapses text to a single whitespace-normalised line.
 *
 * `stripMarkers` drops the leading `+`/`-` of each line. It is applied to the
 * diff and the quote together, so the two agree; the cost is that a code line
 * genuinely beginning with `-` or `+` is normalised differently on each side,
 * which is why the un-stripped variant is also tried.
 */
function normalize(text: string, stripMarkers: boolean): string {
  return text
    .split("\n")
    .map((line) => (stripMarkers ? line.replace(/^[+-]/, "") : line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(quote: string): string {
  const collapsed = quote.replace(/\s+/g, " ").trim();

  return collapsed.length > QUOTE_EXCERPT_LIMIT ? `${collapsed.slice(0, QUOTE_EXCERPT_LIMIT)}…` : collapsed;
}
