# Runner Bootstrap + Recipe-Generation Core Tests — Plan Brief

> Full plan: `context/changes/testing-recipe-generation-core/plan.md`
> Research: `context/changes/testing-recipe-generation-core/research.md`

## What & Why

Test-plan §3 Phase 1. This project has no test runner at all, so no rollout phase can
produce a signal until one exists. Once it does, the phase pins **Risk #1** — the
generated recipe must never silently stop using at-risk products — and the half of
**Risk #6** the code already satisfies: a generation failure must fail loudly and
bounded, never as success, an indefinite wait, or a leak of the provider key or raw
upstream body.

## Starting Point

Zero test infrastructure: no config, no `*.test.ts`, no test dependency, no script. CI
runs lint + build only. Risk #1 is already structurally protected by three mechanisms in
`recipe.service.ts` — an at-risk-first sort before the 25-product cap, an ID cross-check,
and an explicit at-risk floor guard — and **none of them is verified**. The sort ordering
in particular is the whole guarantee, and a refactor that slices first would reintroduce
the risk in full, silently. Risk #6 is half-handled: the API key and quota-bearing
upstream body genuinely never reach the client, but ten failure classes collapse to one
HTTP 500 and three return raw internal text.

## Desired End State

`npm test` runs a hermetic colocated Vitest suite that goes red if the at-risk sort stops
preceding the cap, if a model response ignoring every at-risk product is passed through,
if the system prompt drifts from its shipped wording, if a product name can forge a
prompt section header, or if any provider failure yields a 2xx, a recipe payload, or a
leaked credential. The test plan's cookbook stops saying "TBD."

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Risk #2 (expired stock) | Out of scope | Already split to `expired-product-handling`; it needs new product behaviour, not coverage | Research |
| Risk #6 unmet half | Deferred, folded into `expired-product-handling` | Tests against its oracle would be red until the code changes; splitting keeps this a genuine test-rollout phase | Plan |
| Assertions on failure status | Assert **non-2xx**, never `500` | Pinning 500 would mirror behaviour the test plan calls wrong and break when the deferred fix lands | Plan |
| Test file layout | Colocated `*.test.ts` | Matches CLAUDE.md's kebab-case dot-suffix rule; inherited by Phases 1b/2/3 | Plan |
| Determinism | `TZ=UTC` in config + `vi.setSystemTime` per boundary test | Kills both flake sources and matches production's UTC `workerd` | Plan + Research |
| TZ drift in `isAtRisk` | Not tested | Real but unreachable in production; testing it pins behaviour the product does not depend on | Research |
| Prompt oracle | Pre-parameter literal from `git show d137c98^` | An oracle from history rather than from the implementation — verified byte-identical during planning | Research |
| Executor | Mixed: `/10x-implement` for phases 1 and 5, `/10x-tdd` for 2–4 | CLAUDE.md's rule — TDD only where the first red test is nameable in one sentence | Plan |
| Mutation testing | Stryker, one file, ad hoc | Coverage cannot prove a test would catch the sort-before-slice removal | Plan |

## Scope

**In scope:** Vitest bootstrap and conventions; at-risk boundary table (upper bound only);
system-prompt byte identity and contradiction-freedom; at-risk survival across the cap;
two-branch user-turn structure; `sanitizeName` injection defence; both post-response
guardrails; provider failure translation; no-leak assertions; endpoint non-2xx contract;
unparseable-body tolerance; Stryker gate; test-plan cookbook and status.

**Out of scope:** the `isAtRisk` lower bound and any `expired` state; HTTP status
differentiation and message hygiene; negative expiry offsets; CI wiring (§3 Phase 4); TZ
drift; UI, component, snapshot and e2e tests; live model calls; fixture factories and
coverage thresholds.

## Architecture / Approach

Vitest configured through `getViteConfig()` from `astro/config`, which registers the
`astroEnv` virtual-module plugin — so `recipe.service.ts` imports `astro:env/server`
unmocked. Two stub boundaries only, both at the module edge per test-plan §4:
`vi.stubGlobal("fetch")` for OpenRouter, `vi.mock("@/lib/supabase")` for inventory reads.
Endpoint tests call the exported `POST` directly with a fake `APIContext`. No database in
this phase.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Vitest bootstrap | Runner, config, scripts, smoke test | `getViteConfig()`'s two-argument form is easy to get wrong and fails silently |
| 2. Classification & prompt rules | Boundary table, byte identity, prompt invariants | Asserting negative offsets by reflex, colliding with Phase 1b's oracle |
| 3. Outbound payload & guardrails | At-risk survival, section structure, injection, both guards | Pinning the cap number instead of the survival property |
| 4. Failure never fakes success | Failure translation, no-leak, endpoint contract | Reflexively asserting `500` and writing a mirror test |
| 5. Mutation gate & handoff | Stryker run, cookbook, Phase 1b handoff | Chasing mutation score instead of judging each survivor |

**Prerequisites:** Node 22.14.0; network access for `npm install`; no database or provider
credentials needed.
**Estimated effort:** ~2–3 sessions across five phases; Phase 3 is the largest.

## Open Risks & Assumptions

- Vitest `4.1.10` under Astro `6.3.1` / Vite `7.3.3` is verified by version compatibility,
  not by a run — Phase 1's smoke test is the first real proof.
- ESLint's `strictTypeChecked` with `projectService: true` covers test files; the fake
  `APIContext` will need one scoped, commented cast. If this spreads past one helper,
  test-plan §7's "third file" trigger has fired.
- Folding Risk #6 into `expired-product-handling` gives that change two independent red-test
  sequences. If it proves unwieldy there, the error contract should be split into its own
  change rather than rushed.
- `AbortSignal.timeout` behaviour under `workerd` remains unverified (research Open
  Question 1). Hermetic tests assert the Node shape; a `wrangler dev` probe would settle it.

## Success Criteria (Summary)

- `npm test` exists, runs green, and needs no database, network, or credentials.
- Breaking the sort-before-slice ordering or removing the at-risk floor guard turns the
  suite red — verified by hand, not assumed.
- No test asserts a status code or message string that the deferred Risk #6 work will change.
