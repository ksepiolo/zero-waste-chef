import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CRITERION_KEYS,
  FAILING_SCORE_THRESHOLD,
  type CriterionScore,
  type ReviewCriteria,
  type ReviewResult,
} from "./schemas/reviews.js";

// `runCli` is the surface CI parses, so it is tested against a stubbed reviewer
// rather than a live model. `vi.hoisted` is needed because `vi.mock` is lifted
// above the imports.
const reviewCode = vi.hoisted(() => vi.fn());
vi.mock("./agents/reviews.js", () => ({ reviewCode }));

const { runCli } = await import("./cli.js");

function criterion(score: number): CriterionScore {
  return { score, rationale: `Scored ${String(score)} against the criterion definition.`, issues: [] };
}

function criteriaAll(score: number): ReviewCriteria {
  return Object.fromEntries(CRITERION_KEYS.map((key) => [key, criterion(score)])) as ReviewCriteria;
}

function review(criteria: ReviewCriteria): ReviewResult {
  return { summary: "Sound overall, one rough edge.", criteria };
}

/** Makes the stubbed reviewer answer with `result`. */
function respondWith(result: ReviewResult): void {
  reviewCode.mockResolvedValue({
    review: result,
    usage: { inputTokens: 10, outputTokens: 20 },
    modelId: "test/review-model",
  });
}

let dir: string;
let out: string[];
let err: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code-reviewer-cli-"));
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  respondWith(review(criteriaAll(8)));
});

afterEach(async () => {
  vi.restoreAllMocks();
  reviewCode.mockReset();
  await rm(dir, { recursive: true, force: true });
});

async function diffFile(content = "@@ -1,1 +1,2 @@\n const a = 1;\n+await risky();\n"): Promise<string> {
  const path = join(dir, "pr.diff");
  await writeFile(path, content, "utf8");
  return path;
}

const stdoutText = (): string => out.join("");
const stderrText = (): string => err.join("");

describe("runCli usage errors", () => {
  it.each([
    ["no arguments at all", []],
    ["a missing --title", ["--diff", "pr.diff"]],
    ["a missing --diff", ["--title", "Add rate limiting"]],
    ["an empty --title", ["--title", "", "--diff", "pr.diff"]],
    ["an unknown flag", ["--title", "T", "--diff", "pr.diff", "--severity", "critical"]],
  ])("returns 2 on %s", async (_label, args) => {
    expect(await runCli(args)).toBe(2);
    expect(reviewCode).not.toHaveBeenCalled();
  });

  it("prints the usage banner to stderr, never stdout", async () => {
    await runCli([]);

    expect(stderrText()).toContain("usage: npm start --");
    expect(stdoutText()).toBe("");
  });

  it("refuses to read both --diff and --body from stdin — the second would see nothing", async () => {
    expect(await runCli(["--title", "T", "--diff", "-", "--body", "-"])).toBe(2);
    expect(stderrText()).toContain("only one of --diff and --body can read stdin");
  });

  it("returns 2 when the diff path does not exist, without calling the model", async () => {
    expect(await runCli(["--title", "T", "--diff", join(dir, "absent.diff")])).toBe(2);
    expect(reviewCode).not.toHaveBeenCalled();
  });

  it("returns 2 on an empty diff rather than paying for an empty review", async () => {
    expect(await runCli(["--title", "T", "--diff", await diffFile("   \n\t\n")])).toBe(2);
    expect(stderrText()).toContain("the diff is empty");
    expect(reviewCode).not.toHaveBeenCalled();
  });
});

describe("runCli input handling", () => {
  it("passes the title, the diff, and a null description when --body is omitted", async () => {
    const path = await diffFile("@@ -1 +1 @@\n+const a = 1;\n");

    await runCli(["--title", "Add rate limiting", "--diff", path]);

    expect(reviewCode).toHaveBeenCalledWith({
      input: {
        title: "Add rate limiting",
        description: null,
        diff: "@@ -1 +1 @@\n+const a = 1;\n",
      },
    });
  });

  it("reads the description from the --body file", async () => {
    const body = join(dir, "body.md");
    await writeFile(body, "Closes ZWC-1.\n", "utf8");

    await runCli(["--title", "T", "--diff", await diffFile(), "--body", body]);

    expect(reviewCode.mock.calls[0]?.[0]).toMatchObject({ input: { description: "Closes ZWC-1.\n" } });
  });
});

describe("runCli --json", () => {
  it("returns 0 and emits a parseable document carrying all six criteria and the verdict", async () => {
    expect(await runCli(["--title", "T", "--diff", await diffFile(), "--json"])).toBe(0);

    const payload: unknown = JSON.parse(stdoutText());
    expect(payload).toMatchObject({
      summary: "Sound overall, one rough edge.",
      verdict: { passed: true, failing: [] },
    });
    const criteria = (payload as { criteria: Record<string, unknown> }).criteria;
    expect(Object.keys(criteria)).toStrictEqual([...CRITERION_KEYS]);
  });

  it("returns 1 and names the failing criteria when a score sits at the floor", async () => {
    respondWith(review({ ...criteriaAll(9), security_safety: criterion(FAILING_SCORE_THRESHOLD) }));

    expect(await runCli(["--title", "T", "--diff", await diffFile(), "--json"])).toBe(1);

    const payload = JSON.parse(stdoutText()) as { verdict: { passed: boolean; failing: string[] } };
    expect(payload.verdict).toStrictEqual({ passed: false, failing: ["security_safety"] });
  });

  it("writes JSON and nothing else to stdout — diagnostics go to stderr", async () => {
    await runCli(["--title", "T", "--diff", await diffFile(), "--json"]);

    expect(() => JSON.parse(stdoutText()) as unknown).not.toThrow();
    expect(stderrText()).toContain("test/review-model");
    expect(stdoutText()).not.toContain("test/review-model");
  });
});

