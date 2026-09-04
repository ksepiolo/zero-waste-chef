---
date: 2026-09-03T17:52:00Z
researcher: Kasia Sepiolo
git_commit: 9d30bd10dad301f3c90004f2b6881f8ed523303e
branch: feature/code-review-evals
repository: ksepiolo/zero-waste-chef
topic: "Introducing promptfoo for eval of the code-reviewer agent"
tags: [research, codebase, code-reviewer, promptfoo, evals, ai-sdk, openrouter]
status: complete
last_updated: 2026-09-03
last_updated_by: Kasia Sepiolo
---

# Research: Introducing promptfoo for eval of the code-reviewer agent

**Date**: 2026-09-03 17:52 UTC
**Researcher**: Kasia Sepiolo
**Git Commit**: `9d30bd10dad301f3c90004f2b6881f8ed523303e` (pushed; on `origin/feature/code-review-evals`)
**Branch**: `feature/code-review-evals`
**Repository**: `ksepiolo/zero-waste-chef`

> GitHub permalinks in this document take the form
> `https://github.com/ksepiolo/zero-waste-chef/blob/9d30bd10dad301f3c90004f2b6881f8ed523303e/<path>#L<line>`

## Research Question

Analyze the current state of `packages/code-reviewer` in the context of potential eval
introduction — reusability of prompts, importability of the agent. promptfoo is the first
pick; confirm the stack aligns with it, otherwise analyze other OSS options.

## Summary

**Verdict: go with promptfoo.** The fit is not merely plausible — it is verified. I installed
`promptfoo@0.122.2` in a scratch project and ran a working end-to-end probe of the exact
integration shape this package needs (§2.3). Every load-bearing assumption held.

Three things make this an unusually clean adoption:

1. **The package was designed for this change.** `context/changes/tool-loop-agent/plan-brief.md:9`
   names "the promptfoo evals planned as a follow-up" as the _driver_ for the whole ToolLoopAgent
   refactor, and its Out-of-scope list defers precisely what this change now owes. Every seam an
   eval needs — injectable model, injectable prompt, pure verdict function, side-effect-free
   imports — already exists and is covered by tests.
2. **promptfoo's provider contract maps almost 1:1 onto `reviewCode()`.** A custom provider's
   `callApi(prompt, context)` receives `context.vars`; returning the zod-validated review object
   as `output` makes `output.criteria.implementation_correctness.score` directly addressable in
   assertions with no serialization step.
3. **A labelled dataset already exists in the repo's history** — seven scored real PRs in
   `context/changes/ci-cd-code-review/calibration.md`, plus a 45-defect answer-key corpus on the
   `test/code-review-fixtures` branch.

**Two real blockers, neither fatal**, both needing a decision in the plan:

- **Node version.** `promptfoo@0.122.2` declares `engines.node >= 22.22.0`. The repo pins
  `22.14.0` in `.nvmrc` and `node-version: "22.14"` in both CI jobs. Even the last `0.121.x`
  requires `^20.20.0 || >=22.22.0`. `engine-strict` is `false`, so npm warns rather than fails —
  but CI would be running promptfoo on an unsupported runtime. (§3.1)
- **Tooling scope.** `tsconfig.json` sets `rootDir: "src"` with `include: ["src/**/*.ts"]`, and
  both `eslint.config.js` and the `lint` script cover `src/**` only. An `evals/` directory at
  package root would be silently untypechecked and unlinted. (§3.2)

Alternatives were surveyed (§6). **Evalite** is the one genuinely competitive option and is a
better _theoretical_ fit for typed structured output — but promptfoo wins here on the specifics
this change actually needs: a built-in `openrouter:` provider (so the judge reuses the
`OPENROUTER_API_KEY` already in CI secrets), a first-class model-comparison matrix, and
`file://` loading for large diff fixtures. No alternative is compelling enough to override the
stated first pick.

## Detailed Findings

### 1. The package is already eval-ready

This is the strongest finding: essentially no refactoring is required.

