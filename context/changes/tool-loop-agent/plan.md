# ToolLoopAgent Code Reviewer Implementation Plan

## Overview

Restructure `@zero-waste-chef/code-reviewer` so the review logic becomes a reusable,
side-effect-free agent module built on the AI SDK's `ToolLoopAgent`, with structured-output
schemas and prompts extracted into their own directories. The end state is a package a future
promptfoo eval can import and drive without pulling in the CLI, without reading `process.env`
at import time, and without touching the filesystem.

## Current State Analysis

The package is already partially modular — the request's framing ("convert `src/index.ts` into
modular code") does not match what is actually in the file. The real gaps are elsewhere:

- **`src/index.ts` is 83 lines of two unrelated things**: public re-exports (lines 9-20) and a
  CLI (lines 22-83). The direct-run guard at lines 70-83 executes at import time, and the module
  statically imports `node:fs/promises`, `node:path`, `node:process`. Any eval harness importing
  the package inherits all of it. **This is the actual reuse blocker.**
- **Prompts are inline in the service**: `INSTRUCTIONS` (`review.service.ts:6-11`) and
  `buildPrompt()` including line-numbering logic (`review.service.ts:66-84`).
- **Schemas already live apart** in `review.schema.ts` (31 lines) but not in the directory layout
  the change calls for.
- **No agent**: `review.service.ts:43-49` is a single `generateText` + `Output.object` call.
- **No tests anywhere**: the package has no test script, and the root `vitest.config.ts` scopes
  `include` to `src/**/*.test.ts` at the repo root, so `packages/` is outside the repo suite.
- **No decoding settings pinned**: temperature is left to provider defaults, so repeated runs drift.

The package's own README already anticipated this change: _"For tool-calling loops, use the SDK's
`ToolLoopAgent` instead of hand-rolling the loop; `src/review.service.ts` is the seam to swap in."_

## Desired End State

```
src/index.ts               pure re-exports, zero side effects on import
src/cli.ts                 argv parsing, file reads, stdout formatting, exit codes
src/agents/reviews.ts      createReviewAgent() factory + reviewCode() wrapper
src/prompts/reviews.ts     REVIEW_INSTRUCTIONS + buildReviewPrompt()
src/schemas/reviews.ts     severity / finding / result schemas + ReviewInputFile
src/env.config.ts          unchanged
src/openrouter.provider.ts unchanged
(deleted) src/review.schema.ts, src/review.service.ts
```

Verifiable by: importing `index.js` in a process with **no** `OPENROUTER_API_KEY` set must not
throw and must not write to stdout; `npm start -- <file>` must behave exactly as it does today.

### Key Discoveries:

- `ai` v7.0.87 is installed; `ToolLoopAgent` settings accept `output` and `tools` on the same
  instance (`node_modules/ai/src/agent/tool-loop-agent-settings.ts:121-124`).
- `agent.generate({ prompt, abortSignal, timeout })` returns `GenerateTextResult` carrying
  `.output`, `.usage`, `.steps` (`node_modules/ai/src/agent/tool-loop-agent.ts:197-258`).
- Default loop bound is `stopWhen: isStepCount(20)` (`docs/03-agents/02-building-agents.mdx`).
- `ai/test` exports `MockLanguageModelV4` (`docs/03-ai-sdk-core/55-testing.mdx`), which makes
  hermetic agent tests possible with no network and no API key.
- `LanguageModelUsage.inputTokens` is `number | undefined` at the SDK level
  (`node_modules/ai/src/types/usage.ts:10-14`), so the CLI's `usage.inputTokens ?? "?"` is correct
  and survives the move unchanged.
- tsconfig sets `exactOptionalPropertyTypes: true`; the existing code already works around it with
  the `...(abortSignal ? { abortSignal } : {})` spread idiom at `review.service.ts:48`.

## What We're NOT Doing

- **Not configuring promptfoo or any eval environment.** No promptfoo config, no provider adapter,
  no fixtures, no eval scripts. This change only makes the package importable and injectable.
- **Not adding tools to the agent.** Decided explicitly: the agent stays hermetic (no filesystem,
  no git, no network beyond the model call). `ToolLoopAgent` is adopted for config encapsulation
  and as a ready seam; the loop will not iterate today.
