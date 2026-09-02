<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: ToolLoopAgent Code Reviewer

- **Plan**: context/changes/tool-loop-agent/plan.md
- **Scope**: Full plan — Phases 1–4 of 4 (commits e508ebb, 863ad85, 8f67597, 72ddd3e)
- **Date**: 2026-09-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Context for the verdict

The conversion itself is high-fidelity. Verified mechanically, not by inspection:

- Phase 2's "verbatim" requirement holds exactly — git records `review.schema.ts → schemas/reviews.ts`
  as a **0-line rename**, and line-range diffs of the instruction sentences and `buildPrompt` body
  against `f2e85dd:review.service.ts` come back empty. No `.describe()` string drifted.
- Phase 1's CLI extraction is byte-identical to the original `main()` apart from the rename
  `main`→`runCli`, `paths`→`args`, and an added JSDoc block.
- `reviewCode`'s signature, both interfaces, the throw message, and `resolveModel` are identical
  to the pre-change versions.
- All 13 automated success criteria across the four phases pass.
- No "What We're NOT Doing" guardrail was violated.

Three of the five warnings were introduced by this change (F1, F2, F3). The other two (F4, F5) are
**pre-existing CLI behaviour inherited verbatim** from `f2e85dd` — they are not drift, but they now
live in a file this change created, and no prior review has recorded them.

## Findings

> **Disposition pass — 2026-09-02, by `ci-cd-code-review` Phase 2.** That change replaces this
> package's review contract (`findings[]`/`severity` → a six-criterion 1–10 rubric over a diff) and
> rewrites the CLI, so seven of these nine findings had to be resolved or explicitly carried rather
> than silently inherited. Their `Decision` lines below say which. F3 and F9 were out of that
> change's scope and remain PENDING.

### F1 — Output schema is configured but never pinned by a test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/agents/reviews.ts:62, src/agents/reviews.test.ts
- **Detail**: Verified by mutation in the working tree. Replacing
  `Output.object({ schema: reviewResultSchema })` with `Output.object({ schema: z.looseObject({}) })`
  leaves **all 32 tests passing**. Removing `output` entirely _is_ caught (the review comes back as a
  raw string). So the suite proves "some structured output is configured", not "the review schema is
  the one wired in" — the single most important claim of the phase. Phase 4's plan text listed the
  output schema as part of the factory contract, and Phase 3 built the suite as the net for exactly
  this phase.
- **Fix**: Add one test that drives the agent with a mock returning valid JSON of the wrong shape
  (e.g. `{"foo":1}`) and assert it rejects. The SDK raises
  `AI_NoObjectGeneratedError: response did not match schema`, so the assertion is stable.
  - Strength: Kills the surviving mutant; costs one mock and ~6 lines.
  - Tradeoff: None material.
  - Confidence: HIGH — mutant survival and SDK rejection both verified by execution.
  - Blind spot: None significant.
- **Decision**: FIXED by `ci-cd-code-review` Phase 2. `createReviewAgent` is now pinned by two tests
  in `src/agents/reviews.test.ts` — valid JSON of the wrong shape (`{"foo":1}`) and a payload missing
  one of the six criteria both reject. Mutant re-verified: substituting `z.looseObject({})` for
  `reviewResultSchema` now fails exactly those two tests.

### F2 — Emitted .d.ts depends on a package that is not a declared dependency

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/agents/reviews.ts:55 (un-annotated return type) → dist/agents/reviews.d.ts
- **Detail**: `createReviewAgent`'s return type is inferred, so `tsc` inlines the full structural type
  into the declaration, including `import("@ai-sdk/provider-utils").Context`.
  `@ai-sdk/provider-utils` is **not** in this package's `dependencies` or `devDependencies` — it
  resolves today only as a transitive of `ai` under npm's flat layout. A stricter installer (pnpm),
  a workspace move, or `ai` reorganising its internals breaks every `.d.ts` consumer. The plan
  anticipated this risk but gated the fix on `tsc` erroring, which it does not.
