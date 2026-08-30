---
date: 2026-08-30T06:21:13Z
researcher: Kasia Sepiolo
git_commit: c372da056c519585175b7a7631590b6979866ac1
branch: feature/testing-quality-gates-wiring-v2
repository: zero-waste-chef
topic: "Rollout Phase 4 grounding — Quality-gates wiring (test-plan.md §3 Phase 4)"
tags: [research, codebase, ci, vitest, astro-check, supabase, quality-gates]
status: complete
last_updated: 2026-08-30
last_updated_by: Kasia Sepiolo
---

# Research: Rollout Phase 4 grounding — Quality-gates wiring

**Date**: 2026-08-30T06:21:13Z
**Researcher**: Kasia Sepiolo
**Git Commit**: c372da056c519585175b7a7631590b6979866ac1
**Branch**: feature/testing-quality-gates-wiring-v2
**Repository**: zero-waste-chef

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md` ("Quality-gates
wiring", cross-cutting on §2 Risks #1–#8). Confirm the current state of the
single `ci` job in `.github/workflows/ci.yml`, confirm `npm run typecheck`
and `npm run test` exist and pass locally, determine whether the
Phase 1–3 integration tests need a running Supabase instance and whether
that's available in the CI runner today, and flag anything §5 Quality Gates
gets wrong about the current gate list.

## Summary

Two of the plan's three "must ground" items check out; the third does not,
and one background assumption in §5 is already stale:

1. **`ci.yml`'s current steps**: `lint` → `typecheck` → `build`, in that
   order, all gating (job fails on any step's non-zero exit). **`typecheck`
   is already wired into CI** — this contradicts §5 Quality Gates, which
   lists typecheck as "required after §3 Phase 4 ... currently ungated."
   It was added in commit `ae5333c` (2026-08-16), predating this change's
   `change.md` (2026-08-30) and even the test-plan's own last-reviewed date
   (2026-08-18). The only thing actually missing from CI today is
   `unit + integration` (vitest).
2. **Scripts pass locally**: `npm run typecheck` → 0 errors, 0 warnings (4
   informational hints). `npm run test` → 8 test files, 117 tests, all
   passing in 352ms.
3. **Database dependency — this is the real risk**: the Phase 1–3
   integration tests (`*.integration.test.ts`) require a _live, locally
   seeded_ Supabase instance and **degrade to a silent `describe.skipIf`
   skip — not a failure — when one isn't reachable**. `.github/workflows/ci.yml`
   has no step anywhere that starts a Supabase instance. The `SUPABASE_URL`/
   `SUPABASE_KEY` secrets that do exist in CI are scoped only to the `build`
   and `deploy` jobs' steps, and (going by `.dev.vars` pointing local dev at
   `http://127.0.0.1:54321` vs. these being GitHub _repository secrets_ used
   at deploy time) almost certainly resolve to the real/hosted project, not
   an ephemeral local instance seeded via `supabase/seed.sql`. That seed file
   inserts fake rows straight into `auth.users` for `test@example.com` /
   `test2@example.com` — something that only makes sense against a local
   throwaway Postgres, never against a hosted project.
   **Consequence**: adding a bare `- run: npm run test` step to the existing
   `ci` job, as the change's stated intent literally describes, produces a
   green CI run that silently skips every integration test (Risk #3, #4,
   #5, #7's actual coverage) while only unit tests execute. That is the
   "wire it in and it just works" trap the task asked to verify — it does
   **not** just work; it needs Phase 4's plan to explicitly decide how CI
   gets a local Supabase instance (most likely: `supabase/setup-cli` +
   `npx supabase start`, which already applies `supabase/migrations/` and
   `supabase/seed.sql` on start, matching what local dev does today) before
   the integration suite can produce real signal in CI rather than a
   rubber-stamp pass.

## Detailed Findings

### `.github/workflows/ci.yml` — current `ci` job

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx astro sync
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run build
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
```

(`.github/workflows/ci.yml:9-25`)

- Steps run sequentially and each gates the next by default GitHub Actions
  behavior (a non-zero exit stops the job) — no `continue-on-error`, no
  `if:` conditionals softening any step.
- `SUPABASE_URL`/`SUPABASE_KEY` are declared only on the `build` step's
  `env:` block, not at job level — so they are **not** automatically
  visible to any new step added after `build` unless explicitly given the
  same `env:` block.
- A separate `deploy` job (`needs: ci`, gated to `push` on `main`) repeats
  `build` with the same secrets and then runs `wrangler-action` to deploy.
  Per `test-plan.md:153-155`, this `ci` job is the _only_ gate standing
  between a merge and that auto-deploy.
- History (`git log -p -- .github/workflows/ci.yml`): the job started as
  `lint` + `build` only (`370e2c5`, initial scaffold), gained the `deploy`
  job (`f56d38c`), then gained `typecheck` (`ae5333c`, 2026-08-16, "feat:
  enhance hooks and CI with type checking and ESLint integration"). No test
  step has ever existed in this file.

### Typecheck and test scripts

- `package.json` scripts (`package.json:8,10`): `"typecheck": "astro check"`,
  `"test": "vitest run"`.
- `npm run typecheck` (`astro check`) against the current tree: **0 errors,
  0 warnings, 4 hints**. Only noise is four `eslint.config.js` deprecation
  warnings about `tseslint.config`'s signature — unrelated to app code, not
  errors.
- `npm run test` (`vitest run`) against the current tree, with local
  Supabase running (see below): **8 test files, 117 tests, all passing**,
  352ms total.

### Database dependency of the integration suite

Eight test files exist under `src/**/*.test.ts` (the glob `vitest.config.ts`
already includes, per `vitest.config.ts:22`):

- Unit-only (no live DB): `product.service.test.ts`, `recipe.service.test.ts`,
  `recipe-prompt.test.ts`, `generate.test.ts` (mocks `@/lib/supabase`
  entirely per §6.3's pattern).
- Integration, live-DB: `recipe.service.approve.integration.test.ts`,
  `products/index.integration.test.ts`, `products/[id].integration.test.ts`,
  `recipes/index.integration.test.ts`.

Every integration file follows the same reachability-guard pattern (worked
example: `src/pages/api/products/index.integration.test.ts:26-44`):

```ts
async function isSupabaseReachable(): Promise<boolean> {
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const supabaseReachable = await isSupabaseReachable();
if (!supabaseReachable) {
  console.log("Skipping ... — local Supabase is not reachable. Run `npx supabase start` to include it.");
}
// ...
describe.skipIf(!supabaseReachable)("...", () => { ... });
```

This is a **soft skip, not a failure** — `vitest run` exits 0 whether or not
these `describe` blocks actually execute. Confirmed locally: with the local
Supabase stack up (`docker ps` shows `supabase_studio_...`,
`supabase_pg_meta_...`, etc., `npx supabase status` reports the stack
running), the test run produced no "Skipping ..." console output, meaning
all four integration files executed for real.

Where the seeded identities these tests sign in as come from:
`supabase/seed.sql:14,42,72,80,107,137` inserts `test@example.com` and
`test2@example.com` directly into `auth.users` with hardcoded UUIDs — this
is exclusively meaningful against a fresh local Postgres brought up by
`supabase/config.toml` + `npx supabase db reset`/`npx supabase start`, never
against a real hosted project (there's no mechanism here to insert
synthetic identities into a production auth schema, and doing so would be
actively wrong even if it were possible).

`.dev.vars` (gitignored, local-only) sets `SUPABASE_URL=http://127.0.0.1:54321`
— the local stack's URL from `supabase/config.toml`'s `[api] port = 54321`
— confirming that locally these tests really do exercise the seeded
instance, not a remote one.

**Gap for CI**: `.github/workflows/ci.yml` has no step that runs
`supabase start`, `supabase db reset`, or any equivalent, and no service
container running Postgres/GoTrue/PostgREST. The only Supabase-shaped
values present in the workflow are the `secrets.SUPABASE_URL` /
`secrets.SUPABASE_KEY` GitHub secrets used by `build` and `deploy` — given
those are real repository secrets consumed at deploy time (not printed
ephemeral output from a CLI command), they almost certainly point at the
real/hosted Supabase project. Even if a future test step were given those
same secrets, the sign-in calls for `test@example.com`/`test2@example.com`
would either fail outright (no such users in the hosted project) or, worse,
succeed against real production data if someone had ever manually created
matching accounts there — neither outcome is "the tests ran against the
local seed" as §4 assumes.

### §5 Quality Gates — accuracy check against current state

| §5 claim                                                                                              | Current reality                                                                                                                                                                                             | Verdict                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typecheck` — "local + CI", "required after §3 Phase 4", "the script exists but is currently ungated" | Already present and gating in `ci.yml` since 2026-08-16 (`ae5333c`), predating even the test-plan's 2026-08-18 review date                                                                                  | **Stale.** Typecheck is not a Phase 4 deliverable — it's already done. Phase 4's actual remaining scope for the gate table is narrower than stated: only `unit + integration` moves from "local, ungated" to "CI, required."                                                                                                                                                   |
| `unit + integration` — "local from §3 Phase 1; CI after §3 Phase 4", "required after §3 Phase 4"      | Correctly describes today's state (local-only) — but the plan's implicit assumption that adding the step alone satisfies the row is not safe, per the database-dependency finding above                     | **Directionally correct, but the "required after Phase 4" framing needs a caveat**: naively wiring the step produces a CI run where the "integration" half of this row is satisfied only in the sense that the job doesn't error — the tests silently don't run. The row should not be marked satisfied until CI actually has a reachable Supabase instance for the test step. |
| lint, build — "required (wired)"                                                                      | Confirmed accurate — both present and gating in `ci.yml`                                                                                                                                                    | Accurate                                                                                                                                                                                                                                                                                                                                                                       |
| e2e on critical flows — "excluded"                                                                    | Table predates Phase 5's landing (`context/archive/2026-08-18-testing-generate-approve-e2e/`, already complete per §3) — Playwright e2e exists and is adopted per §4/§7, but §5's row still says "excluded" | **Stale**, though out of scope for this phase's fix — flagging since it's the same table. Not this phase's job to correct on its own, but Phase 4's implementation should not further calcify this without a note, since it lives in the same document section this phase edits.                                                                                               |

## Code References

- `.github/workflows/ci.yml:9-25` — the single `ci` job: checkout → setup-node
  → `npm ci` → `astro sync` → `lint` → `typecheck` → `build` (secrets scoped
  to the `build` step only).
- `.github/workflows/ci.yml:27-47` — the `deploy` job, gated on `ci` passing
  and push-to-main.
- `package.json:8-10` — `typecheck`, `test`, `test:watch` script definitions.
- `vitest.config.ts:22` — `include: ["src/**/*.test.ts"]`, which already
  matches `*.integration.test.ts` files (no separate include needed).
- `src/pages/api/products/index.integration.test.ts:26-61` — canonical
  reachability-guard + `describe.skipIf` pattern, repeated verbatim in the
  other three integration files.
- `supabase/seed.sql:14,42,72,80,107,137` — hardcoded local-only seeded
  identities (`test@example.com`, `test2@example.com`) that the integration
  suite signs in as.
- `supabase/config.toml` — `[api] port = 54321`, matching `.dev.vars`'s
  `SUPABASE_URL=http://127.0.0.1:54321`.
- `supabase/migrations/` — 4 migration files that a fresh `supabase start`/
  `db reset` would need to apply before the seed and tests are meaningful.

## Architecture Insights

- The soft-skip pattern (`describe.skipIf` + a reachability probe) is a
  deliberate, repeated convention across all four integration files — it
  exists so a developer without Docker running locally doesn't get spurious
  hard failures. That same convention becomes a liability the moment it's
  the only thing standing between "CI enforces integration coverage" and
  "CI silently doesn't." Nothing in the current test files distinguishes
  "Supabase absent because a dev skipped `supabase start`" from "Supabase
  absent because CI never wires it" — both produce the identical console
  line and the identical green exit code.
- CI's only existing Supabase touchpoint (the `build`/`deploy` secrets) is
  environment-scoped to those specific steps, not job-level — so nothing
  about the file's current structure accidentally leaks a working Supabase
  connection into a naively-added test step. Adding a test step without
  deliberately provisioning a local Supabase in CI would reliably reproduce
  the skip behavior on every run, not intermittently.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:29-34` (§1 principle #4) already
  anticipates that a phase might discover it can't proceed on reuse alone:
  "A phase that cannot proceed without new test infrastructure must first
  re-ask: is there a cheaper layer that gives real signal? Building the rig
  is the last resort, not the first move." This finding is exactly that
  fork in the road for Phase 4 — the "cheapest layer" question needs an
  explicit answer in `plan.md` (e.g., is a CI-local Supabase instance
  actually "the rig," or is it "the reuse" since it's the same
  `supabase start` command already used everywhere else in this project?).
- `context/foundation/test-plan.md:114-118` (§3, note above the rollout
  table) already flagged this exact dependency for Phases 2 and 3: "Phases
  2 and 3 depend on the existing local database seed being usable as-is —
  if it is not, §1 principle #4 applies." Phase 4 inherits that same
  dependency one layer up — CI must reproduce what Phases 2/3 assumed was
  available locally.
- `context/changes/testing-data-isolation-input-trust/` (Phase 3, complete)
  is where the `describe.skipIf` + cross-user pattern was established for
  `products/index` and `products/[id]`; `context/changes/testing-approval-contract-integrity/`
  (Phase 2, complete) is the equivalent for `recipe.service.approve.integration.test.ts`.
  Both phases' own research/plan docs are worth a skim if the Phase 4 plan
  needs to understand exactly why these tests are structured to skip rather
  than fail — but neither phase needed CI to run them, only local dev.

## Related Research

- `context/changes/testing-recipe-generation-core/research.md` — Phase 1's
  research, establishing the Vitest+Astro config groundwork this phase's
  `test` step will now execute in CI.
- `context/changes/testing-approval-contract-integrity/` and
  `context/changes/testing-data-isolation-input-trust/` — Phases 2/3,
  origin of the integration test files this research examined.

## Open Questions

- Should Phase 4's plan provision a local Supabase instance inside the `ci`
  job (via `supabase/setup-cli` + `npx supabase start`, matching local dev
  exactly), or should it scope this phase to unit tests only in CI and
  explicitly document integration tests as still local-only until a
  follow-up phase adds the CI-side database? Both are defensible reads of
  §1 principle #4 ("reuse, don't build") — starting the same local stack
  that already exists is arguably reuse, not new infrastructure, but it does
  add real CI runtime (Docker services) that doesn't exist in the workflow
  today.
- Should this phase also correct §5's two stale rows (typecheck already
  wired; e2e already adopted per Phase 5) as a documentation side-effect, or
  leave that to a future `/10x-test-plan --refresh`? The change's own scope
  is "quality-gates wiring," and §5 is the table it's expected to update
  regardless.