- Not changing the review output schema, the severity scale, or the CLI's output format.
- Not adding a `bin` field or publishing the package.
- Not wiring the package into the repo-root vitest run.
- Not changing `env.config.ts` or `openrouter.provider.ts`.

## Implementation Approach

Four phases, ordered so the one behaviour-changing step lands last with a test net already under it.
Phases 1 and 2 are pure moves. Phase 3 adds the harness. Phase 4 swaps `generateText` for
`ToolLoopAgent`.

The factory takes an injectable model so evals never depend on `OPENROUTER_API_KEY`; the existing
`resolveModel` fallback to `createProviderContext()` is preserved for the CLI path, but it stays
lazy — called inside the factory, never at module scope.

## Critical Implementation Details

**Test files must not reach the build output.** `tsconfig.json` sets `rootDir: "src"` and
`include: ["src/**/*.ts"]` with `declaration: true`. Adding `src/**/*.test.ts` files without
adjusting the config makes `npm run build` emit tests into `dist/` and drag `vitest` into the
declaration graph. Add `"src/**/*.test.ts"` to the tsconfig `exclude` array (or split a
`tsconfig.build.json`) in Phase 3, before any test file exists.

**Declaration emit on an inferred agent type.** `createReviewAgent()` returns a `ToolLoopAgent`
whose `OUTPUT` generic is inferred from `Output.object({ schema: reviewResultSchema })`. With
`declaration: true`, TypeScript must be able to name that type in the `.d.ts`. If `tsc` reports it
cannot, annotate the return type explicitly rather than widening it to `unknown` — both
`ToolLoopAgent` and `Output` are exported from `ai`.

**Module specifiers keep the `.js` extension.** `moduleResolution: "nodenext"` means every relative
import — including from test files — is written as `./schemas/reviews.js`, not `./schemas/reviews`.

**Vitest globals stay off**, matching the root repo convention: every test imports `describe`, `it`,
`expect`, `vi` explicitly from `vitest`.

---

## Phase 1: CLI / Library Split

### Overview

Move the CLI out of `index.ts` so importing the package has no side effects. This alone delivers
the change's headline property and is independent of everything that follows.

### Changes Required:

#### 1. New CLI module

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Take over everything at `index.ts:22-83` — the severity label map, `main()`, and the
direct-run guard — so the library surface no longer carries terminal concerns.

**Contract**: Export `runCli(argv: string[]): Promise<number>` returning the process exit code
(2 on missing args, 1 when any finding is `critical`, 0 otherwise). Keep the existing
`import.meta.url === pathToFileURL(entryPoint).href` guard as the only top-level statement that
runs anything, and have it call `runCli`. Exporting the function rather than inlining the body is
what makes the CLI testable in Phase 3.

#### 2. Public entry point

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Reduce to re-exports only. No imports from `node:*`, no top-level statements.

**Contract**: The export list stays exactly as it is today (`index.ts:9-20`) so no consumer breaks.
`cli.ts` is deliberately NOT re-exported — importing the library must not pull the CLI in.

#### 3. Package scripts

**File**: `packages/code-reviewer/package.json`

**Intent**: Repoint the `dev` and `start` scripts at the new CLI entry so `npm start -- <file>`
keeps working.

**Contract**: `start` and `dev` target `src/cli.ts`; `main`, `types`, and `exports` continue to
point at `dist/index.js`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (in `packages/code-reviewer`)
- Build succeeds and emits both entry points: `npm run build && test -f dist/cli.js -a -f dist/index.js`
- Importing the library has no side effects and needs no API key:
  `env -u OPENROUTER_API_KEY node -e "import('./dist/index.js').then(m => console.log(Object.keys(m).length))"`
  exits 0 and prints a non-zero count

#### Manual Verification:

- `npm start -- ../../src/lib/utils.ts` produces the same output shape as before the split
- Exit codes still behave: no args gives 2, a critical finding gives 1, a clean review gives 0

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Extract Schemas and Prompts

### Overview

Move the structured-output schemas and the prompt text into the directory layout the change calls
for. Pure relocation — no behaviour change, no signature change.

### Changes Required:

#### 1. Schema module

