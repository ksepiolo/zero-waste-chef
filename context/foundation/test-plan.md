# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-15

## 1. Strategy

Tests follow four non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.
4. **Reuse, don't build.** Every phase reuses what already exists — the
   working `npx supabase db reset` seed and the single `ci` job in
   `.github/workflows/ci.yml`. A phase that cannot proceed without new test
   infrastructure must first re-ask: is there a cheaper layer that gives
   real signal? Building the rig is the last resort, not the first move.
   (Source: Phase 2 interview Q5.)

Hot-spot scope used for likelihood weighting: `src/` (excluding docs,
`context/`, fixtures, and build output). 8 commits in the last 30 days —
enough signal to weight, thin enough that roadmap and interview carry more.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | The generated recipe uses no at-risk product at all — the product silently degrades from a waste-prevention tool into a generic recipe app | High | High | PRD §Success Criteria/Primary #1; roadmap S-04 risk line ("parametry muszą trafić do promptu bez rozmycia priorytetu at-risk"); interview Q1 + Q3; hot-spot dir `src/pages/api/recipes/` — 7 commits/30d |
| 2 | The user is told to cook with a product that is already past its expiry date | High | Medium | Interview Q1 (verbatim: "recipe generation and usage of outdated products"); PRD §Business Logic (the AI receives the *full* inventory; the at-risk window is defined as ≤3 days ahead and says nothing about past-dated items); hot-spot dir `src/lib/services/` — 7 commits/30d |
| 3 | Approval half-succeeds — products are removed but the recipe is never saved, or the reverse | High | Medium | PRD §Guardrails "Inventory consistency"; PRD FR-009; `context/archive/2026-06-05-recipe-generation-loop/change.md` (atomicity delegated to a database routine whose return value was passed on untyped) |
| 4 | A logged-in user reads or deletes another user's products or recipes by constructing an id | High | Medium | PRD §NFR ("…including through direct URL construction or session manipulation"); PRD §Guardrails "Data isolation"; `context/foundation/lessons.md` lesson #1 — a real near-miss in this codebase where RLS alone proved insufficient |
| 5 | The set of products actually removed differs from the set the approval screen listed | High | Low–Med | PRD §Guardrails ("never more, never fewer"); US-01 acceptance criteria #2–#3; compounded by PRD §Non-Goals "no product editing" — a wrongly-removed product must be re-entered by hand |
| 6 | A generation failure (rate limit, timeout, malformed model response) surfaces as success or as an indefinite wait | Medium | High | `context/archive/2026-06-05-recipe-generation-loop/change.md` — 27 s observed end-to-end latency, free-tier model documented as rate-limited with a paid fallback; interview Q1 |
| 7 | The server trusts client-supplied generation parameters — the closed-list contract is bypassed or free text reaches the prompt | Medium | Medium | Roadmap S-04 (in-progress; introduces three client-chosen closed lists); CLAUDE.md convention "validate input with zod"; hot-spot dir `src/pages/api/recipes/` — 7 commits/30d |