| Seam                                                         | Location                                          | Why it matters for an eval                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `createReviewAgent({ model?, instructions?, temperature? })` | `packages/code-reviewer/src/agents/reviews.ts:54` | Injectable model **and** prompt variant. Every option optional.                                |
| `reviewCode({ input, model?, abortSignal? })`                | `src/agents/reviews.ts:72`                        | One-call path; `input` is `{title, description, diff}` — exactly a promptfoo test case's vars. |
| `buildReviewPrompt(input)`                                   | `src/prompts/reviews.ts:68`                       | Pure string builder, no I/O.                                                                   |
| `REVIEW_INSTRUCTIONS`                                        | `src/prompts/reviews.ts:29`                       | The rubric as a plain exported constant — the A/B seam.                                        |
| `deriveVerdict(criteria)`                                    | `src/schemas/reviews.ts:129`                      | Pure function. An assertion can call it directly.                                              |
| `reviewResultSchema`                                         | `src/schemas/reviews.ts:93`                       | `strictObject`, so a malformed model response throws rather than silently degrading.           |

All of it is re-exported from `src/index.ts`, which documents itself as side-effect-free:
"Importing this module has no side effects: it reads no environment, touches no filesystem, and
writes nothing" (`src/index.ts:4-6`). The CLI is deliberately _not_ re-exported.

**Lazy provider resolution is the key property.** `resolveModel()` (`src/agents/reviews.ts:90`)
only calls `createProviderContext()` when no model override is passed, so an eval that injects
its own model never touches `OPENROUTER_API_KEY`. This is pinned by an existing test:

```
src/agents/reviews.test.ts:189  "is lazy: importing the module without credentials
                                 neither throws nor reads env"
```

which asserts both that `createReviewAgent()` throws on a missing key _and_ that
`createReviewAgent({ model: mockModel() })` does not — commented in-source as "this is the eval
path" (`reviews.test.ts:198`).

The existing tests already exercise the prompt-variant seam the plan needs
(`reviews.test.ts:99`, "lets an eval swap in a prompt variant via instructions") and the
temperature seam (`reviews.test.ts:83`). The agent carries a stable `id` of `"code-reviewer"`
explicitly "so eval telemetry can attribute runs" (`src/agents/reviews.ts:20`, asserted at
`reviews.test.ts:116`).

### 2. promptfoo fit — verified, not assumed

#### 2.1 Version and API surface (verified by install)

`promptfoo@0.122.2`, published 2026-08-28, MIT. Installing it pulls **839 packages** (~30.6 MB
unpacked) — heavy next to this package's current 6 runtime + 7 dev dependencies. Worth a
conscious decision, not a footnote.

Confirmed exported at runtime (`import('promptfoo')`):

```
evaluate            function     loadApiProvider     function
assertions          object       loadApiProviders    function
```

and `assertions` exposes `runAssertion`, `runAssertions`, `matchesLlmRubric`,
`matchesFactuality`, `matchesClosedQa`, `matchesAnswerRelevance`, `matchesModeration`, and more.
Types `ApiProvider`, `ProviderOptions`, `ProviderResponse`, `CallApiContextParams`,
`UnifiedConfig`, `TestCase`, `EvaluateTestSuite` are all exported.

**`matchesLlmRubric` being directly callable matters**: the LLM-as-judge the plan calls for can
be invoked from a plain vitest test, without adopting promptfoo's runner at all. That is a real
third architecture option (§7).

#### 2.2 OpenRouter is a built-in provider

Verified by loading it:

```
loadApiProvider('openrouter:z-ai/glm-5.1')
  → id():  openrouter:z-ai/glm-5.1
  → ctor:  OpenRouterProvider
```

So the LLM-as-judge can run through OpenRouter using the **same `OPENROUTER_API_KEY` already
wired into CI** (`.github/workflows/ai-code-review.yml:55`). No second provider account, no new
secret. This is the single biggest practical advantage over the alternatives.

#### 2.3 End-to-end probe — the integration shape works

Rather than trust the docs, I built the actual shape and ran it. A `.ts` custom provider
returning a **structured object**, with a `file://`-loaded diff var and assertions reading
nested score fields:

```typescript
// fake-review.provider.ts — the shape a real provider would take
import type { ApiProvider, ProviderOptions, ProviderResponse, CallApiContextParams } from "promptfoo";

export default class FakeReviewProvider implements ApiProvider {
  private providerId: string;
  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? "fake-reviewer";
  }
  id(): string {
    return this.providerId;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const diff = String(context?.vars?.diff ?? "");
    /* ... build the review ... */
    return { output: { summary, criteria, verdict }, tokenUsage: { total: 30, prompt: 10, completion: 20 } };
  }
}
```

