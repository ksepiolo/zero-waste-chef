# ToolLoopAgent Code Reviewer — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Rebuild `@zero-waste-chef/code-reviewer` around the AI SDK's `ToolLoopAgent`, with structured-output
schemas and prompts extracted into their own modules. The driver is reuse: today the package cannot
be imported without executing its CLI, which blocks the promptfoo evals planned as a follow-up.

## Starting Point

The package is already more modular than the request assumed — schemas live in `review.schema.ts`
and the review call in `review.service.ts`. The real problems are narrower: `src/index.ts:22-83`
mixes public re-exports with a CLI whose direct-run guard fires at import time and which statically
pulls in `node:fs/promises`, `node:path`, and `node:process`; prompts are inline constants in the
service (`review.service.ts:6-11,66-84`); the review is a single `generateText` call with no agent;
the package has no tests, and the root `vitest.config.ts` excludes `packages/` entirely.

## Desired End State

Importing the package yields only functions and types — no stdout, no env reads, no filesystem
access, and no API key required. `createReviewAgent()` hands back a configured `ToolLoopAgent` with
an injectable model; `reviewCode()` keeps its exact current signature on top of it. The CLI lives in
its own `src/cli.ts` and behaves precisely as it does today.

## Key Decisions Made

| Decision        | Choice                                                                                         | Why (1 sentence)                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent tools     | None — hermetic agent                                                                          | Keeps the reviewer deterministic and fixture-free so promptfoo assertions are trustworthy; `ToolLoopAgent` is adopted for encapsulation and as a ready seam. |
| Input model     | Content inlined by caller                                                                      | No discovery means the eval fixture fully controls what gets reviewed.                                                                                       |
| Export shape    | Factory + thin wrapper                                                                         | `createReviewAgent()` lets evals inject their own model with no env dependency, while `reviewCode()` keeps the CLI and README working.                       |
| Module layout   | `src/schemas/reviews.ts`, `src/prompts/reviews.ts`, `src/agents/reviews.ts`, flat `src/cli.ts` | User-specified directory-per-concern; the CLI stays flat because splitting it out of `index.ts` is what unblocks import.                                     |
| Prompt variants | Exported defaults + factory override                                                           | Enables prompt A/B in evals without building a registry before the variants are known.                                                                       |
| Back-compat     | `reviewCode()` signature preserved                                                             | Makes this a pure internal refactor from any caller's point of view.                                                                                         |
| Tests           | Package-local vitest, pure units only                                                          | The injectable model plus `MockLanguageModelV4` from `ai/test` makes hermetic tests nearly free.                                                             |
| Determinism     | `temperature: 0` by default, overridable                                                       | Stops repeated eval runs from drifting, so a failing assertion means the prompt changed rather than the sampling.                                            |

## Scope

**In scope:**

- Extract schemas to `src/schemas/reviews.ts` and prompts to `src/prompts/reviews.ts`
- New `src/agents/reviews.ts` with `createReviewAgent()` + `reviewCode()`
- Split the CLI into `src/cli.ts`; reduce `index.ts` to re-exports
- Package-local vitest with prompt, schema, and agent unit tests
- README and package-script updates

**Out of scope:**

- Any promptfoo configuration, provider adapter, fixtures, or eval scripts
- Adding tools (filesystem, git, network) to the agent
- Changing the output schema, severity scale, or CLI output format
- Wiring the package into the repo-root test run
- Changes to `env.config.ts` or `openrouter.provider.ts`

## Architecture / Approach

`cli.ts` reads files and calls `reviewCode()`, which builds a `ToolLoopAgent` via
`createReviewAgent()` and invokes `agent.generate()`. The agent composes three injectable pieces:
the model (defaulting to `createProviderContext()`, resolved lazily inside the factory so no
env read happens at import), the instructions from `src/prompts/reviews.ts`, and
`Output.object({ schema })` from `src/schemas/reviews.ts`. A future promptfoo provider enters at the
same seam as the CLI — `createReviewAgent()` — substituting its own model and prompt variant.

## Phases at a Glance

| Phase                        | What it delivers                              | Key risk                                                                              |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. CLI / library split       | `cli.ts`; `index.ts` becomes pure re-exports  | Direct-run guard or script paths break the CLI entry point                            |
| 2. Extract schemas & prompts | New `schemas/` and `prompts/` modules         | Prompt text drifts during the move, silently changing model behaviour                 |
| 3. Test harness              | Package vitest + prompt/schema contract tests | Test files leaking into `dist/` via `tsc`                                             |
| 4. ToolLoopAgent conversion  | `agents/reviews.ts`, agent tests, README      | Declaration emit on the inferred agent generic; behaviour shift from `temperature: 0` |

**Prerequisites:** `npm install` in `packages/code-reviewer`; an `OPENROUTER_API_KEY` in `.env` for
manual CLI verification only (all automated checks run without one).
**Estimated effort:** ~1-2 sessions across 4 phases; phases 1-3 are mechanical.

## Open Risks & Assumptions

- The tool loop will not actually iterate — a deliberate trade for hermetic evals. Adding tools
  later changes the factory only, not any call site.
- Directory naming (`schemas/reviews.ts`) departs from the repo-wide `feature.schema.ts` convention
  in `CLAUDE.md`. Chosen deliberately; recorded so it is not "corrected" back.
- `temperature: 0` is a real behaviour change and may narrow the findings surfaced; Phase 4 manual
  verification checks quality against the pre-change reviewer on the same file.

## Success Criteria (Summary)

- Importing the package with no `OPENROUTER_API_KEY` set neither throws nor writes output
- `npm start -- <file>` behaves exactly as before, including exit codes 0/1/2
- `createReviewAgent()` can be driven with an injected mock model, no network and no credentials
