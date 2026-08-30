# Quality-Gates Wiring Implementation Plan

## Overview

Wire a real, blocking unit-test gate into the existing CI `ci` job with zero
new infrastructure, add a hard-failing pre-push gate for integration tests
that reuses the developer's already-running local Supabase, and correct the
four stale facts discovered in `test-plan.md` §5's Quality Gates table.

## Current State Analysis

- `.github/workflows/ci.yml`'s `ci` job runs `lint` → `typecheck` → `build`.
  No test step has ever existed in this file. `typecheck` is already gating
  (landed 2026-08-16, `ae5333c`) — contrary to §5, which still calls it
  "ungated."
- 8 test files exist under `src/**/*.test.ts`: 4 unit-only (mock
  `@/lib/supabase` entirely, no DB needed) and 4 `*.integration.test.ts`
  (need a reachable Supabase; soft-skip via `describe.skipIf` when one isn't
  found, exiting 0 either way).
- The only Supabase reachable from CI (`secrets.SUPABASE_URL`/`SUPABASE_KEY`,
  scoped to the `build` step) is the real/hosted production project — unsafe
  for a suite that signs in as hardcoded fake users
  (`test@example.com`/`test2@example.com`, from `supabase/seed.sql`) and
  mutates rows. Wiring integration tests into CI against it is out of scope
  for this phase; confirmed with the user (2026-08-30).
- `.github/workflows/playwright.yml` already runs the full Playwright e2e
  suite automatically, triggered via `workflow_run` after `CI` succeeds on
  `main` — i.e. **after** `deploy` has already shipped. It uses dedicated
  `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` secrets against the live deployed URL,
  not the local seed. No infrastructure stood up; §5 currently marks this row
  "excluded," which is stale — it runs, just non-blocking.
- `.claude/settings.json` already configures a `PostToolUse` hook (eslint
  --fix, typecheck, `vitest related`) on every `Write|Edit`. §5's
  `post-edit hook` row says "not configured," which is also stale.
- `.husky/pre-commit` exists (`lint-staged` + `npm run typecheck`, no
  shebang, `set -e`, mode `755`) — this is the template this plan's new
  `.husky/pre-push` follows. No `.husky/pre-push` exists today.
- `vitest.config.ts:24` sets `include: ["src/**/*.test.ts"]`, which already
  matches `*.integration.test.ts` files — there is no separate include glob
  to change, only an exclude to add for the new unit-only script.

## Desired End State

- `ci.yml`'s `ci` job gates on a real unit-test run (`test:unit`, 4 files,
  zero DB dependency) alongside lint/typecheck/build — verifiable by
  deliberately breaking a unit test on a branch and observing the `ci` job
  go red on GitHub Actions.
- A new `.husky/pre-push` hook hard-fails a `git push` with an actionable
  message when local Supabase isn't reachable, and otherwise runs the full
  local suite (`npm run test`, unit + integration), blocking the push on any
  real test failure — verifiable by toggling `npx supabase start`/`stop` and
  observing the hook's behavior change accordingly.
- `test-plan.md` §5 accurately describes every gate layer that actually
  exists today (typecheck, unit, integration, e2e, post-edit hook, pre-push),
  with no stale rows.

### Key Discoveries:

- `.github/workflows/ci.yml:9-25` — current `ci` job steps and their order;
  secrets scoped only to the `build` step's `env:` block, so nothing new
  added after it inherits them automatically.
- `src/pages/api/products/index.integration.test.ts:26-44` — the
  `isSupabaseReachable()` + `describe.skipIf` pattern, repeated verbatim
  across all 4 integration files; probes `${SUPABASE_URL}/auth/v1/health`.
  `.husky/pre-push`'s new reachability check mirrors this same endpoint in
  bash rather than adding a shared TS helper (see Critical Implementation
  Details).
- `supabase/config.toml` — local API port `54321`, matching `.dev.vars`'s
  `SUPABASE_URL=http://127.0.0.1:54321` — the default the pre-push hook
  falls back to when `$SUPABASE_URL` isn't set in the shell.
- Context7 (`/vitest-dev/vitest/v4.1.6`, checked 2026-08-30): the CLI
  `--exclude` flag is **additive** to the config's `exclude` array, not a
  replacement — confirmed safe to add `--exclude "**/*.integration.test.ts"`
  to a `vitest run` invocation without needing to touch `vitest.config.ts`.