```yaml
providers: [file://fake-review.provider.ts]
tests:
  - vars:
      title: "Call risky() on startup"
      diff: file://buggy.diff # loaded from disk, not inlined
    assert:
      - type: javascript
        value: "typeof output === 'object' && output !== null"
      - type: javascript
        value: "output.criteria.implementation_correctness.score <= 4"
      - type: javascript
        value: "output.verdict.passed === false"
```

**Result: `✓ 1 passed (100%)`.** Every claim below is therefore verified, not inferred:

- A **`.ts` provider file loads directly** — no compile step, no `NODE_OPTIONS=--import tsx`.
- **Structured object output passes through to assertions untouched.** No `is-json`, no
  `JSON.parse`. `output.criteria.<key>.score` is directly addressable.
- **`file://` var loading works for the diff.** (Proven by inference: had the file not loaded,
  the var would be the literal string `file://buggy.diff`, the fixture's `risky()` marker would
  be absent, the score would be 8, and the `<= 4` assertion would have failed. It passed.)
- **`tokenUsage` maps cleanly**, so cost telemetry survives.

Flipping one assertion to force a failure confirmed the CI contract:

```
EXIT=100        stats: 0 pass / 1 fail        (-o out.json written correctly)
```

**Exit code 100 on assertion failure** — not 1. Any CI wiring must branch on 100, or remap it
via `PROMPTFOO_FAILED_TEST_EXIT_CODE`. This matters because the repo's existing action already
treats exit codes as contract (`.github/actions/ai-code-review/action.yml:99-107`).

#### 2.4 Correction: promptfoo ships its own `tsx`

Research initially suggested `tsx` must be resolvable in the consuming project. **This is not
so.** `npm view promptfoo dependencies.tsx` → `^4.23.11` — it is a direct _runtime dependency_.
My probe project declared only `promptfoo` and had no `tsx` of its own, yet the `.ts` provider
loaded. The historical `Cannot find module 'tsx/cjs'` breakage (promptfoo ~0.103.17) does not
apply to current versions. Convenient either way: this package already carries
`tsx@^4.23.13` (`packages/code-reviewer/package.json:38`).

### 3. Blockers and friction

#### 3.1 Node engine floor — the one real blocker

| Source                             | Node                                          |
| ---------------------------------- | --------------------------------------------- |
| `promptfoo@0.122.2`                | `>= 22.22.0`                                  |
| `promptfoo@0.121.20`               | `^20.20.0 \|\| >= 22.22.0`                    |
| `promptfoo@0.120.0` and earlier    | `>= 20.0.0`                                   |
| **`.nvmrc`**                       | **`22.14.0`**                                 |
| **`ci.yml` reviewer job**          | **`node-version: "22.14"`** (`ci.yml:47`)     |
| **`action.yml`**                   | **`node-version: "22.14"`** (`action.yml:54`) |
| `packages/code-reviewer` `engines` | `>= 22.9.0`                                   |
| Developer's local machine          | `v24.15.0`                                    |

`22.14.0` satisfies neither branch of the current constraint. `engine-strict` is `false`
(verified via `npm config get engine-strict`), so `npm ci` emits `EBADENGINE` as a **warning**
and proceeds — but CI would knowingly run promptfoo on an unsupported runtime.

Options for the plan: bump `.nvmrc` + both workflow pins to `22.22.x` (or 24); or pin promptfoo
to `<= 0.120.0` and accept an aging tool; or run evals only on a separate job with its own Node
version. The first is cleanest and touches three lines, but `.nvmrc` is repo-wide and the Astro
app would move with it.

#### 3.2 Eval code would fall outside every existing gate

`packages/code-reviewer/tsconfig.json:9,27` sets `rootDir: "src"` and `include: ["src/**/*.ts"]`.
`eslint.config.js:14` scopes to `files: ["src/**/*.ts"]`, and the script is `eslint src`
(`package.json:26`). So:

- An `evals/` directory at package root is **neither typechecked nor linted**.
- Putting evals under `src/evals/` fixes both, but `tsc -p tsconfig.build.json` would then emit
  them into `dist/` — the build config only excludes `src/**/*.test.ts`
  (`tsconfig.build.json:6`). It would need a matching exclusion, exactly as was done for tests.

