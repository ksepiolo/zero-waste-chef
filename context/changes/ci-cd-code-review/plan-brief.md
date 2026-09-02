# CI/CD AI Code Review — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Requirements: `context/changes/ci-cd-code-review/requirements.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Every pull request to `main` should get an automatic AI code review: six criteria scored 1–10, posted
as a PR comment, recorded as an `ai-cr:passed` / `ai-cr:failed` label, re-runnable on demand. The
reviewer package (`packages/code-reviewer`) already exists but has never been wired to anything — it
was built as a library with a CLI and no consumer.

## Starting Point

Three things are true today and all three are load-bearing. **`main` CI is red**: root `eslint .`
lints `packages/code-reviewer/src/` while root `npm ci` never installs that package's dependencies, so
74 type-aware rules fire in CI on unresolved imports — it passes locally only because the developer
machine has the package's `node_modules`. **The reviewer's contract is the wrong shape**: it takes
whole files and emits `findings[]` with `critical|major|minor|nit` severities and line anchors, none of
which has an analogue in six 1–10 scores over a diff. And **the repo has none of the CI furniture**: no
`OPENROUTER_API_KEY` secret, no `ai-cr:*` labels, no `.github/actions/` directory, no branch protection,
and `default_workflow_permissions` set to `read`.

## Desired End State

Opening a PR against `main` produces, within a couple of minutes, one comment carrying six scored
criteria with rationales and concrete issues, plus exactly one verdict label. Pushing another commit
updates that same comment rather than adding a second. Adding `ai-cr:review` re-runs the review and
consumes the label. Nothing blocks a merge — the verdict is advisory. `main` CI is green and the
reviewer package is linted and tested by its own job.

## Key Decisions Made

| Decision               | Choice                                                                     | Why (1 sentence)                                                                                                              | Source   |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| CI isolation repair    | Exclude `packages/` from root lint; package gets its own job               | Matches the isolation vitest, astro-check and build already have — the repo gets consistent in the direction it already leans | Plan     |
| Package tests in CI    | Yes, but `continue-on-error`                                               | Visibility now without blocking the pipeline mid-migration                                                                    | Plan     |
| Reviewer I/O contract  | `--json` mode plus diff/title/body inputs on `cli.ts`                      | Puts the contract where vitest can pin it and keeps the action a thin shell                                                   | Plan     |
| Verdict rule           | Per-criterion floor — any criterion ≤ 4 fails                              | A 1 on security cannot hide behind five 9s, which averaging always allows                                                     | Plan     |
| Output shape           | Score + rationale + issues anchored to file and quote, **no line numbers** | A diff cannot be line-anchored reliably, and a wrong line number is worse than none                                           | Plan     |
| Injection hardening    | Fenced untrusted content + instruction-hierarchy line                      | PR title, body and diff are all attacker-controllable on a public repo; the mitigation is nearly free                         | Plan     |
| Trigger                | `pull_request_target`                                                      | The only trigger that gives fork PRs both a secret and PR-write access                                                        | Plan     |
| Enforcement            | Advisory — labels and comment, job exits 0                                 | `main` has no branch protection, so a failing job would block nothing and just train people to ignore red                     | Plan     |
| Coexistence            | Distinct `ai-cr:` marker and label namespace                               | Lets `10x-impl-review-ci` run on the same PR without comment collision                                                        | Plan     |
| PR description problem | Acknowledged, not solved                                                   | Bodies measure 22–41 bytes; criterion 1 ships knowingly degraded rather than expanding scope                                  | Plan     |
| Cost / token budget    | Not a constraint                                                           | Measured: 10–21k tokens, $0.03–$0.06 per review, ~2% of context                                                               | Research |

## Scope

**In scope:** the root-lint/package-install repair and a package CI job; a package-local ESLint config
(the package has none today); the rubric schema, diff input, hardened prompt and `--json` CLI;
rewriting the ~2/3 of 32 tests the contract change kills; the composite action and workflow; the
secret, labels and live rollout; README fixes and dispositions for the nine `tool-loop-agent` PENDING
findings.

