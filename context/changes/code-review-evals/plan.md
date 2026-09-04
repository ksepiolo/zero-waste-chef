# promptfoo Evals for the Code Reviewer — Implementation Plan

## Overview

Stand up [promptfoo](https://promptfoo.dev) inside `packages/code-reviewer` as a **local, on-demand** eval harness that runs the package's single review prompt across **three OpenRouter models** against **one dense React 16 → React 19 migration diff** carrying **three planted, impactful defects**.

Each model's review is graded two ways:

- **Deterministically** — the derived verdict must fail, the output must parse against `reviewResultSchema`, and every issue's `quote` must actually occur in the diff.
- **By an LLM judge** — three per-defect `llm-rubric` assertions, so the results table shows exactly _which_ model missed _which_ flaw.

The headline finding from research holds and was re-verified during planning: **no changes to `src/` are required.** `createProviderContext(env)` already accepts an `Env` override (`src/openrouter.provider.ts:20`), so the per-model matrix is pure configuration.

## Current State Analysis

`packages/code-reviewer` is a standalone npm project (its own lockfile, tsconfig, eslint and vitest configs; the root `eslint .` ignores `packages/**`). It was explicitly designed for this change: `context/changes/tool-loop-agent/plan-brief.md:9` names "the promptfoo evals planned as a follow-up" as the driver for the whole `ToolLoopAgent` refactor, and defers "any promptfoo configuration, provider adapter, fixtures, or eval scripts" — precisely this change's scope.

**What already exists (no work needed):**

| Seam                                                       | Location                           | Why it matters                                                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `createReviewAgent({model?, instructions?, temperature?})` | `src/agents/reviews.ts:54`         | Injectable model and prompt; every option optional.                                                                                             |
| `resolveModel()` lazy resolution                           | `src/agents/reviews.ts:90`         | An injected model never reads `OPENROUTER_API_KEY`. Pinned by `src/agents/reviews.test.ts:189`, commented in-source as "this is the eval path". |
| `createProviderContext(env = loadEnv())`                   | `src/openrouter.provider.ts:20`    | Accepts an `Env` override — **this is what makes the three-model matrix free.**                                                                 |
| `buildReviewPrompt(input)`                                 | `src/prompts/reviews.ts:68`        | Pure, no I/O.                                                                                                                                   |
| `deriveVerdict(criteria)`                                  | `src/schemas/reviews.ts:129`       | Pure function an assertion can call directly.                                                                                                   |
| `reviewResultSchema`                                       | `src/schemas/reviews.ts:93`        | `strictObject` — a malformed response throws rather than degrading.                                                                             |
| `MockLanguageModelV4` test pattern                         | `src/agents/reviews.test.ts:34-51` | The `modelReturning()` helper the provider's unit test will mirror.                                                                             |

**What's missing / in the way:**

- **Node floor.** `promptfoo@0.122.2` (verified live during planning) declares `engines.node >= 22.22.0`. `.nvmrc` is `22.14.0`; `.github/workflows/ci.yml:47` and `.github/actions/ai-code-review/action.yml:54` both pin `"22.14"`. `engine-strict` is `false`, so this warns rather than fails — but CI would knowingly run promptfoo on an unsupported runtime.
- **Gate coverage.** `tsconfig.json:9,27` sets `rootDir: "src"` with `include: ["src/**/*.ts"]`; `eslint.config.js:14` scopes to `src/**/*.ts`; `vitest.config.ts:11` includes `src/**/*.test.ts`. An `evals/` directory is invisible to all three.
- **No judge configured.** promptfoo's `llm-rubric` defaults to `gpt-5` — an OpenAI key this repo does not have and does not want. It must be overridden to an `openrouter:` model.

## Desired End State

From a clean checkout with `OPENROUTER_API_KEY` in `packages/code-reviewer/.env`:

```bash
cd packages/code-reviewer && npm run eval
```

runs 3 providers × 6 assertions = 18 assertion results over one fixture, prints a comparison table, and writes `evals/output/latest.json`. `npm run eval:view` opens the browser comparison UI. The command exits non-zero when a model's review misses a planted defect or returns a passing verdict on a diff that plainly should fail.

`npm run lint`, `npm run typecheck` and `npm test` all cover `evals/` and pass. `npm run build` still emits only `src/` to `dist/` — no eval code ships.

### Key Discoveries:

- **The matrix needs no source change.** `createProviderContext(loadEnv({ ...process.env, OPENROUTER_MODEL: id }))` yields a per-model `LanguageModel` reusing all the existing key/attribution handling (`src/openrouter.provider.ts:20-32`).
- **`rootDir: "src"` blocks the obvious fix.** Adding `evals/**/*.ts` to `tsconfig.json`'s `include` fails with **TS6059** (_"is not under 'rootDir'"_). A separate `tsconfig.evals.json` with `noEmit: true` is required — which also gives typescript-eslint's `projectService` a project to resolve eval files against.
- **promptfoo exits `100` on assertion failure, not `1`** (verified in research §2.3). `PROMPTFOO_FAILED_TEST_EXIT_CODE=1` remaps it.
- **promptfoo bundles its own `tsx`** as a direct runtime dependency (`^4.23.11`), so `.ts` provider and assertion files load with no compile step and no `NODE_OPTIONS`.
- **A `prompts:` entry is mandatory even though the provider ignores it** — the provider reads `context.vars` directly. A single passthrough entry satisfies the schema.
- **React 19 silently ignores `defaultProps` on function components** (verified against the React 19 upgrade guide during planning) — it is _removed_, not deprecated. This makes it an ideal planted flaw: an idiom violation with real runtime consequences, invisible to the type checker if props are optional.
- **`temperature: 0` is weakest on the incumbent.** OpenRouter reports `anthropic/claude-sonnet-5` as supporting neither `temperature` nor `seed`; both challengers support both. Assertions must be bands and booleans, never exact scores.
- **Answer-key leakage is a live hazard.** The `test/code-review-fixtures` branch README warns: _"Do not pass this README to the reviewer. It is the answer key."_ Anything in `vars` reaches the reviewer; only `assert[].value` reaches the judge.

## What We're NOT Doing

- **No changes to `src/`.** Not the prompt, not the schema, not the agent. The eval measures the reviewer as it exists.
- **No CI integration.** No new workflow, no job, no `workflow_dispatch`. Explicitly deferred — adding a second nondeterministic AI gate on top of the existing AI review gate is a separate decision.
- **No prompt-variant A/B.** `REVIEW_INSTRUCTIONS` stays fixed across all three arms; the variable under test is the model. (The `instructions` seam exists for a later change.)
- **No regression assertions against `calibration.md`.** That sample's `documentation` and `implementation_correctness` criteria are documented as uncalibrated; binding to those numbers now would encode noise.
- **No second or third fixture.** One diff, done well.
- **No red-teaming, no `promptfoo redteam`, no dataset generation.**
- **No precision/false-positive gate.** Recall is what the brief asks for. A precision note goes in the aggregate rubric's reasoning but gates nothing.
- **Not porting the 45-defect corpus** from `test/code-review-fixtures` — it targets the retired file-based contract.

## Implementation Approach

promptfoo owns the runner, the matrix and the reporting (research §7, option A). We own one adapter file that bridges `ApiProvider.callApi()` to `createReviewAgent()`, and the fixture.

The provider returns the review **plus its derived verdict** as a structured JavaScript object. promptfoo passes structured output to assertions untouched, so `output.criteria.security_safety.score` and `output.verdict.passed` are directly addressable with no `JSON.parse` step (verified end-to-end in research §2.3).

Assertions split by cost and determinism:

- **Static** (`file://*.assert.ts`, free, deterministic) — catches wrong verdicts, malformed output from weaker models, and hallucinated quotes.
- **LLM rubric** (one call each, nondeterministic) — catches "did it find _this specific_ defect", which no static check can express.

Three separate per-defect rubrics rather than one aggregate: with three models the results grid then reads directly as _which model missed which flaw_, which is the comparison the change exists to produce.

## Critical Implementation Details

**Ordering — the `rootDir` trap.** Phase 1's tsconfig work must land before any `evals/*.ts` file is written, or `npm run typecheck` reports TS6059 on the new directory and the failure looks like a bug in the provider rather than a missing project config.

**Answer-key isolation.** The three planted defects must appear in `assert[].value` (the judge's rubric) and in `evals/fixtures/README.md`, and **never** in `promptfooconfig.yaml`'s `vars` block or any file that `vars` loads. `vars` is what the provider hands the reviewer. A leak silently converts a recall test into a reading-comprehension test, and the eval keeps passing while measuring nothing.

**Import path.** The provider must import from `../src/index.js`, not from `@zero-waste-chef/code-reviewer` — the package's `exports` map points at `./dist/index.js`, which would make every eval run depend on a prior `npm run build`. Under `moduleResolution: nodenext`, the `.js` specifier resolves to the `.ts` source through promptfoo's bundled `tsx`.

## Phase 1: Toolchain & Gates

### Overview

Raise the Node floor so promptfoo runs on a supported runtime, install it, and extend the package's three quality gates to cover a new `evals/` directory — before any eval code exists.

### Changes Required:

#### 1. Node version pins

**File**: `.nvmrc`

**Intent**: Raise the repo-wide Node pin so `promptfoo`'s `>=22.22.0` floor is satisfied on developer machines.

**Contract**: Single line `22.14.0` → `22.23.2` (current Node 22 LTS "Jod", released 2026-07-28; verified against `nodejs.org/dist/index.json` during planning).

---

**File**: `.github/workflows/ci.yml`

**Intent**: Keep the `reviewer-package` job's runtime matching `.nvmrc`.

**Contract**: Line 47, `node-version: "22.14"` → `"22.23"`. The adjacent comment says it "matches .nvmrc and makes the package's `engines: >=22.9.0` floor explicit" — update it to name the new floor. The `app` and `deploy` jobs pin a bare `22` and need no change.

---

**File**: `.github/actions/ai-code-review/action.yml`

**Intent**: Keep the composite action's runtime consistent with the rest of the repo.

**Contract**: Line 54, `node-version: "22.14"` → `"22.23"`.

---

**File**: `packages/code-reviewer/package.json`

**Intent**: Make the new floor a declared constraint rather than an implicit one, and add promptfoo.

**Contract**: `engines.node` `">=22.9.0"` → `">=22.22.0"`. Add `promptfoo` to `devDependencies` (`^0.122.2`). Add two scripts:

- `"eval": "promptfoo eval -c evals/promptfooconfig.yaml"`
- `"eval:view": "promptfoo view -y"`

`npm install` must run so `package-lock.json` moves with it — this is ~839 packages, all dev-only.

#### 2. Typecheck coverage

**File**: `packages/code-reviewer/tsconfig.evals.json` _(new)_

**Intent**: Give `evals/**` a TypeScript project so it is typechecked and so typescript-eslint's `projectService` can resolve it — without disturbing the emit config.

**Contract**: Extends `./tsconfig.json`; sets `noEmit: true`, `include: ["evals/**/*.ts"]`, and **must override `rootDir`** (to `"."` or by removing it) — inheriting `rootDir: "src"` reproduces the TS6059 this file exists to avoid. A header comment should record why a separate project is needed, matching the style of `tsconfig.build.json`'s comment.

---

**File**: `packages/code-reviewer/package.json`

**Intent**: Make `npm run typecheck` cover both projects.

**Contract**: `"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.evals.json"`.

#### 3. Lint coverage

**File**: `packages/code-reviewer/eslint.config.js`

**Intent**: Lint eval code with the same rule set as `src/`.

**Contract**: Add a second config object for `files: ["evals/**/*.ts"]` with the same `extends` and `languageOptions` as the `src/` block. `no-console` should be relaxed to `off` here — an eval provider legitimately reports progress to the terminal. Update the `lint` script to `eslint src evals`.

#### 4. Test coverage

**File**: `packages/code-reviewer/vitest.config.ts`

**Intent**: Let the provider adapter carry a unit test that runs without an API key.

**Contract**: `include` becomes `["src/**/*.test.ts", "evals/**/*.test.ts"]`.

#### 5. Ignore promptfoo's working files

**File**: `packages/code-reviewer/.gitignore`

**Intent**: Keep eval run artifacts and promptfoo's local cache out of the repo.

**Contract**: Append `evals/output/` and `.promptfoo/`.

### Success Criteria:

#### Automated Verification:

- `node -v` inside the package reports ≥ 22.22.0 after `nvm use`
- Install succeeds with no `EBADENGINE` warning: `npm ci`
- Typecheck covers both projects and passes: `npm run typecheck`
- Lint covers both directories and passes: `npm run lint`
- Existing suite still passes: `npm test`
- Build still emits only `src/`: `npm run build && test ! -d dist/evals`
- promptfoo resolves: `npx promptfoo --version`

#### Manual Verification:

- `git status` shows no promptfoo cache or output files as untracked
- The bumped `.nvmrc` does not break the root Astro app's local `npm run dev`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: The Provider Adapter

### Overview

One file bridging promptfoo's `ApiProvider` contract to `createReviewAgent()`, parameterized by model id, with a unit test that needs no API key.

### Changes Required:

#### 1. The provider

**File**: `packages/code-reviewer/evals/reviewer.provider.ts` _(new)_

**Intent**: Let promptfoo drive the real reviewer once per model, returning the review and its derived verdict as structured output so assertions can address nested fields directly.

**Contract**: Default-exports a class implementing promptfoo's `ApiProvider`:

- `constructor(options: ProviderOptions)` — reads the model id from `options.config.model`; falls back to `options.id`. Throws a readable error if neither yields a model id, since a silent fallback to `OPENROUTER_MODEL` would make two matrix arms secretly identical.
- `id(): string` — returns a stable label per model so the results grid is readable.
- `callApi(_prompt, context?): Promise<ProviderResponse>` — reads `title`, `description`, `diff` from `context.vars`; builds the model via `createProviderContext(loadEnv({ ...process.env, OPENROUTER_MODEL: this.modelId }))`; calls `createReviewAgent({ model })` and `agent.generate({ prompt: buildReviewPrompt(input) })`.

Returns `{ output: { ...review, verdict }, tokenUsage }` where `verdict` is `deriveVerdict(review.criteria)`. Attaching the verdict here rather than recomputing it in each assertion keeps `FAILING_SCORE_THRESHOLD` in exactly one place.

**Error handling is load-bearing**: catch everything and return `{ error: String(err) }`. A weaker model failing `Output.object` parsing must surface as one failed cell in the matrix, not as a crash that aborts the other two arms mid-run.

The first argument is deliberately ignored — promptfoo requires a `prompts:` entry, but this provider builds its own prompt from `vars` via `buildReviewPrompt()`. Say so in a comment; it is the single most confusing thing about the file.

Import from `../src/index.js` (see Critical Implementation Details).

#### 2. The provider's unit test

**File**: `packages/code-reviewer/evals/reviewer.provider.test.ts` _(new)_

**Intent**: Prove the adapter's contract deterministically and offline, so a broken provider is caught by `npm test` rather than by a paid eval run.

**Contract**: Mirrors the `modelReturning()` / `MockLanguageModelV4` pattern at `src/agents/reviews.test.ts:34-51`. Because the provider resolves its own model internally, the test injects via `vi.stubEnv` for the key plus a `vi.mock` of the provider module, or — simpler and preferred — the provider accepts an optional injected model on `options.config` used only by tests. Choose the latter if it keeps the production path clean.

Cases to cover:

- `output.verdict.passed` is `false` when a criterion scores at or below the floor, and `true` when none do
- `output` carries all six criteria and the `summary`
- a throwing model yields `{ error }` rather than a rejected promise
- a missing model id throws at construction
- `tokenUsage` is populated

### Success Criteria:

#### Automated Verification:

- Provider tests pass: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- promptfoo can load the provider file: `npx promptfoo eval -c evals/promptfooconfig.yaml --help` runs without a module-resolution error _(after Phase 4; in this phase verify by importing the file in the test)_

#### Manual Verification:

- Reading `reviewer.provider.ts` makes clear why the `prompt` argument is unused
- No API key is required for `npm test` to pass

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Fixture & Answer Key

### Overview

Author one complex, largely-correct React 16 → 19 migration diff with exactly three planted flaws — one each under `implementation_correctness`, `idiomaticity`, and `security_safety` — plus the answer key that reaches only the judge.

### Changes Required:

#### 1. The migration diff

**File**: `packages/code-reviewer/evals/fixtures/react19-migration.diff` _(new)_

**Intent**: Give the reviewer a realistic, substantial migration in which three impactful defects are genuinely findable but not trivially so — the signal that discriminates between the three models.

**Contract**: A unified diff (with proper `diff --git`, `---`/`+++`, and `@@` hunk headers) migrating a synthetic React 16 class component to React 19 function-component form. Synthetic, not adapted from this repo: real components carry incidental issues that muddy whether the model found the _planted_ three.

Written in this repo's conventions so it reads as plausible — kebab-case paths, Tailwind classes, `cn()` from `@/lib/utils`, `@/` path alias.

**The legitimate migration work** (the bulk of the diff, and what makes it complex — all of this must be _correct_, so the model has to discriminate rather than flag everything):

- `class X extends React.Component` → function component with hooks
- `this.state` / `this.setState` → `useState`
- `ReactDOM.render` → `createRoot(...).render` at the entry point
- `UNSAFE_componentWillReceiveProps` → derived state during render
- string ref (`ref="node"`) → `useRef`
- `propTypes` → a TypeScript `interface Props`
- `componentWillUnmount` cleanup → the `useEffect` return

**The three planted flaws**, each anchored to short, quotable text:

| #   | Criterion                    | Flaw                                                                                                                        | Why it is impactful                                                                                                                                                                                         |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `implementation_correctness` | `componentDidUpdate(prevProps)` refetch logic becomes `useEffect(() => { fetchItems(props.categoryId); }, [])` — empty deps | The component never refetches when `categoryId` changes; it silently shows stale data for the wrong category. A classic, high-frequency real migration bug.                                                 |
| 2   | `idiomaticity`               | `ItemList.defaultProps = { pageSize: 25 }` is kept on the new **function** component                                        | React 19 _removed_ `defaultProps` for function components — it is silently ignored, so `pageSize` is `undefined` at runtime and pagination breaks. Invisible to the type checker when the prop is optional. |
| 3   | `security_safety`            | `<span>{item.note}</span>` becomes `<span dangerouslySetInnerHTML={{ __html: item.note }} />`                               | `item.note` is user-supplied. React 16 escaped it; the migration introduces stored XSS.                                                                                                                     |

Flaw 2 is the discriminator — it requires knowing a specific React 19 removal, where 1 and 3 are recognizable to any competent reviewer. Do not soften it.

The diff should also carry **no test file changes**, so `test_risk_coverage` legitimately scores low for all three models. That is expected background, not a planted flaw, and the rubrics must not credit it.

#### 2. The answer key

**File**: `packages/code-reviewer/evals/fixtures/README.md` _(new)_

**Intent**: Record what each flaw is, where it is, and why it matters — for humans maintaining the eval.

**Contract**: A table of the three defects with file, quoted excerpt, criterion, and expected failure. **Opens with a prominent warning** that this file is the answer key and must never be added to `vars` or passed to the reviewer — carrying forward the convention from the `test/code-review-fixtures` branch. Also documents what is deliberately _correct_ in the diff, so a future maintainer does not "fix" the fixture's legitimate migration work.

#### 3. PR metadata

**File**: `packages/code-reviewer/evals/fixtures/react19-migration.vars.yaml` _(new, or inlined in the config)_

**Intent**: Supply the `title` and `description` the reviewer scores `implementation_correctness` against.

**Contract**: A `title` and a `description` written as a plausible, confident PR body claiming a clean migration — the claim the reviewer must test the diff against. It must not hint at any of the three flaws. `src/prompts/reviews.ts:26` shows that an absent description changes the scoring instruction, so supplying one keeps the eval on the primary path.

### Success Criteria:

#### Automated Verification:

- The diff is well-formed and applies in a scratch tree: `git apply --check` (or `patch --dry-run`) succeeds
- Each planted flaw's quotable excerpt appears verbatim in the diff: `grep -c` for each of the three markers returns ≥ 1
- The answer key is not referenced by the config's `vars`: `grep -L "fixtures/README" evals/promptfooconfig.yaml` _(after Phase 4)_

#### Manual Verification:

- The diff reads as a genuine migration a developer would open, not as a puzzle
- Exactly three defects are present — a careful human reviewer finds these three and no fourth unintended one
- Flaw 2 (`defaultProps`) is subtle enough that a weaker model plausibly misses it
- The PR description makes a confident claim the diff does not deliver on

**Implementation Note**: Pause for manual confirmation before proceeding. This phase's quality determines whether the whole eval measures anything — a fixture with four accidental flaws or a trivially obvious flaw 2 produces a comparison that says nothing.

---

## Phase 4: Config, Assertions, First Run & Docs

### Overview

Wire the three-model matrix, the three static assertions and the three per-defect rubrics; run it for real against all three models; document the result.

### Changes Required:

#### 1. The static assertions

**File**: `packages/code-reviewer/evals/assertions/verdict-fails.assert.ts` _(new)_

**Intent**: Assert the reviewer actually _fails_ a diff carrying three impactful defects — the static check the brief asks for.

**Contract**: Default-exports a promptfoo assertion function receiving the provider's structured `output`. Returns `{ pass, score, reason }`. Passes when `output.verdict.passed === false`; the `reason` names which criteria fell to or below the floor, so a failure is diagnosable without opening the JSON.

---

**File**: `packages/code-reviewer/evals/assertions/schema-valid.assert.ts` _(new)_

**Intent**: Catch malformed structured output from the weaker challenger models, which research flags as the likeliest failure mode.

**Contract**: Parses `output` (minus the added `verdict` key) with `reviewResultSchema` imported from `../../src/index.js`. Passes on success; on failure the `reason` carries the flattened zod issues. This distinguishes "the model reviewed badly" from "the model could not produce the contract at all" — the same distinction the CLI's exit codes 1 and 3 draw.

---

**File**: `packages/code-reviewer/evals/assertions/quotes-anchored.assert.ts` _(new)_

**Intent**: Catch hallucinated locators — issues quoting text that is not in the diff.

**Contract**: Collects every `issues[].quote` across all six criteria and checks each occurs in the diff (from `context.vars.diff`). Compare on whitespace-normalized text — models reflow leading `+`/`-` markers and indentation, and an exact-match check would false-positive on formatting alone. The `reason` lists any unanchored quotes verbatim. Scores as the _fraction_ anchored rather than all-or-nothing, so one stray quote is visible without failing an otherwise good review.

#### 2. The judge rubrics

**File**: `packages/code-reviewer/evals/promptfooconfig.yaml` _(new)_

**Intent**: The whole eval — providers, prompt, test case, and all six assertions.

**Contract**:

- `description` — names the change and what is under test.
- `prompts:` — a single passthrough entry (`"{{diff}}"` or similar). **Required by the schema but ignored**; the provider builds its own prompt from `vars`. Comment this, or the next reader will try to edit the prompt here and wonder why nothing changes.
- `providers:` — three entries, all `file://reviewer.provider.ts`, each with a distinct `id`, a human `label`, and `config: { model: <id> }`:
  - `anthropic/claude-sonnet-5` (the package default — the incumbent baseline)
  - `z-ai/glm-5.1`
  - `deepseek/deepseek-v4-flash`
- `defaultTest.options.provider:` — **`openrouter:x-ai/grok-4.6`**. Without this, `llm-rubric` silently defaults to `gpt-5` and every judge call fails on a missing OpenAI key. Grok 4.6 is neutral to all three subjects (avoiding self-preference bias in a ranking comparison), is a stable non-preview id, and — verified against OpenRouter's live model list during planning — is the only strong candidate supporting both `temperature` and `seed`. Note in a comment that `google/gemini-3.8-flash` is the cheaper swap and that plain `google/gemini-3-pro` does not exist on OpenRouter.
- `tests:` — one test. `vars` carry `title`, `description`, and `diff: file://fixtures/react19-migration.diff`. **`vars` must not reference the answer key.**
- `assert:` — six entries:
  - three `javascript` assertions pointing at the `file://assertions/*.assert.ts` files above
  - three `llm-rubric` assertions, **one per planted defect**, each describing that defect in the judge's own terms and asking whether the review identifies it. Each carries `threshold: 1` (binary — found or not) and a `metric` name (`recall:correctness`, `recall:idiomaticity`, `recall:security`) so promptfoo aggregates a per-defect column across the three models.

Each rubric's `value` must describe the defect **behaviourally**, not by quoting the fixture's exact code — otherwise the judge rewards string matching over comprehension. It should also instruct the judge to credit the finding only when the review names the _consequence_ (stale data / ignored prop / XSS), not merely the symptom, and to ignore whether the review found _other_ issues.

The rubrics are where the answer key legitimately lives. They reach the judge only, never the provider.

#### 3. Scripts and documentation

**File**: `packages/code-reviewer/package.json`

**Intent**: Make the exit-code contract usable.

**Contract**: The `eval` script gains `PROMPTFOO_FAILED_TEST_EXIT_CODE=1` so a failed eval exits `1` rather than promptfoo's default `100`, matching every other script in the repo. Add `--output evals/output/latest.json`.

---

**File**: `packages/code-reviewer/README.md`

**Intent**: Document the harness where the package's other tooling is documented.

**Contract**: A new `## Evaluating the reviewer` section after "Using it as a library", covering: what the eval measures, the three models and why, the judge and why it is neither of the three, `npm run eval` / `npm run eval:view`, the answer-key warning, the Node ≥ 22.22 requirement, and the exit-code remap. Add `eval` and `eval:view` rows to the existing Scripts table. Extend the Layout table with the `evals/` entries.

---

**File**: `packages/code-reviewer/evals/results.md` _(new)_

**Intent**: Record the first real run, so a later drift is measurable against something.

**Contract**: Date, promptfoo version, judge model, and a table of per-model results: the six criterion scores, the verdict, which of the three defects each model found, and token cost. Plus a short reading of what the comparison shows. This is the change's actual deliverable as a piece of knowledge — the config is just what produces it.

### Success Criteria:

#### Automated Verification:

- Config validates and the eval runs end to end: `npm run eval`
- All three static assertions pass on all three models
- The run writes `evals/output/latest.json` containing three provider results
- A deliberately inverted assertion makes the command exit `1`, not `100` — proving the remap
- Lint, typecheck and unit tests still pass: `npm run lint && npm run typecheck && npm test`
- The answer key never reaches the reviewer: `evals/output/latest.json` contains no text unique to `fixtures/README.md`

#### Manual Verification:

- `npm run eval:view` renders a readable three-column comparison
- Every model's review **fails** the fixture — a passing verdict on this diff means the fixture's flaws are too subtle or the threshold is wrong
- At least one model misses at least one defect — if all three find all three, the fixture does not discriminate and flaw 2 needs sharpening
- The judge's `reason` strings show it evaluated the defect described, not the presence of a keyword
- Judge verdicts agree with a human reading of each review
- `results.md` reflects the actual run, not an expected one

**Implementation Note**: This phase makes real, paid model calls (~$0.06 for a full pass, plus nine judge calls). Run it at least twice before recording results — the incumbent ignores `temperature: 0`, so a single run cannot distinguish a real difference from sampling noise.

---

## Testing Strategy

### Unit Tests:

- `evals/reviewer.provider.test.ts` — the adapter contract against `MockLanguageModelV4`: verdict derivation both ways, all six criteria present, error path returns `{ error }`, missing model id throws, `tokenUsage` populated. No network, no API key.
- The three `*.assert.ts` files are pure functions over an output object. If they grow any branching beyond a single predicate — the quote-anchoring normalizer in particular — give them a small test alongside the provider's.

### Integration Tests:

- `npm run eval` **is** the integration test. It exercises provider construction, OpenRouter auth, real structured-output parsing across three models, and the judge — end to end.
- A cheap smoke variant: run with `--filter-providers deepseek` to exercise the whole path against the cheapest model alone (~$0.001) while iterating on the config.

### Manual Testing Steps:

1. `nvm use && npm ci` in `packages/code-reviewer` — confirm no `EBADENGINE`.
2. `npm test` with **no** `.env` present — confirm the provider's unit tests still pass, proving the offline path.
3. `npm run eval` with a valid key — confirm three columns of results.
4. Open `npm run eval:view` and read each model's `security_safety` issues — confirm the XSS flaw is described as XSS, not as a style nit.
5. Temporarily remove flaw 3 from the diff and rerun — the `recall:security` rubric should flip to failing for every model. Revert. This proves the rubric measures the defect rather than always passing.
6. Grep `evals/output/latest.json` for a distinctive phrase from `fixtures/README.md` — must return nothing.

## Performance Considerations

Not a constraint. One full pass is three review calls (~9k input / ~2k output each) plus nine judge calls — roughly **$0.06**, well under a minute wall-clock. Even `--repeat 5` stays under a dollar.

The one real cost risk is a runaway retry loop if a model repeatedly fails `Output.object` parsing. The provider's error path returns rather than retries, so a parse failure costs exactly one call.

## Migration Notes

The Node bump is the only change with reach beyond this package. `22.14.0 → 22.23.2` is a patch-level move within the same LTS line, so no code change is expected — but the root Astro app, Playwright, and Wrangler all run on it. The `app` and `deploy` CI jobs pin a bare `22` and already float to the latest 22, so CI has effectively been running newer than `.nvmrc` all along; this bump narrows that gap rather than widening it.

Rollback is `git revert` — nothing here is stateful, and `evals/` is additive. If the Node bump alone proves troublesome, the fallback from the planning discussion is pinning `promptfoo` to `<= 0.120.0`, which accepts Node `>= 20`.

## References

- Research: `context/changes/code-review-evals/research.md` — the verified promptfoo probe (§2.3), model pricing (§4), and alternatives survey (§6)
- Lesson brief: `.claude/prompts/m5l3-promptfoo.md`
- The package under test: `packages/code-reviewer/src/agents/reviews.ts:54`, `src/openrouter.provider.ts:20`, `src/schemas/reviews.ts:129`
- The eval-path test this plan builds on: `packages/code-reviewer/src/agents/reviews.test.ts:189-202`
- Prior labelled data: `context/changes/ci-cd-code-review/calibration.md` (seven scored PRs; not asserted against — see What We're NOT Doing)
- Why the package looks like this: `context/changes/tool-loop-agent/plan-brief.md:9,52`
- Answer-key convention: `test/code-review-fixtures` branch README
- React 19 removals: https://react.dev/blog/2024/04/25/react-19-upgrade-guide

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Toolchain & Gates

#### Automated

- [x] 1.1 `node -v` inside the package reports ≥ 22.22.0 after `nvm use` — 4c81cb4
- [x] 1.2 Install succeeds with no `EBADENGINE` warning: `npm ci` — 4c81cb4
- [x] 1.3 Typecheck covers both projects and passes: `npm run typecheck` — 4c81cb4
- [x] 1.4 Lint covers both directories and passes: `npm run lint` — 4c81cb4
- [x] 1.5 Existing suite still passes: `npm test` — 4c81cb4
- [x] 1.6 Build still emits only `src/`: `npm run build && test ! -d dist/evals` — 4c81cb4
- [x] 1.7 promptfoo resolves: `npx promptfoo --version` — 4c81cb4

#### Manual

- [x] 1.8 `git status` shows no promptfoo cache or output files as untracked — 4c81cb4
- [x] 1.9 The bumped `.nvmrc` does not break the root Astro app's local `npm run dev` — 4c81cb4

### Phase 2: The Provider Adapter

#### Automated

- [x] 2.1 Provider tests pass: `npm test` — 6a30b9b
- [x] 2.2 Typecheck passes: `npm run typecheck` — 6a30b9b
- [x] 2.3 Lint passes: `npm run lint` — 6a30b9b
- [x] 2.4 promptfoo can load the provider file without a module-resolution error — 6a30b9b

#### Manual

- [x] 2.5 Reading `reviewer.provider.ts` makes clear why the `prompt` argument is unused — 6a30b9b
- [x] 2.6 No API key is required for `npm test` to pass — 6a30b9b

### Phase 3: Fixture & Answer Key

#### Automated

- [x] 3.1 The diff is well-formed and applies in a scratch tree (`git apply --check`) — d37be26
- [x] 3.2 Each planted flaw's quotable excerpt appears verbatim in the diff — d37be26
- [x] 3.3 The answer key is not referenced by the config's `vars` — d37be26

#### Manual

- [x] 3.4 The diff reads as a genuine migration, not as a puzzle — d37be26
- [x] 3.5 Exactly three defects are present — no fourth unintended one — d37be26
- [x] 3.6 Flaw 2 (`defaultProps`) is subtle enough that a weaker model plausibly misses it — d37be26
- [x] 3.7 The PR description makes a confident claim the diff does not deliver on — d37be26

### Phase 4: Config, Assertions, First Run & Docs

#### Automated

- [x] 4.1 Config validates and the eval runs end to end: `npm run eval`
- [ ] 4.2 All three static assertions pass on all three models
- [x] 4.3 The run writes `evals/output/latest.json` containing three provider results
- [x] 4.4 A deliberately inverted assertion makes the command exit `1`, not `100`
- [x] 4.5 Lint, typecheck and unit tests still pass
- [x] 4.6 The answer key never reaches the reviewer (no `fixtures/README.md` text in the output JSON)

#### Manual

- [ ] 4.7 `npm run eval:view` renders a readable three-column comparison
- [ ] 4.8 Every model's review fails the fixture
- [ ] 4.9 At least one model misses at least one defect
- [ ] 4.10 The judge's `reason` strings show it evaluated the defect, not a keyword
- [ ] 4.11 Judge verdicts agree with a human reading of each review
- [ ] 4.12 `results.md` reflects the actual run, not an expected one
