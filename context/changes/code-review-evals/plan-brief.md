# promptfoo Evals for the Code Reviewer — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

`packages/code-reviewer` scores pull request diffs with an LLM, and nothing currently measures whether it is any good — or whether a cheaper model would do the same job. This change introduces promptfoo as a local eval harness that runs the package's one review prompt across three OpenRouter models against a deliberately flawed React 16 → 19 migration diff, and grades each result on whether it found the planted defects.

The package was built for exactly this: `context/changes/tool-loop-agent/plan-brief.md:9` names "the promptfoo evals planned as a follow-up" as the _driver_ for the whole agent refactor, and defers precisely this scope.

## Starting Point

Every seam an eval needs already exists and is test-pinned — `createReviewAgent({model, instructions, temperature})`, lazy model resolution so an injected model never reads the API key, and `deriveVerdict()` as a pure function. Research confirmed promptfoo's provider contract maps almost 1:1 onto it, with a live end-to-end probe. Planning added one finding: `createProviderContext(env)` already accepts an `Env` override, so the three-model matrix needs **no source change at all**.

What's missing is everything outside `src/`: promptfoo isn't installed, the repo's Node pin (`22.14.0`) sits below promptfoo's `>=22.22.0` floor, and the package's typecheck/lint/test gates are all scoped to `src/**`, so a new `evals/` directory would be invisible to them.

## Desired End State

`npm run eval` in `packages/code-reviewer` runs 3 models × 6 assertions over one fixture, prints a comparison table showing which model missed which defect, and exits non-zero on a miss. `npm run eval:view` opens the browser comparison UI. Lint, typecheck and tests cover `evals/`; `npm run build` still ships only `src/`. A recorded first run lands in `evals/results.md` as the change's actual knowledge deliverable.

## Key Decisions Made

| Decision           | Choice                                        | Why (1 sentence)                                                                                                                                                     | Source   |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Eval tool          | promptfoo                                     | Built-in `openrouter:` provider reuses the existing key, and the model matrix is what the change exists to produce.                                                  | Research |
| Architecture       | promptfoo CLI + config + custom TS provider   | Gets the matrix, `llm-rubric`, `--repeat` and the comparison UI for free; validated by a live probe.                                                                 | Research |
| Node floor         | Bump repo to `22.23.2`                        | Three lines, one Node everywhere; `22.14` was already behind on patches, and CI's `app` job floats to latest 22 anyway.                                              | Plan     |
| Eval location      | `evals/` sibling of `src/`, configs extended  | A provider is a peer of `src/cli.ts`, not a layer above it; keeps `dist/` clean.                                                                                     | Plan     |
| Typecheck approach | Separate `tsconfig.evals.json`                | `rootDir: "src"` makes the obvious `include` edit fail with TS6059 — a separate `noEmit` project is required.                                                        | Plan     |
| Where it runs      | Local, on demand                              | Avoids stacking a second nondeterministic AI gate on the existing AI review gate; matches the calibration precedent.                                                 | Plan     |
| Judge model        | `x-ai/grok-4.6`                               | Neutral to all three subjects (no self-preference bias in a ranking), stable non-preview id, and the only strong candidate supporting both `temperature` and `seed`. | Plan     |
| Fixture            | Synthetic, repo-flavoured                     | Real components carry incidental issues that muddy whether the model found the _planted_ three.                                                                      | Plan     |
| Flaw spread        | One each: correctness, idiomaticity, security | Exercises three rubric criteria and proves the verdict's floor logic on more than one axis.                                                                          | Plan     |
| Static assertions  | Verdict + schema + quote-anchoring            | Catches wrong verdict, malformed output from weaker models, and hallucinated locators — three distinct failure modes, all free.                                      | Plan     |
| Judge granularity  | Three per-defect rubrics, not one aggregate   | The results grid then reads directly as _which model missed which flaw_.                                                                                             | Plan     |

## Scope

