import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { createReviewAgent, reviewCode } from "./reviews.js";
import { REVIEW_INSTRUCTIONS } from "../prompts/reviews.js";
import type { ReviewResult } from "../schemas/reviews.js";

const REVIEW: ReviewResult = {
  summary: "One unhandled rejection, otherwise sound.",
  findings: [
    {
      severity: "critical",
      file: "src/a.ts",
      line: 2,
      title: "Unhandled rejection",
      explanation: "The promise can reject and nothing catches it, crashing the process.",
      suggestion: "Wrap the await in try/catch and surface the error.",
    },
  ],
};

/** A model that always answers with {@link REVIEW}, recording every call it gets. */
function mockModel(modelId = "test/review-model"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(REVIEW) }],
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

const FILES = [{ path: "src/a.ts", content: "const a = 1;\nawait risky();" }];

describe("createReviewAgent", () => {
  it("pins temperature to 0 so repeated reviews of one file do not drift", async () => {
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

  it("carries no tools — the agent reads nothing beyond the source it is handed", () => {
    // The SDK types `tools` as always present but leaves it undefined when the
    // agent was built without any. Spreading covers both shapes.
    expect({ ...createReviewAgent({ model: mockModel() }).tools }).toEqual({});
  });

  it("tags runs with a stable id so eval telemetry can attribute them", () => {
    expect(createReviewAgent({ model: mockModel() }).id).toBe("code-reviewer");
  });
});

describe("reviewCode", () => {
  it("returns the parsed review, the usage, and the injected model id", async () => {
    const model = mockModel("test/review-model");

    const result = await reviewCode({ files: FILES, model });

    expect(result.review).toEqual(REVIEW);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(20);
    expect(result.modelId).toBe("test/review-model");
  });

  it("hands the model the numbered source built by buildReviewPrompt", async () => {
    const model = mockModel();

    await reviewCode({ files: FILES, model });

    const shown = userTextOf(model);
    // `shown` is JSON, so the prompt's real tabs arrive escaped — `\\t` here is the
    // two characters JSON.stringify writes, not a tab.
    expect(shown).toContain("--- src/a.ts ---");
    expect(shown).toContain("1\\tconst a = 1;");
    expect(shown).toContain("2\\tawait risky();");
  });

  it("passes review context through to the prompt", async () => {
    const model = mockModel();

    await reviewCode({ files: FILES, model, context: "Ticket ZWC-1: tighten validation." });

    expect(userTextOf(model)).toContain("Ticket ZWC-1: tighten validation.");
  });

  it("rejects an empty file list rather than paying for an empty review", async () => {
    await expect(reviewCode({ files: [], model: mockModel() })).rejects.toThrow(
      "reviewCode: at least one file is required",
    );
  });

  it("makes no model call when the file list is empty", async () => {
    const model = mockModel();

    await expect(reviewCode({ files: [], model })).rejects.toThrow();

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
