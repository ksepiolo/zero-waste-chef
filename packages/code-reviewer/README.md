# @zero-waste-chef/code-reviewer

AI-assisted code review built on the [Vercel AI SDK](https://ai-sdk.dev) (`ai` v7),
the [OpenRouter](https://openrouter.ai) provider, and zod-validated structured output.

This package is a standalone npm project inside `packages/` — the root repo has no
workspaces, so install and run it from this directory.

## Setup

```bash
cd packages/code-reviewer
npm install
cp .env.example .env   # then paste your OpenRouter key
```

| Variable              | Required | Default                         |
| --------------------- | -------- | ------------------------------- |
| `OPENROUTER_API_KEY`  | yes      | —                               |
| `OPENROUTER_MODEL`    | no       | `anthropic/claude-sonnet-5`     |
| `OPENROUTER_APP_NAME` | no       | `zero-waste-chef-code-reviewer` |
| `OPENROUTER_APP_URL`  | no       | —                               |

`.env` is loaded by Node's own `--env-file-if-exists` flag, so there is no `dotenv`
dependency and the same code works when the variables come from the real environment.

## Scripts

| Command                  | What it does                                |
| ------------------------ | ------------------------------------------- |
| `npm start -- <files>`   | Review files and print findings (via `tsx`) |
| `npm run dev -- <files>` | Same, restarting on source changes          |
| `npm run typecheck`      | `tsc --noEmit`                              |
| `npm run build`          | Emit ESM + declarations to `dist/`          |

```bash
npm start -- ../../src/lib/utils.ts
```

Exit code is `1` when any finding is `critical`, `2` on bad usage, `0` otherwise.

## Using it as a library

```ts
import { reviewCode } from "@zero-waste-chef/code-reviewer";

const { review, usage, modelId } = await reviewCode({
  files: [{ path: "src/utils.ts", content: source }],
  context: "This is a hot path — flag anything allocating per request.",
});
```

## Layout

| File                         | Role                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `src/index.ts`               | Public exports + the CLI that runs when the file is executed directly |
| `src/env.config.ts`          | zod-validated environment, with readable failure messages             |
| `src/openrouter.provider.ts` | Single place where the provider and default model are built           |
| `src/review.schema.ts`       | zod schemas for the structured review output                          |
| `src/review.service.ts`      | `reviewCode()` — prompt assembly and the `generateText` call          |

## Notes for extending this

- Structured output goes through `generateText` + `Output.object({ schema })`.
  `generateObject` still exists in `ai` v7 but the docs treat `Output` as the
  current path, and it composes with tool calling in the same request.
- The AI SDK ships version-matched docs at `node_modules/ai/docs/` — read those
  rather than relying on remembered APIs.
- For tool-calling loops, use the SDK's `ToolLoopAgent` instead of hand-rolling
  the loop; `src/review.service.ts` is the seam to swap in.
- Model ids change often. List current ones with
  `curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id'`.