**In scope:** promptfoo install + Node bump; `tsconfig.evals.json`, eslint and vitest coverage for `evals/`; the provider adapter and its offline unit test; one React 16→19 fixture with three planted flaws plus an isolated answer key; `promptfooconfig.yaml` with the three-model matrix, three static assertions and three judge rubrics; npm scripts, README section, and a recorded first run.

**Out of scope:** any change to `src/` (prompt, schema, agent all untouched); CI integration; prompt-variant A/B; regression assertions against `calibration.md`; additional fixtures; red-teaming; a precision/false-positive gate; porting the 45-defect corpus from `test/code-review-fixtures`.

## Architecture / Approach

promptfoo owns the runner, matrix and reporting. We own one adapter file that bridges `ApiProvider.callApi()` to `createReviewAgent()`, plus the fixture.

```
promptfooconfig.yaml
  ├─ providers ×3 ──→ reviewer.provider.ts ──→ createReviewAgent({ model })
  │                     (model id from config)      └─→ output: review + deriveVerdict()
  ├─ vars: diff ────→ file://fixtures/react19-migration.diff   ← reviewer sees this
  └─ assert ×6
       ├─ 3 static  ──→ file://assertions/*.assert.ts   (free, deterministic)
       └─ 3 rubrics ──→ judge: openrouter:x-ai/grok-4.6 ← answer key lives here only
```

The provider returns the review **plus its derived verdict** as a structured object; promptfoo passes structured output to assertions untouched, so `output.verdict.passed` is directly addressable with no parsing step.

## Phases at a Glance

| Phase                             | What it delivers                                                         | Key risk                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1. Toolchain & gates              | Node bump, promptfoo installed, `evals/` typechecked + linted + testable | The `rootDir: "src"` trap — the obvious tsconfig edit fails with TS6059                                                   |
| 2. Provider adapter               | `reviewer.provider.ts` + an offline unit test needing no API key         | Error path must return `{error}`, not throw, or one bad model aborts the whole matrix                                     |
| 3. Fixture & answer key           | The migration diff with exactly three planted flaws                      | A fourth accidental flaw, or a flaw 2 too obvious to discriminate — this phase decides whether the eval measures anything |
| 4. Config, assertions, run & docs | The matrix, six assertions, a real run, `results.md`                     | Judge defaults to `gpt-5` if not overridden; answer-key leakage into `vars`                                               |

**Prerequisites:** `OPENROUTER_API_KEY` in `packages/code-reviewer/.env`; Node ≥ 22.22 available via nvm; willingness to spend ~$0.06 per eval pass.

**Estimated effort:** ~2 sessions across 4 phases. Phase 3 (authoring the fixture) is the bulk of the work; phases 1, 2 and 4 are mostly mechanical.

## Open Risks & Assumptions

- **The fixture is the whole experiment.** If all three models find all three flaws, the eval discriminates nothing and flaw 2 needs sharpening. Phase 4's manual criteria treat this as a failure condition, not a success.
- **The incumbent is the least deterministic arm.** OpenRouter reports `anthropic/claude-sonnet-5` as supporting neither `temperature` nor `seed`, so the package's own `temperature: 0` is aspirational there. Mitigated by using bands and booleans rather than exact scores, and by running twice before recording results.
- **Judge choice is itself unvalidated.** Grok 4.6 is neutral, but nothing here proves it grades well. The plan does not gate on judge agreement; a human reads the `reason` strings in Phase 4.
- **839 packages** enter the dev tree of a package that currently has 13 dependencies. Dev-only and local-only, but a real supply-chain surface.
- **The Node bump reaches beyond this package** — the Astro app, Playwright and Wrangler all move with `.nvmrc`. It is a patch-level move inside the same LTS line, and CI's `app` job already floats to latest 22, so the bump narrows an existing gap rather than opening one.

## Success Criteria (Summary)

- `npm run eval` produces a three-column comparison in which **every** model fails the fixture, and **at least one** model misses at least one defect.
- The three static assertions pass on all three models, proving the reviewer returns a well-formed, correctly-anchored, correctly-failing review.
- The answer key never appears in the reviewer's input — verifiable by grepping the output JSON.
