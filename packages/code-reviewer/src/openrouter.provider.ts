import { createOpenRouter, type OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import { loadEnv, type Env } from "./env.config.js";

export interface ProviderContext {
  readonly env: Env;
  readonly provider: OpenRouterProvider;
  /** The model id from `OPENROUTER_MODEL`, already bound into {@link model}. */
  readonly modelId: string;
  readonly model: LanguageModel;
}

/**
 * Builds the OpenRouter provider and the default language model.
 *
 * Every AI entry point in this package should go through here so that API key
 * handling, app attribution and the default model live in exactly one place.
 */
export function createProviderContext(env: Env = loadEnv()): ProviderContext {
  const provider = createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    appName: env.OPENROUTER_APP_NAME,
    ...(env.OPENROUTER_APP_URL ? { appUrl: env.OPENROUTER_APP_URL } : {}),
  });

  return {
    env,
    provider,
    modelId: env.OPENROUTER_MODEL,
    model: provider(env.OPENROUTER_MODEL),
  };
}
