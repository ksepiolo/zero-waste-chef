import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { createReviewAgent, reviewCode } from "./reviews.js";
import { REVIEW_INSTRUCTIONS } from "../prompts/reviews.js";
import { CRITERION_KEYS, type ReviewInputDiff, type ReviewResult } from "../schemas/reviews.js";

function criterion(score: number) {
  return { score, rationale: "Scored against the criterion definition.", issues: [] };
}

const REVIEW: ReviewResult = {
  summary: "One unhandled rejection, otherwise sound.",
  criteria: {
    implementation_correctness: {
      score: 3,
      rationale: "The added await can reject and nothing catches it.",
      issues: [
        {
          file: "src/a.ts",
          quote: "+await risky();",
          explanation: "The promise can reject and nothing catches it, crashing the process.",
          suggestion: "Wrap the await in try/catch and surface the error.",
        },
      ],
    },
    idiomaticity: criterion(8),
    complexity: criterion(9),
    test_risk_coverage: criterion(5),
    documentation: criterion(7),
    security_safety: criterion(8),
  },
};

/** A model that always answers with {@link REVIEW}, recording every call it gets. */
function mockModel(modelId = "test/review-model"): MockLanguageModelV4 {
  return modelReturning(JSON.stringify(REVIEW), modelId);
}

function modelReturning(text: string, modelId = "test/review-model"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

/** The instructions reach the model as the leading system message. */
function systemTextOf(model: MockLanguageModelV4): string {
  const message = model.doGenerateCalls[0]?.prompt[0];
  return message?.role === "system" ? message.content : "";
}

/** Everything the model was shown that is not the system message. */
function userTextOf(model: MockLanguageModelV4): string {
  return JSON.stringify(model.doGenerateCalls[0]?.prompt.filter((message) => message.role !== "system"));
}

const DIFF = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,1 +1,2 @@", " const a = 1;", "+await risky();"].join("\n");

const PR: ReviewInputDiff = {
  title: "Call risky() on startup",
  description: "Adds the startup call requested in ZWC-1.",
  diff: DIFF,
};

describe("createReviewAgent", () => {
  it("pins temperature to 0 so repeated reviews of one diff do not drift", async () => {
    const model = mockModel();

    await createReviewAgent({ model }).generate({ prompt: "review this" });

    expect(model.doGenerateCalls[0]?.temperature).toBe(0);
  });

  it("lets a caller override the temperature", async () => {
    const model = mockModel();

    await createReviewAgent({ model, temperature: 0.7 }).generate({ prompt: "review this" });

    expect(model.doGenerateCalls[0]?.temperature).toBe(0.7);
  });

  it("sends REVIEW_INSTRUCTIONS by default", async () => {
    const model = mockModel();

    await createReviewAgent({ model }).generate({ prompt: "review this" });

    expect(systemTextOf(model)).toBe(REVIEW_INSTRUCTIONS);
  });

  it("lets an eval swap in a prompt variant via instructions", async () => {
    const model = mockModel();

    await createReviewAgent({ model, instructions: "Only report security defects." }).generate({
      prompt: "review this",
    });

    expect(systemTextOf(model)).toBe("Only report security defects.");
    expect(systemTextOf(model)).not.toBe(REVIEW_INSTRUCTIONS);
  });

  it("carries no tools — the agent reads nothing beyond the diff it is handed", () => {
    // The SDK types `tools` as always present but leaves it undefined when the
    // agent was built without any. Spreading covers both shapes.
    expect({ ...createReviewAgent({ model: mockModel() }).tools }).toEqual({});
  });

  it("tags runs with a stable id so eval telemetry can attribute them", () => {
    expect(createReviewAgent({ model: mockModel() }).id).toBe("code-reviewer");
  });

  // `tool-loop-agent` F1: swapping the schema for `z.looseObject({})` used to leave
  // every test passing, so the suite proved only that *some* structured output was
  // configured. These two pin which schema is wired in.
  it("rejects structured output that is valid JSON of the wrong shape", async () => {
    const agent = createReviewAgent({ model: modelReturning(JSON.stringify({ foo: 1 })) });

    await expect(agent.generate({ prompt: "review this" })).rejects.toThrow(/schema/i);
  });

  it("rejects a review that is missing one of the six criteria", async () => {
    const { security_safety: _dropped, ...partial } = REVIEW.criteria;
    const agent = createReviewAgent({ model: modelReturning(JSON.stringify({ ...REVIEW, criteria: partial })) });

    await expect(agent.generate({ prompt: "review this" })).rejects.toThrow(/schema/i);
  });
});

describe("reviewCode", () => {
  it("returns the parsed review, the usage, and the injected model id", async () => {
    const model = mockModel("test/review-model");

    const result = await reviewCode({ input: PR, model });

    expect(result.review).toStrictEqual(REVIEW);
    expect(Object.keys(result.review.criteria)).toStrictEqual([...CRITERION_KEYS]);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(20);
    expect(result.modelId).toBe("test/review-model");
  });

  it("hands the model the diff verbatim, with no line numbering added", async () => {
    const model = mockModel();

    await reviewCode({ input: PR, model });

    // `shown` is JSON, so the prompt's real newlines arrive escaped — `\\n` here is
    // the two characters JSON.stringify writes, not a newline.
    const shown = userTextOf(model);
    expect(shown).toContain("@@ -1,1 +1,2 @@");
    expect(shown).toContain("+await risky();");
    expect(shown).not.toContain("1\\tconst a = 1;");
  });

  it("passes the title and description through to the prompt", async () => {
    const model = mockModel();

    await reviewCode({ input: PR, model });

    const shown = userTextOf(model);
    expect(shown).toContain("Call risky() on startup");
    expect(shown).toContain("Adds the startup call requested in ZWC-1.");
  });

  it("rejects a blank diff rather than paying for an empty review", async () => {
    await expect(reviewCode({ input: { ...PR, diff: "   \n  " }, model: mockModel() })).rejects.toThrow(
      "reviewCode: a non-empty diff is required",
    );
  });

  it("makes no model call when the diff is blank", async () => {
    const model = mockModel();

    await expect(reviewCode({ input: { ...PR, diff: "" }, model })).rejects.toThrow();

    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("provider resolution", () => {
  it("is lazy: importing the module without credentials neither throws nor reads env", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.resetModules();

    const module = await import("./reviews.js");

    expect(typeof module.createReviewAgent).toBe("function");
    // Only now, at call time, is the missing key surfaced.
    expect(() => module.createReviewAgent()).toThrow(/OPENROUTER_API_KEY/);
    // An injected model bypasses the provider entirely — this is the eval path.
    expect(() => module.createReviewAgent({ model: mockModel() })).not.toThrow();

    vi.unstubAllEnvs();
  });
});
