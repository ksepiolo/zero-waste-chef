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

| Command                 | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `npm start -- <args>`   | Review a pull request diff (via `tsx`)                   |
| `npm run dev -- <args>` | Same, restarting on source changes                       |
| `npm test`              | Run the package's vitest suite                           |
| `npm run lint`          | `eslint src evals` against the package-local flat config |
| `npm run typecheck`     | `tsc --noEmit`                                           |
| `npm run build`         | Emit ESM + declarations to `dist/`                       |
| `npm run eval`          | Run the promptfoo model comparison (needs a key)         |
| `npm run eval:view`     | Open the last eval run in the browser UI                 |

## Reviewing a pull request

The reviewer scores a **diff**, not a set of files. Six criteria, each 1–10:

| Criterion                    | Question                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `implementation_correctness` | Does the code do what it claims, across edge cases and error paths, without regressions?     |
| `idiomaticity`               | Does it follow the language, framework and project conventions a fluent reader would expect? |
| `complexity`                 | Is it as simple as the problem allows?                                                       |
| `test_risk_coverage`         | Are the risky paths tested in proportion to their risk?                                      |
| `documentation`              | Is the non-obvious explained where a reader would need it?                                   |
| `security_safety`            | Does it avoid vulnerabilities, leaked secrets, and unsafe handling of untrusted input?       |

The review **fails** when any single criterion scores at or below
`FAILING_SCORE_THRESHOLD` (currently `4`). Deliberately a floor, not an average —
averaging lets a 1 on `security_safety` hide behind five 9s.

| Flag               | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `--title <string>` | Pull request title. Required.                                             |
| `--diff <path\|->` | Unified diff to review; `-` reads stdin. Required.                        |
| `--body <path\|->` | Pull request description; `-` reads stdin. Omit when there is none.       |
| `--json`           | Emit the review plus the derived verdict as JSON on stdout, nothing else. |

The diff and body are read from files rather than argv: a real diff runs to tens
of kilobytes, which would hit `E2BIG`, and argv is world-readable in the process
table. Only one of the two can read stdin.

> **`--json` must not be run through `npm start`.** npm writes its own two-line
> banner to **stdout**, ahead of the review, so the document no longer parses.
> Anything consuming `--json` — CI included — must invoke the CLI directly:
>
> ```bash
> # locally, where the key lives in .env:
> npx tsx --env-file-if-exists=.env src/cli.ts --json --title "$T" --diff /tmp/pr.diff
>
> # in CI, where OPENROUTER_API_KEY is already in the environment:
> npx tsx src/cli.ts --json --title "$T" --diff /tmp/pr.diff
> ```
>
> `npm start` is fine for human mode, where the banner is merely noise. Note that
> it is also what supplies `--env-file-if-exists=.env`, so a direct invocation
> needs that flag itself unless the key is already exported.

```bash
gh pr diff 42 > /tmp/pr.diff
gh pr view 42 --json body -q .body > /tmp/pr.md
npm start -- --title "$(gh pr view 42 --json title -q .title)" \
             --diff /tmp/pr.diff --body /tmp/pr.md --json
```

Exit codes are contract — CI branches on them:

| Code | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| `0`  | Every criterion is above the floor.                                                    |
| `1`  | The review ran and returned a failing verdict.                                         |
| `2`  | Usage error: bad arguments, an unreadable input file, or an empty diff. No model call. |
| `3`  | The reviewer itself failed — bad key, unreachable provider, unparseable model output.  |

`1` and `3` are distinct on purpose: a broken reviewer must not be able to
masquerade as a failed review and label every pull request red.

## Using it as a library

`reviewCode()` is the one-call path — it resolves the model from the environment
and returns the parsed review:

```ts
import { deriveVerdict, reviewCode } from "@zero-waste-chef/code-reviewer";

const { review, usage, modelId } = await reviewCode({
  input: {
    title: "Add rate limiting to the recipe endpoint",
    description: prBody, // `null` when the pull request has no body
    diff,
  },
});

const { passed, failing } = deriveVerdict(review.criteria);
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
  prompt: buildReviewPrompt({ title, description: null, diff }),
});
```

`buildReviewPrompt` reproduces the diff **verbatim** — it adds no line numbering,
because the diff's own `@@` hunk headers are the only positional scheme present
and a second one would mis-anchor every issue. That is also why an issue carries
a `quote` rather than a `line`. Title, description and diff each sit inside a
named `⟦ai-cr:untrusted⟧` fence, and `REVIEW_INSTRUCTIONS` tells the model that
fenced content is data to review, never instructions to follow — an instruction
found in there is itself a `security_safety` finding.

