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
| `npm test`               | Run the package's vitest suite              |
| `npm run typecheck`      | `tsc --noEmit`                              |
| `npm run build`          | Emit ESM + declarations to `dist/`          |

```bash
npm start -- ../../src/lib/utils.ts
```

Exit code is `1` when any finding is `critical`, `2` on bad usage, `0` otherwise.

## Using it as a library

`reviewCode()` is the one-call path — it resolves the model from the environment
and returns the parsed review:

```ts
import { reviewCode } from "@zero-waste-chef/code-reviewer";

const { review, usage, modelId } = await reviewCode({
  files: [{ path: "src/utils.ts", content: source }],
  context: "This is a hot path — flag anything allocating per request.",
});
```

`createReviewAgent()` is the injectable seam underneath it. Every option is
optional, so an eval harness can supply its own model and prompt variant and
drive the agent directly — no `OPENROUTER_API_KEY`, no CLI, no filesystem:

```ts
import { createReviewAgent, buildReviewPrompt } from "@zero-waste-chef/code-reviewer";
import { MockLanguageModelV4 } from "ai/test";

const agent = createReviewAgent({
  model: new MockLanguageModelV4({ doGenerate: async () => stubbedReview }),
  instructions: "Only report security defects.", // A/B a prompt variant
});

const { output } = await agent.generate({
  prompt: buildReviewPrompt([{ path: "src/utils.ts", content: source }]),
});
```

## Layout

| File                         | Role                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `src/index.ts`               | Public re-exports only — importing it has no side effects        |
| `src/cli.ts`                 | argv parsing, file reads, stdout formatting, exit codes          |
| `src/agents/reviews.ts`      | `createReviewAgent()` factory + the `reviewCode()` wrapper       |
| `src/prompts/reviews.ts`     | `REVIEW_INSTRUCTIONS` + `buildReviewPrompt()`                    |
| `src/schemas/reviews.ts`     | zod schemas for the structured review output + `ReviewInputFile` |
| `src/env.config.ts`          | zod-validated environment, with readable failure messages        |
| `src/openrouter.provider.ts` | Single place where the provider and default model are built      |

The repo's `CLAUDE.md` asks for dot-separated type suffixes (`feature.service.ts`).
`agents/`, `prompts/` and `schemas/` put the type in the directory instead — a
deliberate departure, so each seam is a directory an eval can grow variants in.

## Notes for extending this

- Structured output goes through `generateText` + `Output.object({ schema })`.
  `generateObject` still exists in `ai` v7 but the docs treat `Output` as the
  current path, and it composes with tool calling in the same request.
- The AI SDK ships version-matched docs at `node_modules/ai/docs/` — read those
  rather than relying on remembered APIs.
- The reviewer is a `ToolLoopAgent` with **no tools** and `temperature: 0`. That
  is deliberate: it reads nothing but the source it is handed, so an eval run is
  reproducible and costs exactly one model call. `stopWhen` is left at the SDK
  default (`isStepCount(20)`), so giving the agent tools later is a change to
  `createReviewAgent()` alone — no call site moves.
- `src/prompts/reviews.ts` is the seam for prompt variants; pass the variant as
  `instructions` to `createReviewAgent()` rather than editing the default.
- Model ids change often. List current ones with
  `curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id'`.
