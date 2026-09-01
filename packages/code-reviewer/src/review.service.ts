import { generateText, Output, type LanguageModel, type LanguageModelUsage } from "ai";

import { createProviderContext } from "./openrouter.provider.js";
import { buildReviewPrompt, REVIEW_INSTRUCTIONS } from "./prompts/reviews.js";
import { reviewResultSchema, type ReviewInputFile, type ReviewResult } from "./schemas/reviews.js";

export interface ReviewCodeOptions {
  files: ReviewInputFile[];
  /** Extra context: the change's intent, the ticket, house rules to enforce. */
  context?: string;
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
 * Reviews a set of files and returns structured findings.
 *
 * This is the seam the rest of the tooling builds on: swap the prompt, add
 * tools, or wrap it in an agent loop without callers having to change.
 */
export async function reviewCode(options: ReviewCodeOptions): Promise<ReviewCodeResponse> {
  const { files, context, abortSignal } = options;

  if (files.length === 0) {
    throw new Error("reviewCode: at least one file is required");
  }

  const { model, modelId } = resolveModel(options.model);

  const { output, usage } = await generateText({
    model,
    instructions: REVIEW_INSTRUCTIONS,
    output: Output.object({ schema: reviewResultSchema }),
    prompt: buildReviewPrompt(files, context),
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