describe("runCli human output", () => {
  it("returns 0 and prints every criterion with its score and rationale", async () => {
    expect(await runCli(["--title", "T", "--diff", await diffFile()])).toBe(0);

    const printed = stdoutText();
    expect(printed).toContain("Sound overall, one rough edge.");
    expect(printed).toContain("PASS");
    expect(printed).toContain("security and safety");
    expect(printed).toContain("test / risk coverage");
    expect(printed).toContain("Scored 8 against the criterion definition.");
    // Human mode is prose, not a JSON document.
    expect(() => JSON.parse(printed) as unknown).toThrow();
  });

  it("leads a failing review with FAIL and the criteria responsible", async () => {
    respondWith(review({ ...criteriaAll(9), documentation: criterion(2) }));

    expect(await runCli(["--title", "T", "--diff", await diffFile()])).toBe(1);
    expect(stdoutText()).toContain("FAIL — documentation");
  });

  it("renders an issue's file, quote and suggestion", async () => {
    const criteria = criteriaAll(9);
    criteria.security_safety = {
      score: 2,
      rationale: "Untrusted input reaches the shell.",
      issues: [
        {
          file: "src/a.ts",
          quote: "+exec(`ls ${userInput}`)",
          explanation: "Shell metacharacters in userInput execute arbitrary commands.",
          suggestion: "Use execFile with an argument array.",
        },
      ],
    };
    respondWith(review(criteria));

    await runCli(["--title", "T", "--diff", await diffFile()]);

    const printed = stdoutText();
    expect(printed).toContain("src/a.ts");
    expect(printed).toContain("+exec(`ls ${userInput}`)");
    expect(printed).toContain("Use execFile with an argument array.");
  });

  // A live model returned eight-line quotes on a real diff. Prefixing only the
  // first line left every continuation flush-left and destroyed the report.
  it("indents every line of a multi-line quote, not just the first", async () => {
    const criteria = criteriaAll(9);
    criteria.complexity = {
      score: 3,
      rationale: "The branch is tangled.",
      issues: [{ file: "src/a.ts", quote: "if (a) {\n  b();\n}", explanation: "e", suggestion: "s" }],
    };
    respondWith(review(criteria));

    await runCli(["--title", "T", "--diff", await diffFile()]);

    const quoted = stdoutText()
      .split("\n")
      .filter((line) => line.includes("if (a) {") || line.includes("b();") || line.trim() === "}");
    expect(quoted).toHaveLength(3);
    // Every line sits in the same column; none falls back to the left margin.
    for (const line of quoted) {
      expect(line).toMatch(/^ {9}/);
    }
  });

  it("elides a quote longer than three lines rather than dumping the hunk", async () => {
    const criteria = criteriaAll(9);
    criteria.complexity = {
      score: 3,
      rationale: "The branch is tangled.",
      issues: [{ file: "src/a.ts", quote: "l1\nl2\nl3\nl4\nl5", explanation: "e", suggestion: "s" }],
    };
    respondWith(review(criteria));

    await runCli(["--title", "T", "--diff", await diffFile()]);

    const printed = stdoutText();
    expect(printed).toContain("l3");
    expect(printed).not.toContain("l4");
    expect(printed).toContain("… 2 more line(s)");
  });
});

describe("runCli reviewer failures", () => {
  // `tool-loop-agent` F6: exit 1 used to mean both "a critical finding" and "the
  // run crashed", so nothing could gate on the code. 3 is now reserved for the
  // reviewer itself failing.
  it("returns 3, not 1, when the reviewer throws", async () => {
    reviewCode.mockRejectedValue(new Error("OPENROUTER_API_KEY is required"));

    expect(await runCli(["--title", "T", "--diff", await diffFile()])).toBe(3);
    expect(stderrText()).toContain("the reviewer failed to run");
    expect(stderrText()).toContain("OPENROUTER_API_KEY is required");
  });

  it("writes no verdict to stdout when the reviewer fails", async () => {
    reviewCode.mockRejectedValue(new Error("boom"));

    await runCli(["--title", "T", "--diff", await diffFile(), "--json"]);

    expect(stdoutText()).toBe("");
  });

  it("prints the model's raw text under DEBUG — the stack never contains it", async () => {
    vi.stubEnv("DEBUG", "1");
    const error = Object.assign(new Error("No object generated: could not parse the response."), {
      text: "Sure! Here is the review: ...",
    });
    reviewCode.mockRejectedValue(error);

    expect(await runCli(["--title", "T", "--diff", await diffFile()])).toBe(3);
    expect(stderrText()).toContain("Sure! Here is the review: ...");

    vi.unstubAllEnvs();
  });
});
