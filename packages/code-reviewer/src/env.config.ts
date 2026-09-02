import { z } from "zod";

const MISSING_API_KEY = "OPENROUTER_API_KEY is required — create one at https://openrouter.ai/keys";

/**
 * Runtime configuration, read once from the environment.
 *
 * Nothing here is read at import time — call {@link loadEnv} so that callers
 * (tests, other packages) can control when validation happens and how a
 * missing key is surfaced.
 */
const envSchema = z.object({
  OPENROUTER_API_KEY: z.string(MISSING_API_KEY).min(1, MISSING_API_KEY),
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-sonnet-5"),
  OPENROUTER_APP_NAME: z.string().min(1).default("zero-waste-chef-code-reviewer"),
  OPENROUTER_APP_URL: z.url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * A blank line in a `.env` file (`FOO=`) reaches us as `""`, not as an absent
 * key. Drop those so optional variables fall back to their defaults instead of
 * failing validation.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => {
      const value = entry[1];
      return value !== undefined && value.trim() !== "";
    }),
  );
}

/**
 * Validates `process.env` (or any record passed in) against the schema.
 *
 * @throws {Error} with a readable, multi-line summary of what is missing.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(withoutBlanks(source));

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
