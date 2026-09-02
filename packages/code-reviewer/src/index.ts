/**
 * @zero-waste-chef/code-reviewer
 *
 * Public surface of the AI code reviewer. Importing this module has no side
 * effects: it reads no environment, touches no filesystem, and writes nothing.
 * The CLI lives in `./cli.ts` and is deliberately not re-exported here.
 *
 *   npm start -- src/foo.ts src/bar.ts
 */
export { loadEnv, type Env } from "./env.config.js";
export { createProviderContext, type ProviderContext } from "./openrouter.provider.js";
export { buildReviewPrompt, REVIEW_INSTRUCTIONS } from "./prompts/reviews.js";
export {
  reviewFindingSchema,
  reviewResultSchema,
  severitySchema,
  type ReviewFinding,
  type ReviewInputFile,
  type ReviewResult,
  type Severity,
} from "./schemas/reviews.js";
export {
  createReviewAgent,
  reviewCode,
  type CreateReviewAgentOptions,
  type ReviewCodeOptions,
  type ReviewCodeResponse,
} from "./agents/reviews.js";
