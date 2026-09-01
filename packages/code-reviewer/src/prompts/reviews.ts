/**
 * Prompt surface of the reviewer: the system instructions and the user-prompt
 * builder. Kept apart from the service so a prompt variant can be swapped — or
 * A/B'd by an eval — without touching the call site.
 */
import type { ReviewInputFile } from "../schemas/reviews.js";

export const REVIEW_INSTRUCTIONS = [
  "You are a precise, senior code reviewer.",
  "Report only defects you can point at in the code you were given: correctness bugs, unhandled failure modes, security problems, and clear simplifications.",
  "Do not invent findings to fill the list — an empty findings array is the right answer for sound code.",
  "Anchor every finding to a file path and, where possible, a line number from the numbered source you were shown.",
].join(" ");

/**
 * Renders the files as 1-indexed, tab-separated numbered source under a
 * `--- path ---` heading per file, optionally prefixed with review context.
 */
export function buildReviewPrompt(files: ReviewInputFile[], context?: string): string {
  const sections = files.map((file) => {
    const numbered = file.content
      .split("\n")
      .map((line, index) => `${index + 1}\t${line}`)
      .join("\n");

    return `--- ${file.path} ---\n${numbered}`;
  });

  return [
    context ? `Context for this review:\n${context}\n` : "",
    "Review the following files. Line numbers are prefixed and are not part of the source.",
    "",
    sections.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");
}