**File**: `packages/code-reviewer/src/schemas/reviews.ts`

**Intent**: House the full model-output contract, moved verbatim from `review.schema.ts`.

**Contract**: Exports `severitySchema`, `reviewFindingSchema`, `reviewResultSchema`, the
`ReviewInputFile` interface, and the inferred types `Severity`, `ReviewFinding`, `ReviewResult`.
Zod `.describe()` strings are prompt surface the model reads — carry them across unchanged.

#### 2. Prompt module

**File**: `packages/code-reviewer/src/prompts/reviews.ts`

**Intent**: House the system instructions and the user-prompt builder, moved from
`review.service.ts:6-11` and `review.service.ts:66-84`. This is the module a future eval will
import to A/B a prompt variant.

**Contract**: Exports `REVIEW_INSTRUCTIONS: string` (the joined instruction sentences) and
`buildReviewPrompt(files: ReviewInputFile[], context?: string): string`, preserving the current
1-indexed `${n}\t${line}` numbering and the `--- path ---` section framing exactly. Both are
exported so they can be swapped independently.

#### 3. Delete the old schema file and update importers

**File**: `packages/code-reviewer/src/review.schema.ts` (deleted), `src/review.service.ts`,
`src/index.ts`, `src/cli.ts`

**Intent**: Repoint every importer at the new paths and remove the superseded file.