- `.github/workflows/playwright.yml:1-6` — triggers via
  `workflow_run: { workflows: [CI], types: [completed], branches: [main] }`
  with `if: github.event.workflow_run.conclusion == 'success'` — fires after
  the whole `CI` workflow run concludes, which includes `deploy` (gated on
  `needs: ci`) having already deployed. E2e is a post-deploy check, not a
  pre-deploy gate; confirmed as an intentional, unchanged design in this
  plan (2026-08-30 conversation).

## What We're NOT Doing

- Not provisioning any Supabase instance (Docker, `supabase/setup-cli`,
  service containers) inside CI. The only hosted Supabase reachable from CI
  is production; running the integration suite's fake-user sign-ins and row
  mutations against it is unsafe and explicitly out of scope.
- Not wiring integration tests into the CI `ci` job at all — they stay
  local-only, gated instead by the new pre-push hook.
- Not changing `.github/workflows/playwright.yml` or moving e2e to run
  pre-deploy — confirmed to stay post-deploy, non-blocking, as-is.
- Not adding e2e tests to the new pre-push hook — only integration tests,
  per explicit scope decision (multi-browser e2e pre-push was assessed as
  too slow for a per-push gate).
- Not building a shared reachability-check helper (TS or otherwise) used by
  both the test files and the new hook — the pre-push check is a
  self-contained `curl` call in bash; see Critical Implementation Details.
- Not adding coverage thresholds, a CI test matrix, or any other test
  infrastructure beyond the two new steps described here (per `test-plan.md`
  §1 principle #4 and §7).
- Not touching `test-plan.md` §3's Phase 4 Status column — that's the
  rollout orchestrator's field, not this plan's.

## Implementation Approach

Two small, independent code changes (a CI step, a git hook) plus one
documentation correction. Order: land the CI gate first (Phase 1, the
literal "wire it into CI" ask), then the pre-push gate (Phase 2, net-new
local gate), then sync the docs last (Phase 3) so §5 can describe the final,
landed state rather than an intermediate one.

## Critical Implementation Details

**Vitest `--exclude` is additive, not a replacement.** Passing
`--exclude "**/*.integration.test.ts"` on the CLI adds to
`vitest.config.ts`'s existing `exclude` array rather than overriding it —
confirmed via Context7 against Vitest 4.1.6 docs. This is why `test:unit` is
a one-line script addition with no `vitest.config.ts` change required.

**Pre-push reachability check duplicates existing logic by design, in a
different language.** All 4 integration test files already probe
`${SUPABASE_URL}/auth/v1/health` in TypeScript before running
(`isSupabaseReachable()`). The new `.husky/pre-push` hook re-implements the
same one-line health check in bash (`curl`) rather than extracting a shared
helper — a git hook can't cheaply import a TS module before Node/Vitest has
even started, and `test-plan.md` §7 explicitly rules out new test
infrastructure beyond the minimum. The duplication is accepted as the
cheaper option; if a 6th call site appears, that calculus should be
revisited.

## Phase 1: CI unit-test gate

### Overview

Add a `test:unit` script that runs only the 4 DB-independent test files, and
wire it into `ci.yml` as a new, blocking step — no secrets, no database, no
new CI infrastructure.

### Changes Required:

#### 1. `package.json`

**Intent**: Add a script that runs the unit-only subset of the test suite,
for use by CI (and available for local ad-hoc use).

**Contract**: New script alongside the existing `test`/`test:watch` entries:
`"test:unit": "vitest run --exclude \"**/*.integration.test.ts\""`. Add it
to `lint-staged`'s existing entries only if this phase's manual testing
shows it's useful there — default is no change to `lint-staged` (it already
runs `vitest related --run` on staged files, which is a different, narrower
mechanism).

#### 2. `.github/workflows/ci.yml`

**Intent**: Make the `ci` job actually execute the unit suite and fail the
job (blocking merge and the downstream `deploy` job, since `deploy` has
`needs: ci`) if any unit test fails.

