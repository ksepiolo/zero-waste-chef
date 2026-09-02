/**
 * Command-line entry point for the code reviewer.
 *
 *   npm start -- --title "Add rate limiting" --diff pr.diff --body pr-body.md
 *   gh pr diff 42 > /tmp/d && npm start -- --title "$T" --diff /tmp/d --json
 *
 * The diff and body are read from files (or stdin), never from argv: a real
 * pull-request diff runs to tens of kilobytes, which would hit `E2BIG`, and
 * argv is world-readable in the process table.
 *
 * Kept apart from `index.ts` so importing the library pulls in no `node:*`
 * modules, reads no environment, and writes nothing to stdout.
 */
import { readFile } from "node:fs/promises";
import { argv, env, exit, stderr, stdin, stdout } from "node:process";
import { text } from "node:stream/consumers";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { reviewCode } from "./agents/reviews.js";
import {
  CRITERION_KEYS,
  deriveVerdict,
  type CriterionKey,
  type ReviewInputDiff,
  type ReviewResult,
  type Verdict,
} from "./schemas/reviews.js";

/** Exit codes. CI branches on these, so they are contract, not convenience. */
const EXIT_PASS = 0;
const EXIT_FAILED_VERDICT = 1;
const EXIT_USAGE = 2;
const EXIT_REVIEWER_ERROR = 3;

const USAGE = [
  "usage: npm start -- --title <string> --diff <path|-> [--body <path|->] [--json]",
  "",
  "  --title  Pull request title (required).",
  "  --diff   Unified diff to review; `-` reads stdin (required).",
  "  --body   Pull request description; `-` reads stdin. Omit when there is none.",
  "  --json   Emit the review plus the derived verdict as JSON on stdout, nothing else.",
].join("\n");

/** Human-readable criterion names. The wire format keeps the snake_case keys. */
const CRITERION_LABEL: Record<CriterionKey, string> = {
  implementation_correctness: "implementation correctness",
  idiomaticity: "idiomaticity",
  complexity: "complexity",
  test_risk_coverage: "test / risk coverage",
  documentation: "documentation",
  security_safety: "security and safety",
};

interface CliOptions {
  title: string;
  diff: string;
  body: string | undefined;
  json: boolean;
}

/**
 * Reviews a pull request diff and prints the six criterion scores.
 *
 * @param args CLI arguments without the node/script prefix.
 * @returns The process exit code, which CI branches on:
 *
 *   - `0` — every criterion is above the failing floor.
 *   - `1` — the review ran and returned a failing verdict.
 *   - `2` — usage error: bad or missing arguments, an unreadable input file, or
 *     an empty diff. Nothing was sent to the model.
 *   - `3` — the reviewer itself failed (bad API key, unreachable provider,
 *     unparseable model output). Distinct from `1` so a broken reviewer cannot
 *     masquerade as a failed review.
 */
export async function runCli(args: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(args);
  } catch (error) {
    stderr.write(`${describeError(error)}\n\n${USAGE}\n`);
    return EXIT_USAGE;
  }

  let input: ReviewInputDiff;
  try {
    input = await readInput(options);
  } catch (error) {
    stderr.write(`${describeError(error)}\n`);
    return EXIT_USAGE;
  }

  if (input.diff.trim() === "") {
    stderr.write("the diff is empty — nothing to review\n");
    return EXIT_USAGE;
  }

  let review;
  let usage;
  let modelId;
  try {
    ({ review, usage, modelId } = await reviewCode({ input }));
  } catch (error) {
    stderr.write(`the reviewer failed to run: ${describeError(error)}\n`);
    writeDiagnostics(error);
    return EXIT_REVIEWER_ERROR;
  }

  const verdict = deriveVerdict(review.criteria);

  if (options.json) {
    stdout.write(`${JSON.stringify({ summary: review.summary, criteria: review.criteria, verdict }, null, 2)}\n`);
  } else {
    writeHumanReport(review, verdict);
  }

  stderr.write(`\n${modelId} · ${usage.inputTokens ?? "?"} in / ${usage.outputTokens ?? "?"} out\n`);

  return verdict.passed ? EXIT_PASS : EXIT_FAILED_VERDICT;
}

