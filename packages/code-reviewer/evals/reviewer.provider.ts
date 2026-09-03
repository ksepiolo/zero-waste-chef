/**
 * The promptfoo → reviewer adapter.
 *
 * promptfoo owns the matrix, the runner and the reporting; this file is the one
 * seam between them and `createReviewAgent()`. One instance is constructed per
 * `providers:` entry in `promptfooconfig.yaml`, each pinned to a different
 * OpenRouter model, which is what turns the eval into a model comparison
 * without a single change to `src/`.
 *
 * The review is returned as a **structured object** rather than a JSON string.
 * promptfoo passes structured output to assertions untouched, so an assertion
 * addresses `output.criteria.security_safety.score` directly with no parse step.
 */
import type { LanguageModel, LanguageModelUsage } from "ai";
import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse, TokenUsage } from "promptfoo";

import {
  buildReviewPrompt,
  createProviderContext,
  createReviewAgent,
  deriveVerdict,
  loadEnv,
  type ReviewResult,
  type Verdict,
} from "../src/index.js";
import { toReviewInput, toReviewVars } from "./types.js";

/** promptfoo hands a `file://`-loaded provider its own path as `options.id`. */
const FILE_PROVIDER_PREFIX = "file://";

const MISSING_MODEL_ID = [
  "Eval config error: reviewer.provider.ts needs an explicit model id.",
  'Set `config: { model: "<org>/<model>" }` on the provider entry in promptfooconfig.yaml.',
  "Falling back to OPENROUTER_MODEL is deliberately unsupported: it would silently make two",
  "arms of the matrix the same model, and the comparison would look valid while measuring nothing.",
].join(" ");

/** The `config:` block of a `providers:` entry. */
export interface ReviewerProviderConfig {
  /** OpenRouter model id under test, e.g. `anthropic/claude-sonnet-5`. Required. */
  model?: string | undefined;
  /**
   * Test-only seam: a pre-built model used instead of resolving one through
   * OpenRouter, so `reviewer.provider.test.ts` can drive the whole adapter with
   * no API key and no network. Never set this from `promptfooconfig.yaml` —
   * YAML cannot express a `LanguageModel` anyway.
   */
  languageModel?: LanguageModel | undefined;
}

/** What an assertion receives as `output`: the review plus its derived verdict. */
export type ReviewerProviderOutput = ReviewResult & { verdict: Verdict };

export default class ReviewerProvider implements ApiProvider {
  private readonly modelId: string;
  private readonly injectedModel: LanguageModel | undefined;

  constructor(options: ProviderOptions = {}) {
    const config = readConfig(options.config);

    this.modelId = resolveModelId(config.model, options.id);
    this.injectedModel = config.languageModel;
  }

  /** Names the model rather than the file, so the results grid reads as a comparison. */
  id(): string {
    return `reviewer:${this.modelId}`;
  }

  /**
   * `_prompt` is deliberately ignored — and this is the single most confusing
   * thing about this file.
   *
   * promptfoo's schema requires a `prompts:` entry and renders it before every
   * provider call, but the reviewer's prompt is not promptfoo's to own: it is
   * `buildReviewPrompt()` over `REVIEW_INSTRUCTIONS`, the exact prompt the CLI
   * ships, and evaluating anything else would measure a prompt the product does
   * not use. So the config carries a passthrough entry to satisfy the schema and
   * this method rebuilds the real prompt from `context.vars` instead. Editing
   * the prompt in `promptfooconfig.yaml` changes nothing; edit
   * `src/prompts/reviews.ts`.
   */
  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    try {
      const input = toReviewInput(toReviewVars(context?.vars));
      const agent = createReviewAgent({ model: this.resolveModel() });

      const { output, usage } = await agent.generate({ prompt: buildReviewPrompt(input) });

      // Deriving the verdict here rather than in each assertion keeps
      // FAILING_SCORE_THRESHOLD in exactly one place — the package's own schema.
      const result: ReviewerProviderOutput = { ...output, verdict: deriveVerdict(output.criteria) };

      return { output: result, tokenUsage: toTokenUsage(usage) };
    } catch (error) {
      // Everything is caught on purpose. A weaker challenger failing `Output.object`
      // parsing must land as one red cell in the matrix, not as a crash that aborts
      // the other two arms halfway through a paid run.
      return { error: String(error) };
    }
  }

  private resolveModel(): LanguageModel {
    if (this.injectedModel !== undefined) {
      return this.injectedModel;
    }

    // `createProviderContext` accepts an `Env` override, so the per-model matrix
    // reuses the package's own key handling and app attribution verbatim.
    return createProviderContext(loadEnv({ ...process.env, OPENROUTER_MODEL: this.modelId })).model;
  }
}

/** `ProviderOptions.config` is `any`; narrow it once, here. */
function readConfig(config: unknown): ReviewerProviderConfig {
  if (typeof config !== "object" || config === null) {
    return {};
  }

  const record = config as Record<string, unknown>;

  return {
    model: typeof record.model === "string" ? record.model : undefined,
    languageModel: record.languageModel as LanguageModel | undefined,
  };
}

function resolveModelId(configured: string | undefined, providerId: string | undefined): string {
  const fromConfig = configured?.trim() ?? "";
  if (fromConfig !== "") {
    return fromConfig;
  }

  // A provider entry that omits `config.model` may still name the model as its
  // id; the path promptfoo defaults to is not a model and must not be accepted.
  const fromId = providerId?.trim() ?? "";
  if (fromId !== "" && !fromId.startsWith(FILE_PROVIDER_PREFIX)) {
    return fromId;
  }

  throw new Error(MISSING_MODEL_ID);
}

function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    prompt: usage.inputTokens,
    completion: usage.outputTokens,
    total: usage.totalTokens,
    cached: usage.inputTokenDetails.cacheReadTokens,
    numRequests: 1,
    completionDetails: { reasoning: usage.outputTokenDetails.reasoningTokens },
  };
}
