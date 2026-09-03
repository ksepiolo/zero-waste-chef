/**
 * The adapter's contract, proved offline.
 *
 * `npm run eval` is the real integration test, but it costs money and needs a
 * key. These cases pin everything about the provider that is not the model's
 * judgement — verdict derivation, output shape, token accounting, and the error
 * path — so a broken adapter is caught by `npm test` rather than by a paid run
 * that reports three failing columns for the wrong reason.
 */
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import ReviewerProvider, { type ReviewerProviderOutput } from "./reviewer.provider.js";
import { CRITERION_KEYS, type ReviewResult } from "../src/index.js";

const MODEL_ID = "test/review-model";

function criterion(score: number) {
  return { score, rationale: "Scored against the criterion definition.", issues: [] };
}

/** A review that fails: `implementation_correctness` sits on the floor. */
const FAILING_REVIEW: ReviewResult = {
  summary: "The refetch effect never re-runs, so the list shows the wrong category.",
  criteria: {
    implementation_correctness: {
      score: 3,
      rationale: "The effect's dependency array is empty, so it never refetches.",
      issues: [
        {
          file: "src/components/item-list.tsx",
          quote: "+  }, []);",
          explanation: "categoryId changes never trigger a refetch, so stale items stay on screen.",
          suggestion: "Add categoryId to the dependency array.",
        },
      ],
    },
    idiomaticity: criterion(6),
    complexity: criterion(8),
    test_risk_coverage: criterion(5),
    documentation: criterion(7),
    security_safety: criterion(9),
  },
};

/** The same review with nothing at or below the failing floor. */
const PASSING_REVIEW: ReviewResult = {
  summary: "A clean migration with no defects worth blocking on.",
  criteria: {
    implementation_correctness: criterion(9),
    idiomaticity: criterion(8),
    complexity: criterion(8),
    test_risk_coverage: criterion(5),
    documentation: criterion(7),
    security_safety: criterion(9),
  },
};

const VARS = {
  title: "Migrate ItemList to React 19",
  description: "Converts the class component to hooks. No behaviour change.",
  diff: ["--- a/src/a.tsx", "+++ b/src/a.tsx", "@@ -1,1 +1,1 @@", "-const a = 1;", "+const a = 2;"].join("\n"),
};

/** Mirrors the `modelReturning()` helper in `src/agents/reviews.test.ts`. */
function modelReturning(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: MODEL_ID,
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 9000, noCache: 8500, cacheRead: 500, cacheWrite: undefined },
        outputTokens: { total: 2000, text: 1800, reasoning: 200 },
      },
      warnings: [],
    },
  });
}

/** Everything the model was shown that is not the system message. */
function userTextOf(model: MockLanguageModelV4): string {
  const messages = model.doGenerateCalls[0]?.prompt ?? [];

  return messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

function modelThrowing(error: Error): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: MODEL_ID,
    doGenerate: () => {
      throw error;
    },
  });
}

/** Builds the provider the way promptfoo does, but against an injected model. */
function providerReturning(review: ReviewResult): ReviewerProvider {
  return new ReviewerProvider({
    id: "file://reviewer.provider.ts",
    config: { model: MODEL_ID, languageModel: modelReturning(JSON.stringify(review)) },
  });
}

/** promptfoo always passes a `context`; only `vars` matters to this provider. */
function callWith(provider: ReviewerProvider, vars: Record<string, string> = VARS) {
  return provider.callApi("ignored by this provider", {
    prompt: { raw: "{{diff}}", label: "passthrough" },
    vars,
  });
}

describe("ReviewerProvider construction", () => {
  it("takes the model id from the provider entry's config", () => {
    const provider = new ReviewerProvider({ config: { model: "z-ai/glm-5.1" } });

    expect(provider.id()).toBe("reviewer:z-ai/glm-5.1");
  });

  it("falls back to the provider entry's own id when it names a model", () => {
    const provider = new ReviewerProvider({ id: "deepseek/deepseek-v4-flash" });

    expect(provider.id()).toBe("reviewer:deepseek/deepseek-v4-flash");
  });

  it("throws rather than defaulting when no model id is given", () => {
    // A silent fallback to OPENROUTER_MODEL would make two arms of the matrix
    // the same model while the results grid still showed two columns.
    expect(() => new ReviewerProvider({ id: "file://reviewer.provider.ts" })).toThrow(/needs an explicit model id/);
    expect(() => new ReviewerProvider({})).toThrow(/needs an explicit model id/);
  });
});

describe("ReviewerProvider.callApi", () => {
  it("returns the review with a failing verdict when a criterion is on the floor", async () => {
    const response = await callWith(providerReturning(FAILING_REVIEW));

    const output = response.output as ReviewerProviderOutput;
    expect(response.error).toBeUndefined();
    expect(output.verdict).toEqual({ passed: false, failing: ["implementation_correctness"] });
  });

  it("returns a passing verdict when no criterion falls to the floor", async () => {
    const response = await callWith(providerReturning(PASSING_REVIEW));

    const output = response.output as ReviewerProviderOutput;
    expect(output.verdict).toEqual({ passed: true, failing: [] });
  });

  it("carries the summary and all six criteria through to the assertions", async () => {
    const response = await callWith(providerReturning(FAILING_REVIEW));

    const output = response.output as ReviewerProviderOutput;
    expect(output.summary).toBe(FAILING_REVIEW.summary);
    expect(Object.keys(output.criteria)).toEqual([...CRITERION_KEYS]);
  });

  it("builds its own prompt from vars, ignoring the prompt promptfoo renders", async () => {
    const model = modelReturning(JSON.stringify(FAILING_REVIEW));
    const provider = new ReviewerProvider({ config: { model: MODEL_ID, languageModel: model } });

    await callWith(provider);

    const userText = userTextOf(model);
    expect(userText).toContain(VARS.title);
    expect(userText).toContain(VARS.diff);
    expect(userText).not.toContain("ignored by this provider");
  });

  it("reports token usage so the matrix can carry cost", async () => {
    const response = await callWith(providerReturning(FAILING_REVIEW));

    expect(response.tokenUsage).toEqual({
      prompt: 9000,
      completion: 2000,
      total: 11000,
      cached: 500,
      numRequests: 1,
      completionDetails: { reasoning: 200 },
    });
  });

  it("returns an error rather than rejecting when the model call fails", async () => {
    const provider = new ReviewerProvider({
      config: { model: MODEL_ID, languageModel: modelThrowing(new Error("upstream 502")) },
    });

    const response = await callWith(provider);

    expect(response.output).toBeUndefined();
    expect(response.error).toContain("upstream 502");
  });

  it("returns an error when the model cannot produce the schema at all", async () => {
    // The likeliest failure mode for the weaker challengers: a review that reads
    // fine as prose but does not parse as `reviewResultSchema`.
    const provider = new ReviewerProvider({
      config: { model: MODEL_ID, languageModel: modelReturning('{"summary":"Looks good to me."}') },
    });

    const response = await callWith(provider);

    expect(response.output).toBeUndefined();
    expect(response.error).toBeTypeOf("string");
  });

  it("returns an error when a required var is missing from the test case", async () => {
    const response = await callWith(providerReturning(FAILING_REVIEW), { title: "No diff supplied" });

    expect(response.error).toContain('test var "description"');
  });
});