There is precedent for the second approach: `tsconfig.build.json` exists _solely_ because test
files needed excluding from emit. The plan should decide deliberately rather than inherit a
silent gap.

#### 3.3 `temperature: 0` may not hold on the default model

The agent pins `temperature: 0` and documents it as "Reviews must not drift between runs over
the same source" (`src/agents/reviews.ts:22-23`). Querying OpenRouter's live model list:

| Model                                     | `temperature` in `supported_parameters`? | `structured_outputs`? |
| ----------------------------------------- | ---------------------------------------- | --------------------- |
| `anthropic/claude-sonnet-5` (the default) | **No**                                   | Yes                   |
| `z-ai/glm-5.1`                            | Yes                                      | Yes                   |
| `deepseek/deepseek-v4-flash`              | Yes                                      | Yes                   |

The two challenger models also support `seed`; Sonnet 5 does not. So the determinism the eval's
assertion stability rests on is **weakest on the package's own default model** — a run-to-run
score wobble on Sonnet would look like a prompt regression. The plan should either use
`--repeat` to measure variance rather than assume it away, or set assertion thresholds as bands
(`score <= 4`) rather than exact equality. The existing fixtures already lean this way.

_Flagged, not proven:_ I did not make a live call to confirm OpenRouter silently drops the
unsupported `temperature` rather than erroring. Worth one cheap call during implementation.

#### 3.4 No first-party eval story in the AI SDK

Grepping the version-matched docs shipped at `packages/code-reviewer/node_modules/ai/docs/`
(the README instructs reading these rather than relying on remembered APIs,
`README.md:166-168`) returns **zero** matches for `promptfoo`, `evalite`, `braintrust`,
`autoevals`, or `LLM-as-a-judge`. `ai` v7 offers no eval tooling and no documented recipe. All
integration glue is ours to own.

### 4. Models and cost — live OpenRouter data

All three models named in the lesson prompt exist today and **all advertise `structured_outputs`
and `response_format`**, so `Output.object({ schema })` should hold across the matrix:

| Model                        | Context   | $/M input | $/M output |
| ---------------------------- | --------- | --------- | ---------- |
| `anthropic/claude-sonnet-5`  | 1,000,000 | $2.00     | $10.00     |
| `z-ai/glm-5.1`               | 204,800   | $0.97     | $3.04      |
| `deepseek/deepseek-v4-flash` | 1,048,576 | $0.082    | $0.165     |

For a ~9k-token prompt and ~2k-token review, one pass over all three models costs roughly
**$0.055**, plus judge calls. Even at `--repeat 5` this is pocket change — cost is not a
constraint on eval design here.

One mitigation worth knowing: the OpenRouter provider supports a **Response Healing plugin**
that repairs malformed structured output
(`node_modules/@openrouter/ai-sdk-provider/README.md:325-327`), passed via `extraBody` or
model settings. Relevant because the weaker challenger models are the likeliest to trip
`Output.object` parsing — and a parse failure currently surfaces as a reviewer _error_
(exit 3), not a low score.

### 5. A dataset already exists in the repo

The plan calls for authoring one React 16→19 migration fixture with three planted flaws. Two
existing assets should inform it:

**`context/changes/ci-cd-code-review/calibration.md`** — seven scored real pull requests:

| PR  | verdict | correctness | idiom. | complexity | test/risk | docs | security |
| --- | ------- | ----------: | -----: | ---------: | --------: | ---: | -------: |
| #23 | pass    |           7 |      8 |          8 |         7 |    9 |        9 |
| #24 | fail    |           8 |      7 |          8 |     **4** |    9 |        9 |
| #25 | pass    |           9 |      9 |          9 |         6 |   10 |        9 |
| #26 | pass    |           7 |      8 |          8 |         6 |    9 |        8 |
| #27 | fail    |           8 |      8 |          8 |     **4** |    9 |        9 |
| #28 | pass    |           8 |      9 |          9 |         6 |    8 |        9 |
| #30 | fail    |           1 |      2 |          2 |         1 |    2 |        1 |