/** @throws {Error} on an unknown flag, a missing required flag, or two `-` inputs. */
function parseCliArgs(args: string[]): CliOptions {
  const { values } = parseArgs({
    args,
    options: {
      title: { type: "string" },
      diff: { type: "string" },
      body: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.title === undefined || values.title === "") {
    throw new Error("--title is required");
  }
  if (values.diff === undefined || values.diff === "") {
    throw new Error("--diff is required");
  }
  // Both would drain the same stream; the second read would silently see "".
  if (values.diff === "-" && values.body === "-") {
    throw new Error("only one of --diff and --body can read stdin");
  }

  return { title: values.title, diff: values.diff, body: values.body, json: values.json };
}

async function readInput(options: CliOptions): Promise<ReviewInputDiff> {
  const diff = await readSource(options.diff);
  // Absent `--body` is `null`, not `""`: the prompt says so explicitly rather
  // than letting the model infer intent from the diff alone.
  const description = options.body === undefined ? null : await readSource(options.body);

  return { title: options.title, description, diff };
}

function readSource(source: string): Promise<string> {
  return source === "-" ? text(stdin) : readFile(source, "utf8");
}

/** Aligns continuation text under the `NN/10  ` score column. */
const INDENT = "       ";
const ISSUE_INDENT = `${INDENT}  `;

/** A quote is a locator, not the hunk. Longer blocks are elided rather than dumped. */
const QUOTE_MAX_LINES = 3;

function writeHumanReport(review: ReviewResult, verdict: Verdict): void {
  stdout.write(`${review.summary}\n\n`);

  const headline = verdict.passed
    ? "PASS"
    : `FAIL — ${verdict.failing.map((key) => CRITERION_LABEL[key]).join(", ")}`;
  stdout.write(`${headline}\n\n`);

  for (const key of CRITERION_KEYS) {
    const criterion = review.criteria[key];
    stdout.write(`${String(criterion.score).padStart(2)}/10  ${CRITERION_LABEL[key]}\n`);
    stdout.write(`${INDENT}${criterion.rationale}\n`);

    for (const issue of criterion.issues) {
      stdout.write(`${INDENT}• ${issue.file} — ${issue.explanation}\n`);
      stdout.write(`${quoteBlock(issue.quote)}\n`);
      stdout.write(`${ISSUE_INDENT}→ ${issue.suggestion}\n`);
    }

    stdout.write("\n");
  }
}

/**
 * Renders a quote as an indented block.
 *
 * Models return multi-line quotes often enough that prefixing only the first
 * line leaves every continuation flush-left, which destroys the report's
 * structure — observed against a live model on a real diff.
 */
function quoteBlock(quote: string): string {
  const lines = quote.split("\n");
  const shown = lines.slice(0, QUOTE_MAX_LINES);
  const rendered = shown.map((line, index) => `${ISSUE_INDENT}${index === 0 ? "> " : "  "}${line}`);

  if (lines.length > shown.length) {
    rendered.push(`${ISSUE_INDENT}  … ${String(lines.length - shown.length)} more line(s)`);
  }

  return rendered.join("\n");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The likeliest real failure is a model that cannot honour structured output,
 * which surfaces as `AI_NoObjectGeneratedError`. That error hangs the model's
 * raw text off itself; the stack does not contain it, so print both.
 */
function writeDiagnostics(error: unknown): void {
  if (!env.DEBUG) {
    return;
  }
  if (error instanceof Error && error.stack !== undefined) {
    stderr.write(`${error.stack}\n`);
  }
  if (typeof error === "object" && error !== null && "text" in error && typeof error.text === "string") {
    stderr.write(`model output was:\n${error.text}\n`);
  }
}

const entryPoint = argv[1];
const isDirectRun = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (isDirectRun) {
  try {
    exit(await runCli(argv.slice(2)));
  } catch (error) {
    stderr.write(`${describeError(error)}\n`);
    exit(EXIT_REVIEWER_ERROR);
  }
}