## Evaluating the reviewer

`npm run eval` runs the reviewer — the real prompt, the real schema, the real agent — across three
OpenRouter models against one fixture, and reports which model found which defect.

```bash
cd packages/code-reviewer
npm run eval          # ~2 min, ~$0.06 of tokens
npm run eval:view     # the three-column comparison in a browser
```

**What it measures.** One dense React 16 → React 19 migration diff carrying exactly three planted
defects — one each under `implementation_correctness` (a refetch effect with empty dependencies),
`idiomaticity` (`defaultProps` on a function component, which React 19 removed), and
`security_safety` (a user-supplied note rendered as raw HTML). The rest of the diff is a correct
migration, so a model has to discriminate rather than flag everything. Each model's review is
graded six ways: three deterministic checks (the verdict must fail, the output must satisfy
`reviewResultSchema`, and every issue's `quote` must actually occur in the diff) and three
`llm-rubric` assertions, one per planted defect, so the results grid reads as _which model missed
which flaw_.

**The three models** are the package default `anthropic/claude-sonnet-5` — the incumbent, and what
CI reviews pull requests with today — plus `z-ai/glm-5.1` and `deepseek/deepseek-v4-flash` as
challengers. The prompt is identical across all three; the model is the only variable. Swapping the
matrix is a `config.model` edit in `evals/promptfooconfig.yaml`, because
`createProviderContext(env)` already takes an `Env` override — no source change is involved.

**The judge** is `openrouter:x-ai/grok-4.6`, deliberately none of the three subjects: a judge
ranking its own family is textbook self-preference bias. It must be set explicitly —
promptfoo defaults `llm-rubric` to an OpenAI model this repo has no key for.

> ⚠ **`evals/fixtures/README.md` is the answer key.** It must never be added to a test case's
> `vars`, or to anything `vars` loads — `vars` is what the reviewer is shown. A leak turns the
> recall test into a reading-comprehension test that keeps passing while measuring nothing. The
> answer key legitimately reaches one place only: the `llm-rubric` values in
> `evals/promptfooconfig.yaml`, which the judge reads and the reviewer never does.

Two things about running it:

- **Node ≥ 22.22 is required** (promptfoo's own floor, and this package's `engines.node`). `nvm use`
  picks it up from `.nvmrc`.
- **A failed eval exits `1`, not promptfoo's default `100`.** The `eval` script sets
  `PROMPTFOO_FAILED_TEST_EXIT_CODE=1` so it matches every other script here. It also sets
  `PROMPTFOO_DISABLE_TEMPLATING=true`: a diff fixture is arbitrary source code, and this one
  contains JSX braces that nunjucks would try to evaluate as a template expression.

`evals/results.md` records the first real run — per-model scores, which defects each model found,
and what the comparison says. It is the point of the exercise; the config is just what produces it.

## Layout

| File                         | Role                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `src/index.ts`               | Public re-exports only — importing it has no side effects            |
| `src/cli.ts`                 | argv parsing, diff/body reads, `--json` and human output, exit codes |
| `src/agents/reviews.ts`      | `createReviewAgent()` factory + the `reviewCode()` wrapper           |
| `src/prompts/reviews.ts`     | `REVIEW_INSTRUCTIONS` (the rubric) + `buildReviewPrompt()`           |
| `src/schemas/reviews.ts`     | the rubric schema, `ReviewInputDiff`, and `deriveVerdict()`          |
| `src/env.config.ts`          | zod-validated environment, with readable failure messages            |
| `src/openrouter.provider.ts` | Single place where the provider and default model are built          |
| `evals/promptfooconfig.yaml` | The eval: three models, six assertions, and the judge                |
| `evals/reviewer.provider.ts` | Bridges promptfoo's `ApiProvider` to `createReviewAgent()`           |
| `evals/assertions/`          | The three deterministic checks, each with its own test               |
| `evals/fixtures/`            | The migration diff, its PR metadata, and the answer key              |
| `evals/results.md`           | What the first real run found                                        |

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
  is deliberate: it reads nothing but the diff it is handed, so an eval run is
  reproducible and costs exactly one model call. `stopWhen` is left at the SDK
  default (`isStepCount(20)`), so giving the agent tools later is a change to
  `createReviewAgent()` alone — no call site moves.
- `src/prompts/reviews.ts` is the seam for prompt variants; pass the variant as
  `instructions` to `createReviewAgent()` rather than editing the default.
- Model ids change often. List current ones with
  `curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id'`.