PR #30 is the deliberately-flawed fixture (`test/ai-code-review-antipatterns`, still a live
branch) — it scores below the floor on all six and the doc records that the reviewer identified
every planted defect. **This is a ready-made regression baseline**: the eval should reproduce
these numbers within a band, and a drift is a real signal.

Two caveats the calibration doc itself records and the eval design must respect:

- `documentation` scores 8–10 everywhere because these PRs carry large `context/changes/`
  planning artifacts _inside the diff_, which the model reads as documentation. **The sample
  does not calibrate that criterion**; a code-only fixture would score very differently.
- `implementation_correctness` never drops below 7 on merged PRs — expected, since they were
  reviewed and merged. Discrimination has to come from planted-defect fixtures.

**`test/code-review-fixtures` branch** carries a five-file, 45-defect corpus with a full
ground-truth table and per-defect expected severities, plus a scoring rubric covering recall /
precision / anchoring / stability. It targets the **old file-based contract** (that branch still
has `src/review.service.ts`), so it cannot be used as-is against today's diff-based reviewer —
but its answer-key _method_ is directly reusable, and `04-recipe-list.fixture.tsx` is already a
React component with nine catalogued defects (stale effect deps, missing `AbortController`,
`key={index}`, `dangerouslySetInnerHTML`). That is close to the React fixture the plan wants.

Its README carries a warning worth carrying forward: **"Do not pass this README to the
reviewer. It is the answer key."** An eval fixture's expected-defect list must live outside
anything that reaches the model.

For seeding a plausible React 16→19 migration diff, the repo has real components to base it on —
`src/components/inventory/inventory-panel.tsx`, `src/components/recipes/recipe-history-panel.tsx`,
and `src/components/hooks/use-recipe-generation.ts` (React 19.2.6).

### 6. Alternatives considered

Surveyed because the brief asked for it, not because promptfoo looked weak.

| Tool                          | Verdict for this stack                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evalite** (MIT, `0.19.0`)   | The only serious contender. TS-native over `@vitest/runner@^4`; `createScorer<Input,Output,Expected>` generics carry a zod object through scoring more naturally than promptfoo's untyped `output`; `evalite.each()` is a first-class variant matrix. **But**: its `evalite/ai-sdk` tracing submodule is pinned to `@ai-sdk/provider@^2` (AI SDK **v5**) while `ai@7` needs v4 — that submodule is unusable here. The judge model must be wired by hand; there is no built-in OpenRouter provider. |
| **autoevals** (MIT)           | Scorer library, not a runner. Usable standalone without Braintrust. A companion to Evalite, not a competitor to promptfoo.                                                                                                                                                                                                                                                                                                                                                                         |
| **DeepEval TS** (Apache-2.0)  | Genuinely Vitest-native (`toPass()`), `GEval` judge with explicit OpenRouter support. Weakened by a string-first `LLMTestCase` API — six structured sub-scores mean stringifying or one metric per criterion. TS SDK is newer than the Python one.                                                                                                                                                                                                                                                 |
| **Langfuse / Phoenix / Opik** | All now have real TS SDKs and are self-hostable, but all want a running server. Disproportionate to "score PR diffs in CI" unless production tracing is also on the roadmap. Langfuse's headline "code evaluators" are sandboxed UI snippets, not a local-function hook.                                                                                                                                                                                                                           |
| **Inspect AI, Ragas**         | Python-only. Ruled out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **OpenAI Evals**              | Python-first OSS; the hosted platform is reportedly sunsetting late 2026. Ruled out.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`@ai-sdk-tool/eval`**       | Benchmarks raw `LanguageModel` instances, not your agent's output. Wrong abstraction.                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Vitest 4 itself**           | Ships nothing eval-shaped. Confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

_Attribution:_ §6 rests on delegated web research. The Evalite AI SDK v5 pinning and DeepEval's
OpenRouter support were reported as verified against source; the OpenAI Evals shutdown dates
were flagged by the researcher as single-source and unverified. None of it changes the
recommendation.

### 7. Three viable architectures

The plan must pick one. All three are supported; they differ in how much promptfoo owns.

**A. promptfoo CLI + config file** _(the conventional path)_
`promptfooconfig.yaml` (or `.ts`) + a `file://` custom provider wrapping `createReviewAgent()`.
Gets the model matrix, `llm-rubric`, `--repeat`, `promptfoo view`, JUnit/JSON output and the CI
recipe for free. Costs: a second test-runner concept in the package, and exit code 100.
_This is the shape my probe validated._