**Contract**: Insert a new step `- run: npm run test:unit` into the `ci`
job's `steps:` list, positioned after `- run: npm run typecheck` and before
`- run: npm run build` (fail-fast ordering: fastest, most-independent checks
first). No `env:` block needed — this step touches no Supabase client.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` exits 0 locally, and its output confirms exactly 4
  test files ran (no `*.integration.test.ts` file, no "Skipping..." lines)
- `npm run typecheck` still passes
- `npm run lint` still passes
- `.github/workflows/ci.yml` remains valid YAML (e.g.
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
  or `actionlint .github/workflows/ci.yml` if available)

#### Manual Verification:

- Push a branch (or open a PR) and confirm the `ci` job on GitHub Actions
  shows the new `test:unit` step running and passing
- Deliberately break one assertion in a unit test file on a scratch branch,
  push, confirm the `ci` job goes red on that step specifically, then revert
- Confirm the `deploy` job still only fires after the full `ci` job
  (including the new step) passes

---

## Phase 2: Pre-push integration gate

### Overview

Add a `.husky/pre-push` hook that hard-fails with an actionable message when
local Supabase isn't reachable, and otherwise runs the full local suite
(unit + integration) before allowing a `git push` to proceed.

### Changes Required:

#### 1. `.husky/pre-push` (new file)

**Intent**: Give the developer a local, pre-push gate for integration test
coverage — the layer that cannot exist in CI per Phase 1's scope decision —
without silently no-oping the way `describe.skipIf` does for an ad-hoc
`npm run test`.

**Contract**: New executable file (mode `755`, no shebang line — matches
`.husky/pre-commit`'s existing format exactly), `set -e` as the first line.
Logic: check `${SUPABASE_URL:-http://127.0.0.1:54321}/auth/v1/health` via
`curl -sf` with a short timeout; on failure, `echo` a message telling the
developer to run `npx supabase start` and `exit 1`; on success, run
`npm run test` (the existing full-suite script — no new script needed here,
unlike Phase 1's unit-only scope).

```sh
set -e

SUPABASE_HEALTH_URL="${SUPABASE_URL:-http://127.0.0.1:54321}/auth/v1/health"

if ! curl -sf --max-time 2 "$SUPABASE_HEALTH_URL" > /dev/null; then
  echo "Pre-push requires local Supabase for integration tests. Run: npx supabase start"
  exit 1
fi

npm run test
```

### Success Criteria:

#### Automated Verification:

- `test -x .husky/pre-push` (file is executable)
- `sh -n .husky/pre-push` (script parses as valid POSIX shell)

#### Manual Verification:

- With local Supabase stopped (`npx supabase stop`): attempt `git push`,
  confirm it's blocked with the "Run: npx supabase start" message before any
  tests execute
- With local Supabase running (`npx supabase start`): attempt `git push`,
  confirm the full suite runs (unit + integration, all executing for real —
  no "Skipping..." lines) and the push proceeds when everything passes
- With local Supabase running and one integration test assertion
  deliberately broken: attempt `git push`, confirm it's blocked, then revert
  the deliberate breakage

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to Phase 3.

---

## Phase 3: Quality-gates documentation sync

### Overview

Correct `test-plan.md` §5's Quality Gates table so every row matches the
gate layers that actually exist after Phases 1–2 land — fixing the four
stale facts discovered during this change's research and planning
conversation, and adding the new pre-push row.

### Changes Required:

#### 1. `context/foundation/test-plan.md` §5 Quality Gates table

**Intent**: Bring every row of the table in line with reality: typecheck's
already-wired status, the unit/integration split (only unit is CI-gated),
e2e's actual automated-but-non-blocking post-deploy behavior, the post-edit
hook's actual configuration, and the new pre-push gate.

**Contract**: Rewrite the table at `test-plan.md:157-165`:

- `typecheck` row: `Required?` → `required (wired)`; `Catches` note updated
  to state it has been gating since 2026-08-16, predating this phase.
- Replace the single `unit + integration` row with two rows:
  - `unit`: `Where` → `local (pre-commit, post-edit, via vitest related) +
CI (full unit suite, §3 Phase 4)`; `Required?` → `required (wired)`.
  - `integration`: `Where` → `local only (pre-push, §3 Phase 4)`;
    `Required?` → `required locally; not CI-gated`; `Catches` note explains
    why (CI's only reachable Supabase is production, unsafe for the seeded
    fake-user suite).
- `e2e on critical flows` row: `Required?` → `automated, non-blocking
(post-deploy)`; `Catches` note updated to describe
  `.github/workflows/playwright.yml`'s actual `workflow_run`-after-`CI`
  trigger and that it runs after `deploy`, not before.
- `post-edit hook` row: `Required?` → `required (wired)`; `Catches` note
  updated to list the actual configured steps (eslint --fix, typecheck,
  vitest related) from `.claude/settings.json`.
- Add a new `pre-push` row: `Where` → `local`; `Required?` → `required after
§3 Phase 4`; `Catches` → integration-test regressions before they leave
  the machine; hard-fails rather than silently skipping when Supabase isn't
  reachable.
- Update the `> Last updated:` line near the top of the file to today's
  date.

### Success Criteria:

#### Automated Verification:

- `npx prettier --check context/foundation/test-plan.md` passes (table
  formatting stays valid Markdown)

#### Manual Verification:

- Read the rewritten §5 table top to bottom and confirm every row matches
  the actual, landed behavior from Phases 1–2 with no remaining stale claims

---

## Testing Strategy

### Unit Tests:

- No new unit tests are written by this change — it wires existing tests
  into new gate layers, it doesn't add test coverage for a new risk.

### Integration Tests:

- Same — existing 4 integration files gain a new local gate (pre-push);
  none are added or modified.

### Manual Testing Steps:

1. Push a branch with the Phase 1 changes and confirm `test:unit` runs and
   passes in the `ci` job on GitHub Actions.
2. Deliberately break a unit test, push, confirm `ci` fails on the
   `test:unit` step; revert.
3. Stop local Supabase, attempt `git push`, confirm the Phase 2 hook blocks
   it with the actionable message.
4. Start local Supabase, attempt `git push` again, confirm the full suite
   runs for real (no skip messages) and the push proceeds.
5. Break an integration test assertion, attempt `git push`, confirm it's
   blocked; revert.
6. Read the final `test-plan.md` §5 table and confirm no stale rows remain.

## Performance Considerations

- `test:unit`'s 4 files ran in well under 1 second in `npm run test`'s
  352 ms total for all 8 files (per research.md) — negligible CI time added.
- The pre-push hook adds real local wall-clock time per push: a fast `curl`
  health check, then the full suite (unit + integration) against local
  Supabase. This is accepted as the cost of real signal before code leaves
  the machine, consistent with the user's explicit choice of "full suite"
  over an integration-only script in the 2026-08-30 conversation.

## Migration Notes

Not applicable — no data model or schema changes in this phase.

## References

- Related research: `context/changes/testing-quality-gates-wiring/research.md`
- Existing hook pattern: `.husky/pre-commit`
- Existing reachability-guard pattern:
  `src/pages/api/products/index.integration.test.ts:26-44`
- e2e workflow (unchanged by this plan): `.github/workflows/playwright.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CI unit-test gate

#### Automated

- [x] 1.1 `npm run test:unit` exits 0, exactly 4 files ran — 7cb1644
- [x] 1.2 `npm run typecheck` passes — 7cb1644
- [x] 1.3 `npm run lint` passes — 7cb1644
- [x] 1.4 `.github/workflows/ci.yml` is valid YAML — 7cb1644

#### Manual

- [x] 1.5 `test:unit` step runs and passes on GitHub Actions — 7cb1644
- [x] 1.6 Deliberately-broken unit test fails the `ci` job, then reverted — 7cb1644
- [x] 1.7 `deploy` job still only fires after full `ci` job passes — 7cb1644

### Phase 2: Pre-push integration gate

#### Automated

- [x] 2.1 `.husky/pre-push` is executable — 1ca031b
- [x] 2.2 `.husky/pre-push` parses as valid POSIX shell — 1ca031b

#### Manual

- [x] 2.3 Push blocked with actionable message when Supabase is stopped — 1ca031b
- [x] 2.4 Push runs full suite for real (no skip lines) when Supabase is up — 1ca031b
- [x] 2.5 Push blocked on a deliberately-broken integration test, then
      reverted — 1ca031b

### Phase 3: Quality-gates documentation sync

#### Automated

- [x] 3.1 `npx prettier --check context/foundation/test-plan.md` passes — 0b3fc33

#### Manual

- [x] 3.2 §5 table reviewed top to bottom, no stale rows remain — 0b3fc33
