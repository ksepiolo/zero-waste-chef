import { generateText, Output, type LanguageModel, type LanguageModelUsage } from "ai";

import { createProviderContext } from "./openrouter.provider.js";
import { reviewResultSchema, type ReviewInputFile, type ReviewResult } from "./review.schema.js";

const INSTRUCTIONS = [
  "You are a precise, senior code reviewer.",
  "Report only defects you can point at in the code you were given: correctness bugs, unhandled failure modes, security problems, and clear simplifications.",
  "Do not invent findings to fill the list — an empty findings array is the right answer for sound code.",
  "Anchor every finding to a file path and, where possible, a line number from the numbered source you were shown.",
].join(" ");

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
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: reviewResultSchema }),
    prompt: buildPrompt(files, context),
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

function buildPrompt(files: ReviewInputFile[], context: string | undefined): string {
  const sections = files.map((file) => {
    const numbered = file.content
      .split("\n")
      .map((line, index) => `${index + 1}\t${line}`)
      .join("\n");

    return `--- ${file.path} ---\n${numbered}`;
  });

  return [
    context ? `Context for this review:\n${context}\n` : "",
    "Review the following files. Line numbers are prefixed and are not part of the source.",
    "",
    sections.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");
}
