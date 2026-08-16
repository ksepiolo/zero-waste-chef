# Mutation-testing snapshots

Point-in-time Stryker reports, kept as **submission evidence** that the selective
mutation gate ran. Each file is named for the date of the run and is never
overwritten — a new run gets a new dated file.

The live output directory `reports/mutation/` stays gitignored on purpose: it is
regenerated wholesale on every run, and a tracked copy of it would silently go
stale the first time someone edits a mutated module without re-running Stryker.
A dated snapshot cannot lie about being current — its name says when it is from.

## Snapshots

| Snapshot                     | Run date   | Code state                          | Scope                             | Score                                        |
| ---------------------------- | ---------- | ----------------------------------- | --------------------------------- | -------------------------------------------- |
| `mutation-2026-08-15.html`   | 2026-08-15 | `640484f` (= `src/` at `d788d38`)   | `src/lib/services/recipe.service.ts` | 52.68% total / 63.16% covered (205 mutants) |

**Provenance of the 2026-08-15 snapshot.** Generated at 18:26 local from a working
tree whose `src/`, `vitest.config.ts`, `stryker.config.json` and `package.json`
contents landed in `640484f`. Nothing in those paths changed between `640484f` and
`d788d38`, so the report is accurate for the current tip of
`feature/testing-recipe-generation-core`. Verify with:

```bash
git diff --stat 640484f..HEAD -- src vitest.config.ts stryker.config.json package.json
```

An empty result means the snapshot still describes the code you have.

## How it was produced

```bash
npx stryker run --mutate "src/lib/services/recipe.service.ts"
cp reports/mutation/mutation.html docs/mutation/mutation-$(date +%F).html
```

Stryker 10.0.0 with `@stryker-mutator/vitest-runner` 10.0.0, configured by
`stryker.config.json` (`coverageAnalysis: "perTest"`, scope pinned to one file).
Run **ad hoc only** — never in CI and never a commit gate, per `CLAUDE.md` and
`context/foundation/test-plan.md` §5.

## Where the reasoning lives

The report shows *which* mutants survived. Why each one was killed or consciously
accepted is recorded in `context/foundation/test-plan.md` §6.5, which is the
durable record — it survives a Stryker upgrade that would renumber every mutant
in the HTML. Read that first; open the snapshot only for the mutant-level detail.