- **Fix A ⭐ Recommended**: Give `createReviewAgent` an explicit return type built only from names
  `ai` exports, and export it as a named `ReviewAgent` alias.
  - Strength: Keeps the public type surface inside declared dependencies and gives evals a nameable
    handle for the agent; no new dependency.
  - Tradeoff: Needs a type alias that restates the `Output` generic; mildly verbose.
  - Confidence: MEDIUM — `ToolLoopAgent` and `Output` are both exported from `ai`, but the
    `RUNTIME_CONTEXT` parameter may still force naming `Context`, which `ai` may not re-export.
    Worth a spike before committing to it.
  - Blind spot: Have not confirmed `ai` re-exports `Context`.
- **Fix B**: Declare `@ai-sdk/provider-utils` as a direct dependency, pinned to the range `ai` uses.
  - Strength: One line; makes the existing emit honest immediately.
  - Tradeoff: Adds a dependency on a package the source never imports, which will read as cruft.
  - Confidence: HIGH — resolves the concern with no type gymnastics.
  - Blind spot: Version skew if `ai` bumps its own range.
- **Decision**: CARRIED, install-time symptom refuted. Phase 1's clean-tree CI job runs `npm ci` +
  `npm run build` from a fresh checkout and is green, so the predicted resolution failure does not
  materialise under npm's flat layout. The latent condition is unchanged and re-confirmed after the
  rubric replacement: `dist/agents/reviews.d.ts` still emits
  `import("@ai-sdk/provider-utils").Context`, and `@ai-sdk/provider-utils` is still absent from this
  package's `dependencies`/`devDependencies`. Fix A remains the recommendation; not attempted in
  `ci-cd-code-review`, which does not touch `createReviewAgent`'s signature.

