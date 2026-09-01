/**
 * Command-line entry point for the code reviewer.
 *
 *   npm start -- src/foo.ts src/bar.ts
 *
 * Kept apart from `index.ts` so importing the library pulls in no `node:*`
 * modules, reads no environment, and writes nothing to stdout.
 */
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { argv, cwd, env, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

import type { ReviewFinding, ReviewInputFile } from "./review.schema.js";
import { reviewCode } from "./review.service.js";

const SEVERITY_LABEL: Record<ReviewFinding["severity"], string> = {
  critical: "CRITICAL",
  major: "MAJOR",
  minor: "MINOR",
  nit: "NIT",
};

/**
 * Reviews the given paths and prints the findings.
 *
 * @param args CLI arguments without the node/script prefix — one or more paths.
 * @returns The process exit code: 2 on bad usage, 1 when any finding is
 *   `critical`, 0 otherwise.
 */
export async function runCli(args: string[]): Promise<number> {
  if (args.length === 0) {
    stderr.write("usage: npm start -- <file> [file...]\n");
    return 2;
  }

  const files: ReviewInputFile[] = await Promise.all(
    args.map(async (path) => ({
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
    exit(await runCli(argv.slice(2)));
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (env.DEBUG && error instanceof Error && error.stack) {
      stderr.write(`${error.stack}\n`);
    }
    exit(1);
  }
}
