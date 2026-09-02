/**
 * @zero-waste-chef/code-reviewer
 *
 * Public surface of the AI code reviewer. Importing this module has no side
 * effects: it reads no environment, touches no filesystem, and writes nothing.
 * The CLI lives in `./cli.ts` and is deliberately not re-exported here.
 *
 *   npm start -- --title "Add rate limiting" --diff pr.diff --json
 */
export { loadEnv, type Env } from "./env.config.js";
export { createProviderContext, type ProviderContext } from "./openrouter.provider.js";
export { buildReviewPrompt, REVIEW_INSTRUCTIONS } from "./prompts/reviews.js";
export {
  criterionIssueSchema,
  criterionKeySchema,
  criterionScoreSchema,
  reviewCriteriaSchema,
  reviewResultSchema,
  deriveVerdict,
  CRITERION_KEYS,
  FAILING_SCORE_THRESHOLD,
  type CriterionIssue,
  type CriterionKey,
  type CriterionScore,
  type ReviewCriteria,
  type ReviewInputDiff,
  type ReviewResult,
  type Verdict,
} from "./schemas/reviews.js";
export {
  createReviewAgent,
  reviewCode,
  type CreateReviewAgentOptions,
  type ReviewCodeOptions,
  type ReviewCodeResponse,
} from "./agents/reviews.js";