**B. promptfoo Node API in a `tsx` script**
`import { evaluate } from "promptfoo"` in `evals/run.ts`, run via `tsx` — consistent with how
the package already runs everything (`package.json:22-23`) and with `scripts/test-e2e.sh` at
the repo root. Sidesteps config discovery entirely; costs you the reporting glue.

**C. `assertions.matchesLlmRubric()` inside vitest** _(lightest)_
Since `assertions` is exported, the LLM-as-judge can be called from an ordinary
`*.test.ts` alongside the 32 existing tests, with no new runner at all. Loses the model matrix
and the comparison UI — the two things the lesson prompt actually asks for. Probably too light
for this change, but worth naming.

**Recommendation: A**, because the stated goal is comparing one prompt across three models, and
that matrix is precisely what promptfoo's config gives for free. Note that a promptfoo `prompts:`
entry is required even though the provider ignores it (the provider reads `context.vars`
directly) — a small awkwardness, visible in the probe config above.

## Code References

- `packages/code-reviewer/src/agents/reviews.ts:54` — `createReviewAgent()`, the injectable seam
- `packages/code-reviewer/src/agents/reviews.ts:72` — `reviewCode()`, maps 1:1 onto a provider's `callApi`
- `packages/code-reviewer/src/agents/reviews.ts:90` — `resolveModel()`, lazy provider resolution
- `packages/code-reviewer/src/agents/reviews.ts:22-23` — the `temperature: 0` determinism claim (see §3.3)
- `packages/code-reviewer/src/prompts/reviews.ts:29` — `REVIEW_INSTRUCTIONS`, the A/B seam
- `packages/code-reviewer/src/prompts/reviews.ts:68` — `buildReviewPrompt()`, pure
- `packages/code-reviewer/src/schemas/reviews.ts:93` — `reviewResultSchema` (`strictObject`)
- `packages/code-reviewer/src/schemas/reviews.ts:115` — `FAILING_SCORE_THRESHOLD = 4`
- `packages/code-reviewer/src/schemas/reviews.ts:129` — `deriveVerdict()`, callable from an assertion
- `packages/code-reviewer/src/index.ts:4-6` — the side-effect-free import contract
- `packages/code-reviewer/src/agents/reviews.test.ts:189-202` — the test that pins the eval path
- `packages/code-reviewer/tsconfig.json:9,27` — `rootDir` / `include`, the §3.2 boundary
- `packages/code-reviewer/tsconfig.build.json:6` — the test-exclusion precedent
- `packages/code-reviewer/eslint.config.js:14` — lint scoped to `src/**`
- `packages/code-reviewer/README.md:120-136` — the README already documents the eval-harness usage
- `.github/workflows/ci.yml:36-57` — the `reviewer-package` job an eval job would sit beside
- `.github/workflows/ci.yml:47` — `node-version: "22.14"` (§3.1)
- `.github/actions/ai-code-review/action.yml:99-107` — the existing exit-code contract
- `.nvmrc:1` — `22.14.0` (§3.1)

## Architecture Insights

- **The eval seam and the CLI seam are the same seam.** Both enter through
  `createReviewAgent()`. A promptfoo provider is architecturally a peer of `src/cli.ts`, not a
  layer above it — which argues for `evals/` as a sibling of `src/`, not a child.
