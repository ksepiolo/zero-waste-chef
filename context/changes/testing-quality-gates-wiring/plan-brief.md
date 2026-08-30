# Quality-Gates Wiring — Plan Brief

> Full plan: `context/changes/testing-quality-gates-wiring/plan.md`
> Research: `context/changes/testing-quality-gates-wiring/research.md`

## What & Why

Wire a real, automatic test gate into this project's CI/CD so build and
tests run without a human remembering to run them — the course requirement
— **without standing up any new infrastructure**. Add a blocking unit-test
step to the existing `ci` job, and a hard-failing pre-push hook for
integration tests that reuses the developer's local Supabase.

## Starting Point

`ci.yml`'s `ci` job runs `lint` → `typecheck` → `build`; no test step has
ever existed. `typecheck` turned out to already be gating (landed
2026-08-16) — the actual gap was narrower than the change was opened to
close: only tests were missing. Of the 8 existing test files, 4 need a live
Supabase and silently soft-skip (exit 0) when one isn't reachable — the only
Supabase reachable from CI is production, which the integration suite
(hardcoded fake users, real row mutations) can't safely run against.
Playwright e2e already runs automatically post-deploy via a separate
workflow, and a `PostToolUse` agent hook already runs eslint/typecheck/tests
on every edit — both undocumented in `test-plan.md` §5.

## Desired End State

Every push and PR triggers a real unit-test run in CI, blocking merge (and
the auto-deploy behind it) on failure — no secrets, no database, no Docker.
Every `git push` locally is gated on the full test suite (unit + integration)
actually running against local Supabase, hard-failing with an actionable
message if that instance isn't up, rather than silently skipping. `§5`
Quality Gates table in `test-plan.md` describes exactly this, with no stale
rows.

## Key Decisions Made

| Decision                                        | Choice                                                      | Why (1 sentence)                                                                                                                                                                           | Source |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Provision Supabase in CI for integration tests? | No                                                          | The only Supabase reachable from CI is production; unsafe for a suite that signs in as fake users and mutates rows, and would violate the "no infra to stand up" course requirement anyway | Plan   |
| CI test scope                                   | Unit-only (`test:unit`, new script, `--exclude` glob)       | Zero DB dependency, zero secrets, satisfies "tests run automatically" without infra                                                                                                        | Plan   |
| Integration test coverage                       | Moved to a new local pre-push gate                          | Closest cheap layer that still gives real signal before code leaves the machine                                                                                                            | Plan   |
| Pre-push behavior on unreachable Supabase       | Hard-fail with an actionable message                        | A silently-skipping pre-push gate recreates the exact "green but skipped" trap research flagged for CI                                                                                     | Plan   |
| Pre-push test scope                             | Full suite (`npm run test`), not an integration-only script | Reuses the existing script as-is; unit tests are already fast (well under 1s)                                                                                                              | Plan   |
| E2E timing                                      | Stays post-deploy, non-blocking (unchanged)                 | Pre-deploy e2e would need a preview environment or a locally-booted server + DB — real infrastructure, contradicting the course requirement                                                | Plan   |
| E2E in pre-push?                                | No                                                          | Multi-browser Playwright suite is too slow for a per-push local gate; e2e already runs automatically post-deploy                                                                           | Plan   |
| `test-plan.md` §5 stale rows                    | Corrected in this change (Phase 3)                          | Same table this change's own "unit + integration" row updates; 4 stale facts found during research/planning, cheapest to fix while already in the file                                     | Plan   |

## Scope

**In scope:**

- New `test:unit` npm script + one new step in `.github/workflows/ci.yml`
- New `.husky/pre-push` hook (Supabase reachability check + full test suite)
- Correcting 4 stale rows + adding 1 new row in `test-plan.md` §5

**Out of scope:**

- Provisioning Supabase (Docker/CLI) inside CI
- Wiring integration tests into the CI `ci` job
- Changing `.github/workflows/playwright.yml` or e2e's post-deploy timing
- Adding e2e to the pre-push hook
- A shared TS reachability helper (the bash check duplicates the existing
  pattern by design — see plan's Critical Implementation Details)
- `test-plan.md` §3's Phase 4 Status column (orchestrator-owned)

## Architecture / Approach

Two independent, small changes plus a docs correction, landed in sequence:
CI gate first (the literal ask), then the new local pre-push gate, then
`test-plan.md` §5 rewritten last so it describes the final landed state
rather than an intermediate one.

## Phases at a Glance

| Phase                        | What it delivers                                                      | Key risk                                      |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| 1. CI unit-test gate         | `test:unit` script + `ci.yml` step, blocking                          | None significant — isolated, DB-free change   |
| 2. Pre-push integration gate | `.husky/pre-push`, hard-fail on unreachable Supabase, else full suite | Adds real wall-clock time to every local push |
| 3. Quality-gates docs sync   | `test-plan.md` §5 fully corrected                                     | None — pure documentation                     |

**Prerequisites:** Local Supabase (`npx supabase start`) must be runnable as
today for Phase 2's manual verification.
**Estimated effort:** ~1 session, 3 small phases.

## Open Risks & Assumptions

- The pre-push hook's bash-based Supabase health check duplicates the same
  check already written 4 times in TypeScript — accepted as the cheaper
  option over building a shared helper; revisit if a 6th call site appears.
- Pre-push now adds real time to every push (full suite against local
  Supabase) — accepted per explicit user choice of "full suite" over a
  narrower integration-only script.
- E2e remains a post-deploy check, not a pre-merge gate — a broken flow can
  reach production for a short window before e2e's post-deploy run flags it;
  this was already true before this change and is explicitly not being
  changed here.

## Success Criteria (Summary)

- A push with a broken unit test fails the `ci` job on GitHub Actions.
- A local `git push` is blocked when local Supabase isn't running, with a
  clear instruction to start it; proceeds only when the full suite passes
  against it.
- `test-plan.md` §5 has zero stale rows describing the gate stack.