**Contract**: Imports become `./schemas/reviews.js` and `./prompts/reviews.js` (nodenext requires
the extension). `review.service.ts` keeps its public signature; it now imports the prompt pieces
instead of defining them.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`
- The deleted module is gone and unreferenced: `! grep -rn "review.schema" src/`
- Public exports are unchanged from Phase 1:
  `env -u OPENROUTER_API_KEY node -e "import('./dist/index.js').then(m => console.log(Object.keys(m).sort().join(',')))"`

#### Manual Verification:

- `npm start -- ../../src/lib/utils.ts` still produces findings in the same format
- Spot-check that the numbered-source block in the prompt is byte-identical to before (log the
  built prompt once and compare)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Test Harness and Contract Tests

### Overview

Add package-local vitest and lock the behaviour of the extracted pure units while they are still
backed by the known-good `generateText` path. This is the safety net for Phase 4.

### Changes Required:

#### 1. Test runner setup

**File**: `packages/code-reviewer/package.json`, `packages/code-reviewer/vitest.config.ts`

**Intent**: Add vitest as a dev dependency with a `test` script, configured for a Node environment
and scoped to this package.

**Contract**: `test` runs `vitest run`; config sets `environment: "node"`, `include:
["src/**/*.test.ts"]`, and leaves globals off. No root-level config is touched.

#### 2. Keep tests out of the build

**File**: `packages/code-reviewer/tsconfig.json`

**Intent**: Prevent `tsc` from emitting test files into `dist/`. See Critical Implementation
Details — this must land before the first test file.

**Contract**: Add `"src/**/*.test.ts"` to the `exclude` array.

#### 3. Prompt builder tests

**File**: `packages/code-reviewer/src/prompts/reviews.test.ts`

**Intent**: Lock the prompt contract so a later edit cannot silently change what the model sees.

**Contract**: Cover 1-indexed numbering (first line is `1`, not `0`), the tab separator, multi-file
section framing, the optional-context branch appearing only when context is supplied, and a
trailing-newline / empty-file edge case.

#### 4. Schema contract tests

**File**: `packages/code-reviewer/src/schemas/reviews.test.ts`

**Intent**: Pin the output contract that structured generation must satisfy.

**Contract**: Assert a well-formed result parses; assert `line: null` is accepted while `line: 0`
and negative or fractional lines are rejected; assert an unknown severity is rejected and an empty
`findings` array is valid.

### Success Criteria:

#### Automated Verification:

- Tests pass: `npm test`
- Type checking still passes: `npm run typecheck`
- Build output contains no test artifacts: `npm run build && ! ls dist/**/*.test.* 2>/dev/null`

#### Manual Verification:

- Deliberately break the line numbering (switch to 0-indexed) and confirm the prompt test fails —
  the net actually catches regressions rather than passing vacuously

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: ToolLoopAgent Conversion

### Overview

Replace the bare `generateText` call with a `ToolLoopAgent` built by an injectable factory, and
reimplement `reviewCode()` on top of it. This is the only phase that changes runtime behaviour.

### Changes Required:

#### 1. Agent module

**File**: `packages/code-reviewer/src/agents/reviews.ts`

**Intent**: Provide the reusable agent factory that evals will drive, plus the `reviewCode()`
convenience wrapper the CLI and README already use.

**Contract**: Two exports.

`createReviewAgent(options?: CreateReviewAgentOptions)` returns a configured `ToolLoopAgent`
carrying `model`, `instructions`, `output: Output.object({ schema: reviewResultSchema })`, and
`temperature: 0`. Options are all optional: `model` (defaults to `createProviderContext()`, resolved
lazily inside the call — never at module scope), `instructions` (defaults to `REVIEW_INSTRUCTIONS`),
and `temperature`. Give the agent a stable `id` such as `"code-reviewer"` so eval telemetry can
attribute runs. `tools` is deliberately omitted; `stopWhen` keeps the SDK default rather than being
pinned to one step, so adding tools later needs no change here.

`reviewCode(options: ReviewCodeOptions): Promise<ReviewCodeResponse>` keeps its exact current
signature and return type (`{ review, usage, modelId }`), still throws on an empty `files` array,
and internally builds the agent and calls `agent.generate({ prompt: buildReviewPrompt(files,
context), ...(abortSignal ? { abortSignal } : {}) })`.

Note on `exactOptionalPropertyTypes`: optional factory options must use the conditional-spread
idiom already at `review.service.ts:48` rather than being passed as possibly-`undefined` values.

#### 2. Retire the service module

**File**: `packages/code-reviewer/src/review.service.ts` (deleted), `src/index.ts`, `src/cli.ts`

**Intent**: Fold the service into the agent module and repoint importers.

**Contract**: `index.ts` re-exports `createReviewAgent`, `reviewCode`, and their option types from
`./agents/reviews.js`. `ReviewCodeOptions` and `ReviewCodeResponse` keep their names so no
documented type is lost.

#### 3. Agent tests

**File**: `packages/code-reviewer/src/agents/reviews.test.ts`

**Intent**: Verify factory wiring and the `reviewCode` contract hermetically, with no network and no
API key.

**Contract**: Using `MockLanguageModelV4` from `ai/test`: assert `reviewCode` returns the parsed
`review`, the `usage`, and the injected `modelId`; assert the empty-`files` guard still throws;
assert an `instructions` override reaches the model call; assert a custom `temperature` overrides
the default; and assert the prompt handed to the model contains the numbered source. Include one
test that imports the module with `OPENROUTER_API_KEY` unset to prove the provider is resolved
lazily.

#### 4. Documentation

**File**: `packages/code-reviewer/README.md`

**Intent**: Bring the Layout table and the library-usage example in line with the new structure, and
record why the agent has no tools.

**Contract**: Update the Layout table to the six-file target layout; add a `createReviewAgent`
example alongside the existing `reviewCode` one; note that the agent is intentionally hermetic
(no tools) so it can be driven by evals, and that `src/prompts/reviews.ts` is the seam for prompt
variants. Replace the now-stale "`src/review.service.ts` is the seam to swap in" line.

### Success Criteria:

#### Automated Verification:

- Tests pass, including the new agent tests: `npm test`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`
- The retired module is gone and unreferenced: `! grep -rn "review.service" src/`
- Library import remains side-effect-free without credentials:
  `env -u OPENROUTER_API_KEY node -e "import('./dist/index.js').then(m => { if (typeof m.createReviewAgent !== 'function') process.exit(1) })"`

#### Manual Verification:

- `npm start -- ../../src/lib/utils.ts` returns findings of comparable quality to the pre-change
  reviewer on the same file — temperature 0 should tighten, not degrade, the output
- Running the same file twice in a row now yields materially stable findings
- A deliberately buggy fixture file still produces a `critical` finding and exit code 1

**Implementation Note**: This is the final phase. Confirm manual verification before considering the
change complete.

---

## Testing Strategy

### Unit Tests:

- Prompt builder: 1-indexed numbering, tab separator, multi-file framing, optional context branch,
  empty-file and trailing-newline edges