- **The rubric lives in two places by design.** `REVIEW_INSTRUCTIONS` carries the 1-and-10
  anchors; the zod `.describe()` strings are _also_ prompt surface ("under `Output.object` the
  model reads them as field-level instructions", `src/schemas/reviews.ts:6-7`). A prompt-variant
  eval that swaps only `instructions` leaves half the prompt surface fixed. Worth being explicit
  about what a "prompt variant" means here.
- **The verdict is a floor, not an average** (`src/schemas/reviews.ts:126-128`) — deliberately,
  so a 1 on `security_safety` cannot hide behind five 9s. Eval assertions should test the floor
  behaviour, not just aggregate scores.
- **Issues carry `quote`, never `line`** — a diff has no trustworthy line numbering
  (`src/schemas/reviews.ts:32-36`). An eval checking "did it find the planted defect" must match
  on quoted text or file path, never a line number.
- **The package is deliberately outside the root toolchain** — its own lockfile, tsconfig,
  eslint config, and vitest config; the root `eslint .` ignores `packages/**`. Any eval tooling
  inherits that isolation, including its own `npm ci` in CI.
- **The `agents/` `prompts/` `schemas/` directory layout is a deliberate CLAUDE.md departure**,
  recorded so it is not "corrected" back (`README.md:158-160`), with the stated rationale that
  "each seam is a directory an eval can grow variants in". An `evals/` directory is consistent
  with that intent.

## Historical Context (from prior changes)

- `context/changes/tool-loop-agent/plan-brief.md:9` — the promptfoo eval is named as the
  **driver** for the ToolLoopAgent refactor: the package "cannot be imported without executing
  its CLI, which blocks the promptfoo evals planned as a follow-up".
- `context/changes/tool-loop-agent/plan-brief.md:52` — Out of scope: "Any promptfoo
  configuration, provider adapter, fixtures, or eval scripts". That deferral is exactly this
  change's scope.
- `context/changes/tool-loop-agent/plan-brief.md:28-38` — the decision table, where four of eight
  rows are justified by eval needs (hermetic agent, caller-inlined input, factory export shape,
  `temperature: 0`).
- `context/changes/tool-loop-agent/plan.md:445` — "Adopting `ToolLoopAgent` without tools is a
  deliberate trade for hermetic, deterministic evals."
- `context/changes/ci-cd-code-review/calibration.md` — the seven-PR labelled dataset (§5).
- `context/changes/ci-cd-code-review/research.md:579-580` — flags that the eval "will be written
  against whichever schema this change leaves behind". That schema is now settled.
- `context/changes/ci-cd-code-review/research.md` Open Question 10 — "Does the rubric replacement
  break the next lesson?" **Answered: no.** The six-criterion schema is stable and this research
  is written against it.
- `.claude/prompts/m5l3-promptfoo.md` — the lesson script driving this change. Its `/10x-plan`
  line specifies: three models, one complex React 16→19 migration diff with three impactful
  flaws, an LLM-as-judge verifying the review identifies them, plus a static assertion that the
  review actually fails.

## Related Research

- `context/changes/ci-cd-code-review/research.md` — the CI integration this eval sits beside;
  §3.1 there covers the root/package isolation problem in depth.
- `context/changes/tool-loop-agent/plan.md` — the design of the package being evaluated.
- `context/changes/tool-loop-agent/reviews/impl-review.md` — records nine findings from the
  reviewer's own implementation review, several about the eval surface.
- No prior `research.md` exists for eval tooling; this is the first.

## Open Questions

1. **Which Node bump?** (§3.1) Move `.nvmrc` and both workflow pins to 22.22+/24, pin promptfoo
   to `<= 0.120.0`, or isolate evals in a job with its own Node? The first is cleanest but moves
   the Astro app too.
2. **Where does eval code live?** (§3.2) `evals/` as a sibling of `src/` (untypechecked,
   unlinted unless configs are extended) or `src/evals/` (covered, but needs a
   `tsconfig.build.json` exclusion)?
3. **Does the eval run in CI at all, or locally on demand?** Cost is negligible (§4), but a
   model-matrix eval on every PR adds latency and a nondeterministic gate on top of the
   _existing_ nondeterministic AI review gate. The calibration precedent was to run locally.
4. **What is the judge model?** Using the same family as one of the subjects
   (`anthropic/claude-sonnet-5`) risks self-preference bias in a comparison whose whole point is
   ranking models. A neutral third model may be the better judge.
5. **What counts as a "prompt variant"?** (§Architecture) `instructions` alone, or the zod
   `.describe()` strings too — which are equally prompt surface but not injectable today.
6. **Is 839 packages acceptable** in a package that currently has 13 dependencies total? It is
   dev-only and CI-only, but it is a real supply-chain surface.
7. **Does the React 16→19 fixture get reviewed as a diff of real repo components** (adapting
   `inventory-panel.tsx`) or as a synthetic file? The former is more representative; the latter
   is easier to plant exactly three flaws in.
8. **Should the eval assert against the calibration baseline** (§5) as a regression check, given
   the documented caveat that `documentation` and `implementation_correctness` are not calibrated
   by that sample?