**Out of scope:** branch protection; commit statuses; inline line-anchored review comments; npm
workspaces; a PR description template; the two parked criteria (business alignment, architectural
fit); `tool-loop-agent` F4/F5 (deleted by this change, so not worth repairing); the pre-existing
unset `SUPABASE_URL`/`SUPABASE_KEY` in `ci.yml`.

## Architecture / Approach

```
PR event ──► ai-code-review.yml (thin: triggers, permissions, secret)
              │  checkout BASE branch only — never the PR head
              ▼
            .github/actions/ai-code-review (composite: all logic)
              │  npm ci (base lockfile) → gh pr diff → tsx cli.ts --json
              ▼
            packages/code-reviewer  ──► { summary, criteria×6 } + verdict
              │
              ▼
            render markdown → upsert comment by <!-- ai-cr:marker --> → set labels
```

The reviewer never _executes_ PR code — it consumes the diff as inert text. That is the single
property that keeps `pull_request_target` inside GitHub's documented-safe envelope, and it constrains
every step in the composite action.

## Phases at a Glance

| Phase               | What it delivers                                                          | Key risk                                                                              |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Unblock CI       | Green `main`; package linted and tested in its own job                    | The package has no ESLint config today, so one must be written from scratch           |
| 2. Replace contract | Rubric schema, diff input, hardened prompt, `--json` CLI, rewritten tests | Breaking change to a package the _next_ lesson's promptfoo eval will target           |
| 3. Actions surface  | Composite action + workflow under the safety envelope                     | Cannot be tested by its real trigger before merge                                     |
| 4. Rollout          | Secret, labels, merge, live verification, threshold tuning                | Fork-PR behaviour is only provable here — and it is what justifies the trigger choice |

**Prerequisites:** an OpenRouter API key with credit; admin rights on the repo (secrets and labels);
`gh` authenticated locally for manual verification.

**Estimated effort:** ~3–4 sessions. Phase 2 is the largest by a wide margin — it is a schema
replacement plus a near-total test rewrite.

## Open Risks & Assumptions

- **`pull_request_target` cannot be tested before it is merged to `main`** — GitHub reads the workflow
  from the default branch. Phase 3 mitigates with a `workflow_dispatch` entry point, but the trigger
  wiring itself is only provable in Phase 4. Do not report it verified earlier.
- **The safety envelope is a discipline, not a mechanism.** Nothing in CI enforces "never check out the
  PR head" — it holds only as long as every future edit to the action respects it. If fork coverage
  turns out not to matter in practice, `pull_request` plus a fork skip is strictly safer.
- **The floor of 4 is a guess.** It is a single named constant with a truth-table test, tuned against
  real PRs in Phase 4.
- **Criterion 1 ships degraded.** PR bodies are effectively empty (22–41 bytes measured), so "does the
  code do what it _claims_" has no claim to test against. The prompt makes this explicit rather than
  letting the model infer intent, but the signal is genuinely weaker.
- **Non-blocking package tests can rot.** A gate nobody must satisfy tends to stay red. Worth tightening
  to blocking once the rubric migration settles.
- **`tool-loop-agent` F2 is unverified** — an undeclared `@ai-sdk/provider-utils` dependency that only
  resolves via npm's flat hoisting. Phase 1's clean CI install is the first environment where this class
  of bug surfaces; if it fires, it must be fixed there.
- **Two AI reviewers on one PR is real noise.** Tolerable while `10x-impl-review-ci` stays label-gated.

## Success Criteria (Summary)

- A PR opened against `main` gets a scored review comment and one verdict label with no human action,
  and further pushes update that comment in place rather than piling up.
- `ai-cr:review` reliably re-runs the review, repeatably — and the action's own label writes never
  re-trigger it.
- `main` CI is green, and the reviewer package is gated by lint, typecheck and build of its own.
