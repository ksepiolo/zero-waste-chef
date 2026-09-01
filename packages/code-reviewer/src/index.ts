/**
 * @zero-waste-chef/code-reviewer
 *
 * Entry point for the AI code reviewer. Import the pieces below to build on
 * top of it, or run this file directly for a one-shot review:
 *
 *   npm start -- src/foo.ts src/bar.ts
 */
export { loadEnv, type Env } from "./env.config.js";
export { createProviderContext, type ProviderContext } from "./openrouter.provider.js";
export {
  reviewFindingSchema,
  reviewResultSchema,
  severitySchema,
  type ReviewFinding,
  type ReviewInputFile,
  type ReviewResult,
  type Severity,
} from "./review.schema.js";
export { reviewCode, type ReviewCodeOptions, type ReviewCodeResponse } from "./review.service.js";

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

import { reviewCode } from "./review.service.js";
import type { ReviewFinding, ReviewInputFile } from "./review.schema.js";

const SEVERITY_LABEL: Record<ReviewFinding["severity"], string> = {
  critical: "CRITICAL",
  major: "MAJOR",
  minor: "MINOR",
  nit: "NIT",
};

async function main(paths: string[]): Promise<number> {
  if (paths.length === 0) {
    stderr.write("usage: npm start -- <file> [file...]\n");
    return 2;
  }

  const files: ReviewInputFile[] = await Promise.all(
    paths.map(async (path) => ({
      path: relative(cwd(), resolve(path)) || path,
      content: await readFile(resolve(path), "utf8"),
    })),
  );

  const { review, usage, modelId } = await reviewCode({ files });

  stdout.write(`${review.summary}\n\n`);

  if (review.findings.length === 0) {
    stdout.write("No findings.\n");
  } else {
    for (const finding of review.findings) {
      const location = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
      stdout.write(`[${SEVERITY_LABEL[finding.severity]}] ${location} — ${finding.title}\n`);
      stdout.write(`  ${finding.explanation}\n`);
      stdout.write(`  → ${finding.suggestion}\n\n`);
    }
  }

  stderr.write(`\n${modelId} · ${usage.inputTokens ?? "?"} in / ${usage.outputTokens ?? "?"} out\n`);

  return review.findings.some((finding) => finding.severity === "critical") ? 1 : 0;
}

const entryPoint = argv[1];
const isDirectRun = entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (isDirectRun) {
  try {
    exit(await main(argv.slice(2)));
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (env.DEBUG && error instanceof Error && error.stack) {
      stderr.write(`${error.stack}\n`);
    }
    exit(1);
  }
}