Not in the map, deliberately: a provider outage at OpenRouter is high-impact
but low-likelihood and belongs to observability, not to a test. Its
observable half — fail cleanly, never fake success — is carried by Risk #6.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Given an inventory containing at-risk items, the outbound request carries them *flagged*, and a model response containing zero at-risk products is detected rather than passed through as a valid recipe | "The prompt says to prioritize, therefore it does." Prompt text is not a guarantee — the guarantee is what happens to a response that ignores it | Where at-risk marking is computed, what the outbound payload actually contains, and whether any post-response check exists today | Unit (at-risk marking + prompt assembly) plus integration with the model boundary stubbed | Asserting on live model output — flaky, and it takes its oracle from the model instead of from the requirement |
| #2 | A past-dated product produces defined, non-silent behavior — it is either excluded or explicitly marked as expired, never presented to the model as ordinary stock | "The 3-day window bounds both ends." Verify whether the day-delta can go negative and what the branch does when it does | Whether expiry deltas can be negative, and whether "expired" exists as a state distinct from "at-risk" anywhere today | Unit, table-driven over boundary dates (−1, 0, +1, +3, +4) with a frozen clock | Testing only future dates; leaving "today" and timezone boundaries untested |
| #3 | A forced failure on the second write leaves *neither* effect committed — inventory unchanged and no orphan recipe row | "It returned 200, so both writes landed." And: "the routine is atomic, so there is nothing to test" — the call site can still misread its result | The transaction boundary, what the routine returns on failure, and how the endpoint interprets that value | Integration against the existing local seed | Mocking the database — the atomicity guarantee *is* the database; a mock only asserts your own assumption |
| #4 | A second authenticated user requesting or deleting the first user's row id is denied, and no row is mutated | "RLS is enabled, so we are covered." `lessons.md` records exactly this being false here | Which service functions chain a `user_id` filter and which rely on RLS alone; what an unauthorized request actually returns | Integration with two seeded users against the real endpoints | Testing with a single user; asserting the status code without checking that the row survived |
| #5 | The set returned in the approval payload and the set deleted on confirm are provably the same set — across duplicates, stale ids, and ids removed between generate and approve | "The client sends back what we sent it." The client is untrusted; a stale or edited id list must not widen the deletion | Whether the approve endpoint re-derives the set server-side or accepts a client-supplied list | Integration on the approve endpoint | Asserting only the count; comparing the two lists in an order-dependent way |
| #6 | Rate limit, timeout, and malformed response each produce a distinct non-2xx with a clean user-facing message — no fabricated recipe, and no provider key or raw upstream error body in the response | "The final status was 200, so the retry worked." Also verify that no provider credential or raw upstream body leaks into the client response | The error-translation path from the provider call to the HTTP response | Integration with the provider boundary stubbed to fail each way | Only exercising the happy path; snapshotting the error string without asserting the *class* of failure |
| #7 | Out-of-list, missing, oversized, and free-text parameter values are rejected at the boundary and never reach the prompt | "The dropdown only offers valid values." The endpoint is reachable without the dropdown | The validation schema for the generation endpoint and the point where parameters enter the prompt | Unit on the validation schema plus one integration test posting a crafted body | Testing the schema in isolation while the endpoint never calls it |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Runner bootstrap + recipe-generation core | Prove expiry and at-risk state is computed correctly, reaches the model request, and that failures fail loudly | #1, #2, #6 | unit + integration (model boundary stubbed) | change opened | `context/changes/testing-recipe-generation-core/` |
| 2 | Approval contract integrity | Prove approval is all-or-nothing and removes exactly the set it displayed | #3, #5 | integration | not started | — |
| 3 | Data isolation and input trust | Prove a second user cannot reach the first user's rows, and that crafted input is rejected at the boundary | #4, #7 | integration + unit | not started | — |
| 4 | Quality-gates wiring | Lock the floor in the existing CI job | cross-cutting | gates | not started | — |

Phase 1 must land first: there is no test runner in this project today, so
no other phase can produce a signal until it exists. Phases 2 and 3 depend
on the existing local database seed being usable as-is — if it is not,
§1 principle #4 applies and the phase drops to the cheapest honest layer
rather than building a rig.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | 4.1.10 (latest at 2026-08-15 — pin in Phase 1) | none yet — see §3 Phase 1. Configure via `getViteConfig()` from `astro/config`; Astro 6 requires `environment: 'node'` for anything rendering Astro components |
| API / provider mocking | none — stub at the module boundary | n/a | §1 principle #4: no MSW or dedicated mock server unless a phase proves the module boundary insufficient |
| database for integration | existing local Supabase seed (`npx supabase db reset`) | n/a | Reused, not built. Yields a working `test@example.com` login per `context/archive/2026-06-05-recipe-generation-loop/change.md` |
| e2e | none — excluded | n/a | Deliberate. See §7 |
| accessibility | none — excluded | n/a | Deliberate; follows from the UI exclusion. See §7 |
| AI-native | none | n/a | No AI-native layer in this rollout. See §7 for the revisit trigger |

**Stack grounding tools (current session):**