### F3 — Public export surface grew without a plan step authorising it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/index.ts:12
- **Detail**: `buildReviewPrompt` and `REVIEW_INSTRUCTIONS` were added to the barrel during Phase 4.
  No phase step authorises this — Phase 2 required only that the _prompts module_ export them, and
  Phase 4's index contract names only the agent exports. Phase 1's contract ("the export list stays
  exactly as it is today") was silently superseded. Nothing was removed and no consumer breaks; the
  additions serve the Desired End State ("a package a future promptfoo eval can import and drive"),
  since the package's `exports` map exposes only `"."` and an eval otherwise cannot build a prompt
  without reimplementing the numbering and drifting from production.
- **Fix A ⭐ Recommended**: Record it as a plan addendum noting Phase 4 extended the barrel and why.
  - Strength: Preserves working code and the eval path; makes the plan honest before `/10x-archive`
    treats it as ground truth.
  - Tradeoff: Plan becomes a slightly moving target.
  - Confidence: HIGH — the README example and the verified end-to-end run both depend on this export.
  - Blind spot: None significant.
- **Fix B**: Revert both exports from the barrel.
  - Strength: Strict scope discipline; smallest public surface.
  - Tradeoff: Leaves the change's stated goal unmet — an eval could construct the agent but not
    build a prompt for it.
  - Confidence: HIGH — verified the `exports` map blocks deep imports.
  - Blind spot: None significant.
- **Decision**: PENDING

### F4 — CLI uploads the contents of any path it is given, with no guard or preview

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/cli.ts:37-44
- **Detail**: **Pre-existing behaviour, inherited verbatim from `f2e85dd`** — not introduced by this
  change. Every argv path is `readFile`'d and inlined into the prompt with no filter, no echo of the
  resolved file list, and no confirmation. `npm start -- .env` from the package directory uploads
  `OPENROUTER_API_KEY` to OpenRouter; the same holds for `../../.dev.vars`, `~/.ssh/id_rsa`, or
  whatever a shell glob expands to. The package's own `.env` sits one directory above `src/`.
  This is a footgun rather than a vulnerability — argv comes from the owner's own shell at the
  owner's uid, and the model is the intended sink for source code — but the blast radius is
  credentials, and the recovery is key rotation.
- **Fix**: Skip-with-warning list (`.env*`, `.dev.vars`, `*.pem`, `id_*`) plus printing the resolved
  file list to stderr before the model call.
  - Strength: Turns a silent credential upload into a visible, refusable step; ~10 lines in one file.
  - Tradeoff: A deny-list is not exhaustive; the file-list echo adds noise to every run.
  - Confidence: HIGH — trivially reproducible.
  - Blind spot: Have not surveyed which other secret-bearing filenames matter in this repo.
- **Decision**: OBSOLETED by `ci-cd-code-review` Phase 2. The argv→`readFile` plumbing this describes
  is deleted: the CLI now takes `--diff`/`--body` paths for one diff and one body, so there is no
  glob-expanded file list to exfiltrate. No effort should be spent repairing it.

### F5 — No bound on total input size or model spend

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/cli.ts:37-44
- **Detail**: **Pre-existing behaviour, inherited verbatim from `f2e85dd`.** Measured against the real
  `buildReviewPrompt`: `npm start -- ../../package-lock.json` builds a 729,222-character prompt
  (~197k tokens); a 38-file glob builds ~223,792 characters (~60k tokens). The first exceeds most
  models' input window, so the run fails _after_ the upload; on a model that accepts it, it is a
  large silent charge with no preview.
- **Fix**: Add a byte budget with an explicit override flag, and print the estimated size before the
  model call.
  - Strength: Converts a silent overspend into a refusable prompt.
  - Tradeoff: Needs a threshold chosen without data on typical use.
  - Confidence: HIGH — figures measured against the real builder.
  - Blind spot: None significant.
- **Decision**: OBSOLETED by `ci-cd-code-review` Phase 2, same deletion as F4. The unbounded
  multi-file upload no longer exists; input is one diff, measured at 10k–21k tokens across PRs
  #23–#28. No byte budget was added.

### F6 — CLI failure paths are indistinguishable from findings, and unactionable when they fire

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/cli.ts:61, src/cli.ts:69-76
- **Detail**: **Pre-existing behaviour.** Two related problems. (1) Exit code 1 means both "a critical
  finding was reported" and "the run crashed" — `npx tsx src/cli.ts ./does-not-exist.ts` prints
  `ENOENT` and exits 1, same as a clean run with a critical finding, so nothing can gate on the code.
  (2) When the model returns output the schema rejects, the user sees only
  `AI_NoObjectGeneratedError: No object generated: could not parse the response.` The model's actual
  text hangs off the error object but is never printed — the `DEBUG` branch prints `error.stack`,
  which does not contain it. This is the most likely real-world failure, since the README itself
  notes model ids change often and an `OPENROUTER_MODEL` without structured-output support lands
  exactly here.
- **Fix**: Reserve a distinct exit code (3) for internal failure, and print `error.text` / `error.cause`
  under `DEBUG` — or special-case this error with a "does this model support structured output?" hint.
- **Decision**: FIXED by `ci-cd-code-review` Phase 2. Exit codes are now `0` pass / `1` failing
  verdict / `2` usage error / `3` reviewer error, documented in `runCli`'s JSDoc and in the README,
  and covered by `src/cli.test.ts`. Sub-problem (2) is fixed too: under `DEBUG` the CLI now prints
  the model's raw `error.text` alongside the stack.

### F7 — runCli has no tests, though the plan justified exporting it by testability

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/cli.ts:31, context/changes/tool-loop-agent/plan.md (Phase 1 §1, Phase 3)
- **Detail**: Phase 1's contract states: "Exporting the function rather than inlining the body is what
  makes the CLI testable in Phase 3." Phase 3 then specified only prompt and schema tests, and no CLI
  test was ever written. The plan's own stated rationale for the export went unrealised, and every
  finding in F4/F5/F6 lives in the untested function. Testing it needs `vi.mock` on `reviewCode`,
  which is currently a static import rather than an injected dependency.
- **Fix**: Add `src/cli.test.ts` covering the three exit codes, the severity label map, and the
  empty-findings branch, mocking `reviewCode`.
- **Decision**: FIXED by `ci-cd-code-review` Phase 2. `src/cli.test.ts` covers all four exit codes,
  both output modes, input plumbing, and the reviewer-failure path, with `reviewCode` mocked via
  `vi.mock`. This became load-bearing rather than optional: CI parses `runCli --json`'s stdout.

### F8 — Naming convention is now split with no rule for the next file

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: packages/code-reviewer/README.md:87-89, src/
- **Detail**: The package now holds two conventions: `env.config.ts` and `openrouter.provider.ts` keep
  CLAUDE.md's dot-suffix style, while `agents/reviews.ts`, `prompts/reviews.ts` and
  `schemas/reviews.ts` put the type in the directory. The departure is documented, but the stated
  rationale ("each seam is a directory an eval can grow variants in") applies just as well to the
  provider, which an eval would plausibly want to swap. The two files stayed put because the plan
  listed them under _What We're NOT Doing_ — so the split is **scope, not principle**, and nothing
  records that. A contributor adding a second provider has no rule telling them whether it is
  `src/providers/anthropic.ts` or `src/anthropic.provider.ts`.
- **Fix**: State the boundary explicitly in the README — "directories for eval seams, dot-suffix for
  everything else" — so the next contributor inherits a rule rather than a precedent.
- **Decision**: CARRIED unchanged by `ci-cd-code-review` Phase 2, explicitly. That change adds no new
  file outside the existing directories, so it neither resolves nor worsens the split; the README
  still records the departure as a precedent rather than a rule.

### F9 — Test hygiene: leaky env stub, a lying signature, and a loose matcher

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/agents/reviews.test.ts:159, :44-46, :104
- **Detail**: Three small departures from the root suite's conventions. (1) `vi.unstubAllEnvs()` sits
  on the last line of the test body rather than in `afterEach`, so a failing assertion above it leaks
  both the env stub and the reset module registry — harmless only because it is the last test in the
  file. Root convention puts teardown in `afterEach` (`src/lib/services/product.service.test.ts:26-28`).
  (2) `userTextOf` is annotated `: string` but returns `undefined` when `doGenerateCalls[0]` is absent.
  No false pass results, but the signature is untrue. (3) `toEqual` at :104 ignores `undefined`-valued
  properties where the root suite uses `toStrictEqual`.
  Separately: `prompts/reviews.test.ts:5` re-declares the production header string as a local const and
  asserts equality against it. The root suite is explicit that a test must not use the implementation
  as its own oracle (`src/lib/services/recipe-prompt.test.ts` recovers its expected prompt from git
  history and says why). Defensible here — a prompt format has no external oracle — but it should
  carry the same one-line justification the root tests carry.
- **Fix**: Move the unstub into `afterEach`, correct `userTextOf`'s return type to `string | undefined`,
  switch :104 to `toStrictEqual`, and add the oracle justification comment.
- **Decision**: PENDING

## Non-findings worth recording

Checked and explicitly cleared, so a later review need not re-litigate them:

- **tsconfig form drift.** Phase 3 §2 said "add `src/**/*.test.ts` to the `exclude` array"; the
  implementation added `tsconfig.build.json` instead. The plan's own Critical Implementation Details
  pre-authorised this verbatim ("or split a `tsconfig.build.json`"). Goal verified achieved by
  execution: `tsc -p tsconfig.build.json --listFiles` yields exactly seven local files with no
  `*.test.ts` and no `vitest` in the graph. The split is strictly better than the contracted form —
  all 3 test files remain in the `typecheck` graph, which a single-config `exclude` would have lost.
- **Path traversal in the CLI.** argv comes from the owner's own shell at the owner's own uid, and
  escaping cwd is the documented use case. No privilege boundary exists to cross; only the
  exfiltration angle (F4) is real.
- **API-key leakage.** Nothing writes env to any sink. Importing `dist/index.js` with
  `OPENROUTER_API_KEY` unset produces no stdout, no throw, and exactly the 9 documented exports.
- **Double env read in `reviewCode`.** `resolveModel` runs twice, but the override branch returns
  early, so `loadEnv()` runs at most once. Redundant, not a defect.
- **The escaped-tab assertion in the agent tests.** Confirmed genuinely sensitive: mutating
  `${index + 1}` → `${index}` fails it.
- **The lazy-provider test.** Confirmed load-bearing: with `OPENROUTER_API_KEY` set in the shell, an
  eager mutant is caught _only_ by that test.
- **Both README examples.** Executed end-to-end against built `dist/` with no API key; both forms run.
- **Package tests do not run in CI.** Root `test:unit` is scoped to the repo-root `src/`, so the 32
  tests only run by hand. The plan lists "Not wiring the package into the repo-root vitest run" under
  _What We're NOT Doing_, so this is a known, accepted scoping decision — recorded, not charged.