- Schemas: valid result parses; `line: null` accepted, `line: 0` / negative / fractional rejected;
  unknown severity rejected; empty findings array valid
- Agent: factory wiring (instructions, temperature, output schema), `reviewCode` return shape,
  empty-files guard, lazy provider resolution

### Integration Tests:

None in this change. The end-to-end path (real OpenRouter call) stays covered by manual CLI runs;
systematic behavioural coverage is the job of the deferred promptfoo eval change.

### Manual Testing Steps:

1. `cd packages/code-reviewer && npm run build`
2. `env -u OPENROUTER_API_KEY node -e "import('./dist/index.js')"` — must exit 0 silently
3. `npm start -- ../../src/lib/utils.ts` — findings render in the established format
4. `npm start` with no arguments — usage message on stderr, exit code 2
5. Run step 3 twice and compare — findings should be stable under temperature 0

## Performance Considerations

`ToolLoopAgent` with no tools issues exactly one model call per review, identical to today's
`generateText` path, so latency and token cost are unchanged. `temperature: 0` does not affect cost.
The default `stopWhen: isStepCount(20)` never engages because the model returns a non-tool-call
finish reason on the first step.

## Migration Notes

No consumers exist outside this package — `git log` shows the package landed in a single commit
(`f2e85dd`) and nothing in the repo imports it. `reviewCode()` keeps its signature, so the README's
documented usage continues to work. Two files are deleted (`review.schema.ts`, `review.service.ts`);
both are internal and neither is re-exported by path.

## Open Risks & Assumptions

- **The loop does not iterate.** Adopting `ToolLoopAgent` without tools is a deliberate trade for
  hermetic, deterministic evals. If the reviewer later needs to resolve imports or check callers,
  tools get added to the factory — the call sites do not change.
- **Directory naming departs from the repo convention.** `CLAUDE.md` mandates kebab-case with
  dot-separated type suffixes (`feature.service.ts`). `src/schemas/reviews.ts` and
  `src/prompts/reviews.ts` put the type in the directory instead. This was chosen deliberately;
  it is recorded here so a later reviewer does not "correct" it back.

## References

- AI SDK agent docs: `packages/code-reviewer/node_modules/ai/docs/03-agents/02-building-agents.mdx`
- `ToolLoopAgent` settings: `node_modules/ai/src/agent/tool-loop-agent-settings.ts:121-124`
- Test doubles: `node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx`
- Current review call: `packages/code-reviewer/src/review.service.ts:34-52`
- CLI to extract: `packages/code-reviewer/src/index.ts:22-83`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CLI / Library Split

#### Automated

- [x] 1.1 Type checking passes — e508ebb
- [x] 1.2 Build succeeds and emits both entry points — e508ebb
- [x] 1.3 Library import has no side effects and needs no API key — e508ebb

#### Manual

- [x] 1.4 CLI output shape unchanged — e508ebb
- [x] 1.5 Exit codes 0/1/2 still behave — e508ebb

### Phase 2: Extract Schemas and Prompts

#### Automated

- [x] 2.1 Type checking passes
- [x] 2.2 Build succeeds
- [x] 2.3 Deleted module gone and unreferenced
- [x] 2.4 Public exports unchanged from Phase 1

#### Manual

- [x] 2.5 CLI findings render in the same format
- [x] 2.6 Numbered-source prompt block byte-identical to before

### Phase 3: Test Harness and Contract Tests

#### Automated

- [ ] 3.1 Tests pass
- [ ] 3.2 Type checking still passes
- [ ] 3.3 Build output contains no test artifacts

#### Manual

- [ ] 3.4 Deliberate numbering break makes the prompt test fail

### Phase 4: ToolLoopAgent Conversion

#### Automated

- [ ] 4.1 Tests pass, including agent tests
- [ ] 4.2 Type checking passes
- [ ] 4.3 Build succeeds
- [ ] 4.4 Retired service module gone and unreferenced
- [ ] 4.5 Library import side-effect-free without credentials

#### Manual

- [ ] 4.6 Review quality comparable on the same file
- [ ] 4.7 Repeat runs materially stable under temperature 0
- [ ] 4.8 Buggy fixture still yields a critical finding and exit code 1