- Docs: Context7 — verified Astro 6 official testing guidance (`getViteConfig()` integration, the v6 requirement that Astro-component tests run in the `node` environment, the experimental Container API, and Playwright as the recommended e2e path); checked: 2026-08-15
- Search: Exa.ai — available, not needed; the official Astro guidance answered the stack question directly; checked: 2026-08-15
- Runtime/browser: no Playwright MCP in session. A `claude-in-chrome` skill exists but is not used — browser-driven testing is excluded per §7; checked: 2026-08-15
- Provider/platform: no GitHub, Supabase, or Cloudflare MCP in session. GitHub is reachable via the `gh` CLI; the Supabase CLI is a devDependency. Both are sufficient for the Phase 4 gates work; checked: 2026-08-15

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned. Note that deploy currently
auto-fires on every push to `main` once CI passes — the gate set below is
the only thing standing between a merge and production.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint | local + CI | required (wired) | syntactic drift, lint-rule violations |
| build | CI | required (wired) | build-breaking and configuration errors |
| typecheck | local + CI | required after §3 Phase 4 | type drift — the script exists but is currently ungated |
| unit + integration | local from §3 Phase 1; CI after §3 Phase 4 | required after §3 Phase 4 | logic regressions on the risks in §2 |
| e2e on critical flows | — | excluded | Would catch broken critical user paths end-to-end. Deliberately not adopted (§7); the accepted consequence is that no gate exercises the browser-side of the approval flow |
| post-edit hook | local (agent loop) | optional | regressions at edit time. Not configured by this rollout |
| pre-prod smoke | between merge and prod | optional | environment-specific failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (pattern for date-boundary and at-risk/expired
  classification tests under a frozen clock).

### 6.2 Adding an integration test

- TBD — see §3 Phase 1 (pattern for exercising an endpoint with the model
  provider stubbed at the module boundary).

### 6.3 Adding a test for a new API endpoint

- TBD — see §3 Phase 1 (request → response shape plus side-effect
  assertion), extended by §3 Phase 3 for the ownership-denial pattern.

### 6.4 Adding a test that touches the database

- TBD — see §3 Phase 2 (pattern for asserting all-or-nothing writes and
  set-identity against the existing local seed).

### 6.5 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a two- to
three-line note here capturing anything surprising the phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **User interface, rendering, and look and feel** — no component tests, no
  snapshots, no visual diffing, no browser-driven e2e. This also covers the
  vendored components under `src/components/ui/`, whose upstream project is
  the test. Accepted consequence: a regression that breaks only the at-risk
  *highlight* on the home screen — the PRD's Secondary success criterion —
  will ship uncaught; the at-risk *computation* behind it is covered by §3
  Phase 1 instead. Re-evaluate if a rendering bug reaches a user.
  (Source: Phase 2 interview Q5.)
- **Configuration as a test subject** — no tests asserting the contents of
  the Astro config, the Worker config, the environment schema, or CI
  definitions. The build gate already fails on a broken configuration.
  Re-evaluate if a configuration error reaches production despite a green
  build. (Source: Phase 2 interview Q5.)
- **Test infrastructure beyond the minimum** — no fixture factories, no
  custom test DSL, no coverage thresholds, no CI matrix, no containerized
  test rigs. A phase that appears to need one should re-ask whether a
  cheaper layer gives real signal. Re-evaluate if the same setup code is
  hand-copied into a third test file. (Source: Phase 2 interview Q5, and
  §1 principle #4.)
- **Third-party internals and live model calls** — the authentication
  provider owns password handling and session issuance; we test that our
  routes enforce authentication, not that the provider implements it. Live
  model calls never run in CI: they are rate-limited, slow (27 s observed),
  and take their oracle from the model. Re-evaluate if a provider upgrade
  changes a contract we depend on. (Source: Phase 2 interview Q5.)
- **AI-native recipe-plausibility judging** — an offline judge over recorded
  generations was considered for the "common home-cooking techniques" NFR
  and dropped: it requires a recording harness, a fixture corpus, and a
  judge prompt before producing a single signal, which is precisely the
  infrastructure investment ruled out above. Re-evaluate if recipe quality
  becomes a reported user complaint rather than a hypothetical.
  (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-15
- Stack versions last verified: 2026-08-15
- AI-native tool references last verified: 2026-08-15

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
