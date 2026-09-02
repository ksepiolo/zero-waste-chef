/**
 * The reviewer as a reusable agent.
 *
 * `createReviewAgent()` is the injectable seam: an eval harness builds one with
 * its own model and prompt variant and drives it directly, never touching the
 * CLI and never needing `OPENROUTER_API_KEY`. `reviewCode()` is the convenience
 * wrapper the CLI uses.
 *
 * The agent deliberately carries no tools — it reads nothing but the diff it
 * was handed, which is what makes an eval run reproducible. `stopWhen` is left
 * at the SDK default so adding tools later needs no change here.
 */
import { Output, ToolLoopAgent, type LanguageModel, type LanguageModelUsage } from "ai";

import { createProviderContext } from "../openrouter.provider.js";
import { buildReviewPrompt, REVIEW_INSTRUCTIONS } from "../prompts/reviews.js";
import { reviewResultSchema, type ReviewInputDiff, type ReviewResult } from "../schemas/reviews.js";

/** Stable id so eval telemetry can attribute runs to this agent. */
const REVIEW_AGENT_ID = "code-reviewer";

/** Reviews must not drift between runs over the same source. */
const DEFAULT_TEMPERATURE = 0;

export interface CreateReviewAgentOptions {
  /** Defaults to the model from `OPENROUTER_MODEL`, resolved lazily on call. */
  model?: LanguageModel;
  /** Defaults to {@link REVIEW_INSTRUCTIONS}. The seam for prompt variants. */
  instructions?: string;
  /** Defaults to `0`. */
  temperature?: number;
}

export interface ReviewCodeOptions {
  /** The pull request under review: title, description and unified diff. */
  input: ReviewInputDiff;
  /** Defaults to the model from `OPENROUTER_MODEL`. */
  model?: LanguageModel;
  abortSignal?: AbortSignal;
}

export interface ReviewCodeResponse {
  review: ReviewResult;
  usage: LanguageModelUsage;
  modelId: string;
}

/**
 * Builds the review agent.
 *
 * The provider is resolved inside the call, never at module scope, so importing
 * this module in a process with no credentials neither throws nor reads env.
 */
export function createReviewAgent(options: CreateReviewAgentOptions = {}) {
  const { model } = resolveModel(options.model);

  return new ToolLoopAgent({
    id: REVIEW_AGENT_ID,
    model,
    instructions: options.instructions ?? REVIEW_INSTRUCTIONS,
    output: Output.object({ schema: reviewResultSchema }),
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
  });
}

/**
 * Reviews a pull request diff and returns the six scored criteria.
 *
 * This is the seam the rest of the tooling builds on: swap the prompt, add
 * tools, or drive the agent directly without callers having to change.
 */
export async function reviewCode(options: ReviewCodeOptions): Promise<ReviewCodeResponse> {
  const { input, abortSignal } = options;

  if (input.diff.trim() === "") {
    throw new Error("reviewCode: a non-empty diff is required");
  }

  const { model, modelId } = resolveModel(options.model);
  const agent = createReviewAgent({ model });

  const { output, usage } = await agent.generate({
    prompt: buildReviewPrompt(input),
    ...(abortSignal ? { abortSignal } : {}),
  });

  return { review: output, usage, modelId };
}

function resolveModel(override: LanguageModel | undefined): { model: LanguageModel; modelId: string } {
  if (override !== undefined) {
    return {
      model: override,
      modelId: typeof override === "string" ? override : override.modelId,
    };
  }

  const context = createProviderContext();
  return { model: context.model, modelId: context.modelId };
}
