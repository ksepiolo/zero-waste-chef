/**
 * Renders the reviewer's `--json` output into the markdown body of the pull
 * request comment.
 *
 * Kept as a standalone script rather than inline `bash`+`jq` inside
 * `action.yml` for two reasons: markdown assembly with quoting, fence escaping
 * and a length budget is unreadable as a shell one-liner, and a file can be run
 * against a recorded fixture:
 *
 *   node .github/actions/ai-code-review/render-comment.mjs \
 *     --review .github/actions/ai-code-review/fixtures/review.sample.json
 *
 * Dependency-free on purpose. The runner has Node but the action's checkout is
 * the base branch; nothing here may assume `packages/code-reviewer/node_modules`
 * exists, because the renderer also runs on the path where the reviewer failed.
 */
import { readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { parseArgs } from "node:util";

/**
 * First line of every body we post. The upsert step finds our previous comment
 * by this string, so it is contract — changing it orphans every existing
 * comment. Namespaced `ai-cr:` so it cannot collide with the
 * `<!-- impl-review-ci:marker -->` used by the implementation-review workflow.
 */
const MARKER = "<!-- ai-cr:marker -->";

/**
 * The six criteria in render order, with their human labels.
 *
 * Source of truth is `CRITERION_KEYS` and `CRITERION_LABEL` in
 * `packages/code-reviewer/src/{schemas,cli}`; duplicated here rather than
 * imported to keep this script free of the package's TypeScript toolchain.
 * The schema guarantees all six keys are present, so a missing one is a
 * malformed payload, not an optional field.
 */
const CRITERIA = [
  ["implementation_correctness", "implementation correctness"],
  ["idiomaticity", "idiomaticity"],
  ["complexity", "complexity"],
  ["test_risk_coverage", "test / risk coverage"],
  ["documentation", "documentation"],
  ["security_safety", "security and safety"],
];

/**
 * GitHub rejects an issue comment body over 65536 characters with a 422. A
 * review of a large diff can carry dozens of issues, so the body is assembled
 * under a budget and the tail is dropped rather than the request failing.
 */
const MAX_BODY_LENGTH = 65000;

/** Kept short: a locator, not the hunk. Matches the CLI's human report. */
const QUOTE_MAX_LINES = 3;

function main(args) {
  const { values } = parseArgs({
    args,
    options: {
      review: { type: "string" },
      error: { type: "boolean", default: false },
      reason: { type: "string" },
      "run-url": { type: "string" },
    },
    allowPositionals: false,
  });

  if (values.error) {
    stdout.write(renderError(values.reason ?? "no reason given", values["run-url"]));
    return 0;
  }

  if (values.review === undefined || values.review === "") {
    stderr.write("usage: render-comment.mjs --review <path> [--run-url <url>]\n");
    stderr.write("       render-comment.mjs --error --reason <text> [--run-url <url>]\n");
    return 2;
  }

  let review;
  try {
    review = parseReview(readFileSync(values.review, "utf8"));
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  stdout.write(renderReview(review, values["run-url"]));
  return 0;
}

/**
 * Validates just enough of the payload that a malformed one fails loudly here
 * instead of rendering a comment full of `undefined`. The reviewer already
 * validates against the full zod schema; this is the seam between two
 * processes, so it re-checks the shape it actually indexes into.
 *
 * @throws {Error} when the payload is not the reviewer's `--json` output.
 */
function parseReview(source) {
  const payload = JSON.parse(source);

  if (typeof payload !== "object" || payload === null) {
    throw new Error("review payload is not an object");
  }
  if (typeof payload.summary !== "string" || typeof payload.criteria !== "object" || payload.criteria === null) {
    throw new Error("review payload is missing `summary` or `criteria`");
  }
  if (typeof payload.verdict !== "object" || payload.verdict === null || typeof payload.verdict.passed !== "boolean") {
    throw new Error("review payload is missing `verdict.passed`");
  }

  for (const [key] of CRITERIA) {
    const criterion = payload.criteria[key];
    if (typeof criterion !== "object" || criterion === null || typeof criterion.score !== "number") {
      throw new Error(`review payload is missing a score for \`${key}\``);
    }
  }

  return payload;
}

function renderReview(review, runUrl) {
  const failing = Array.isArray(review.verdict.failing) ? review.verdict.failing : [];
  const failingSet = new Set(failing);
  const labelFor = new Map(CRITERIA);

  const head = [
    MARKER,
    "",
    `## ${review.verdict.passed ? "✅" : "❌"} AI code review — ${review.verdict.passed ? "PASS" : "FAIL"}`,
    "",
    review.summary,
    "",
  ];

  if (!review.verdict.passed) {
    head.push(`**Below the floor:** ${failing.map((key) => labelFor.get(key) ?? key).join(", ")}`, "");
  }

  head.push("| Criterion | Score |", "| :-- | --: |");
  for (const [key, label] of CRITERIA) {
    const mark = failingSet.has(key) ? " ⚠️" : "";
    head.push(`| ${label}${mark} | ${String(review.criteria[key].score)} / 10 |`);
  }
  // Two blanks: a table that runs straight into the next heading is not
  // reliably terminated by GitHub's markdown renderer.
  head.push("", "");

  // Issues are appended one criterion at a time so the budget can cut at a
  // section boundary rather than mid-sentence.
  const sections = [];
  for (const [key, label] of CRITERIA) {
    const criterion = review.criteria[key];
    const issues = Array.isArray(criterion.issues) ? criterion.issues : [];
    if (issues.length === 0) {
      continue;
    }
    sections.push(renderCriterion(label, criterion, issues));
  }

  const footer = renderFooter(runUrl);
  const body = head.join("\n");
  const budget = MAX_BODY_LENGTH - body.length - footer.length;

  return body + fitSections(sections, budget) + footer;
}

function renderCriterion(label, criterion, issues) {
  const lines = [`### ${label} — ${String(criterion.score)} / 10`, "", criterion.rationale, ""];

  for (const issue of issues) {
    lines.push(`**\`${String(issue.file)}\`**`, "", fence(String(issue.quote)), "", String(issue.explanation), "");
    if (typeof issue.suggestion === "string" && issue.suggestion !== "") {
      lines.push(`→ ${issue.suggestion}`, "");
    }
  }

  return lines.join("\n");
}

/**
 * Wraps a quote in a code fence long enough to survive backticks inside it — a
 * diff excerpt of markdown or of this very file would otherwise close the fence
 * early and spill the rest of the comment into the page as raw markup.
 */
function fence(quote) {
  const lines = quote.split("\n");
  const shown = lines.slice(0, QUOTE_MAX_LINES);
  if (lines.length > shown.length) {
    shown.push(`… ${String(lines.length - shown.length)} more line(s)`);
  }

  const longestRun = Math.max(0, ...[...quote.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = "`".repeat(Math.max(3, longestRun + 1));

  return [delimiter, ...shown, delimiter].join("\n");
}

/** Drops whole criterion sections off the tail once the budget is spent. */
function fitSections(sections, budget) {
  const kept = [];
  let used = 0;
  let dropped = 0;

  for (const section of sections) {
    if (used + section.length <= budget) {
      kept.push(section);
      used += section.length;
    } else {
      dropped += 1;
    }
  }

  if (dropped > 0) {
    kept.push(`_${String(dropped)} further criterion section(s) omitted to stay under GitHub's comment size limit._\n`);
  }

  return kept.join("\n");
}

/**
 * The reviewer itself failed — bad key, unreachable provider, unparseable model
 * output. Says so plainly instead of leaving a stale verdict standing, and the
 * caller applies no verdict label on this path.
 */
function renderError(reason, runUrl) {
  return (
    [
      MARKER,
      "",
      "## ⚠️ AI code review — could not run",
      "",
      "The reviewer failed before it produced a verdict, so no `ai-cr:` verdict label was applied.",
      "",
      `> ${reason.split("\n").join("\n> ")}`,
      "",
    ].join("\n") + renderFooter(runUrl)
  );
}

function renderFooter(runUrl) {
  const link = runUrl === undefined || runUrl === "" ? "" : ` · [run log](${runUrl})`;
  return `\n<sub>This review does not block a merge \u2014 the branch has no protection rule.${link}</sub>\n`;
}

exit(main(argv.slice(2)));
