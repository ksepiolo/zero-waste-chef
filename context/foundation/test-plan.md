# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-18

## 1. Strategy

Tests follow four non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
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
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                        | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The generated recipe uses no at-risk product at all — the product silently degrades from a waste-prevention tool into a generic recipe app                                                                     | High   | High       | PRD §Success Criteria/Primary #1; roadmap S-04 risk line ("parametry muszą trafić do promptu bez rozmycia priorytetu at-risk"); interview Q1 + Q3; hot-spot dir `src/pages/api/recipes/` — 7 commits/30d                                                                                                                                                                                                                                  |
| 2   | The user is told to cook with a product that is already past its expiry date                                                                                                                                   | High   | Medium     | Interview Q1 (verbatim: "recipe generation and usage of outdated products"); PRD §Business Logic (the AI receives the _full_ inventory; the at-risk window is defined as ≤3 days ahead and says nothing about past-dated items); hot-spot dir `src/lib/services/` — 7 commits/30d                                                                                                                                                         |
| 3   | Approval half-succeeds — products are removed but the recipe is never saved, or the reverse                                                                                                                    | High   | Medium     | PRD §Guardrails "Inventory consistency"; PRD FR-009; `context/archive/2026-06-05-recipe-generation-loop/change.md` (atomicity delegated to a database routine whose return value was passed on untyped)                                                                                                                                                                                                                                   |
| 4   | A logged-in user reads or deletes another user's products or recipes by constructing an id                                                                                                                     | High   | Medium     | PRD §NFR ("…including through direct URL construction or session manipulation"); PRD §Guardrails "Data isolation"; `context/foundation/lessons.md` lesson #1 — a real near-miss in this codebase where RLS alone proved insufficient                                                                                                                                                                                                      |
| 5   | The set of products actually removed differs from the set the approval screen listed                                                                                                                           | High   | Low–Med    | PRD §Guardrails ("never more, never fewer"); US-01 acceptance criteria #2–#3; compounded by PRD §Non-Goals "no product editing" — a wrongly-removed product must be re-entered by hand                                                                                                                                                                                                                                                    |
| 6   | A generation failure (rate limit, timeout, malformed model response) surfaces as success or as an indefinite wait                                                                                              | Medium | High       | `context/archive/2026-06-05-recipe-generation-loop/change.md` — 27 s observed end-to-end latency, free-tier model documented as rate-limited with a paid fallback; interview Q1                                                                                                                                                                                                                                                           |
| 7   | The server trusts client-supplied generation parameters — the closed-list contract is bypassed or free text reaches the prompt                                                                                 | Medium | Medium     | Roadmap S-04 (in-progress; introduces three client-chosen closed lists); CLAUDE.md convention "validate input with zod"; hot-spot dir `src/pages/api/recipes/` — 7 commits/30d                                                                                                                                                                                                                                                            |
| 8   | The generate→approve→removal loop's UI wiring diverges from its API contract (a control wired to the wrong endpoint, a param lost between form and request, or a success state shown despite a failed removal) | High   | Medium     | User concern (top e2e worry — the generate→approve→removal loop breaking end-to-end; secondary concern over auth/data isolation); PRD north-star / roadmap.md:24 S-02; existing integration tests call POST/GET directly per §6.3, bypassing the DOM entirely — this failure class is currently invisible to the suite; `tests/seed.spec.ts` proves the e2e layer is adopted for a different flow (inventory add/reload) but not this one |

Not in the map, deliberately: a provider outage at OpenRouter is high-impact
but low-likelihood and belongs to observability, not to a test. Its
observable half — fail cleanly, never fake success — is carried by Risk #6.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                   | Must challenge                                                                                                                                                                                                                  | Context `/10x-research` must ground                                                                                                                                                                                                 | Likely cheapest layer                                                                          | Anti-pattern to avoid                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| #1   | Given an inventory containing at-risk items, the outbound request carries them _flagged_, and a model response containing zero at-risk products is detected rather than passed through as a valid recipe                      | "The prompt says to prioritize, therefore it does." Prompt text is not a guarantee — the guarantee is what happens to a response that ignores it                                                                                | Where at-risk marking is computed, what the outbound payload actually contains, and whether any post-response check exists today                                                                                                    | Unit (at-risk marking + prompt assembly) plus integration with the model boundary stubbed      | Asserting on live model output — flaky, and it takes its oracle from the model instead of from the requirement |
| #2   | A past-dated product produces defined, non-silent behavior — it is either excluded or explicitly marked as expired, never presented to the model as ordinary stock                                                            | "The 3-day window bounds both ends." Verify whether the day-delta can go negative and what the branch does when it does                                                                                                         | Whether expiry deltas can be negative, and whether "expired" exists as a state distinct from "at-risk" anywhere today                                                                                                               | Unit, table-driven over boundary dates (−1, 0, +1, +3, +4) with a frozen clock                 | Testing only future dates; leaving "today" and timezone boundaries untested                                    |
| #3   | A forced failure on the second write leaves _neither_ effect committed — inventory unchanged and no orphan recipe row                                                                                                         | "It returned 200, so both writes landed." And: "the routine is atomic, so there is nothing to test" — the call site can still misread its result                                                                                | The transaction boundary, what the routine returns on failure, and how the endpoint interprets that value                                                                                                                           | Integration against the existing local seed                                                    | Mocking the database — the atomicity guarantee _is_ the database; a mock only asserts your own assumption      |
| #4   | A second authenticated user requesting or deleting the first user's row id is denied, and no row is mutated                                                                                                                   | "RLS is enabled, so we are covered." `lessons.md` records exactly this being false here                                                                                                                                         | Which service functions chain a `user_id` filter and which rely on RLS alone; what an unauthorized request actually returns                                                                                                         | Integration with two seeded users against the real endpoints                                   | Testing with a single user; asserting the status code without checking that the row survived                   |
| #5   | The set returned in the approval payload and the set deleted on confirm are provably the same set — across duplicates, stale ids, and ids removed between generate and approve                                                | "The client sends back what we sent it." The client is untrusted; a stale or edited id list must not widen the deletion                                                                                                         | Whether the approve endpoint re-derives the set server-side or accepts a client-supplied list                                                                                                                                       | Integration on the approve endpoint                                                            | Asserting only the count; comparing the two lists in an order-dependent way                                    |
| #6   | Rate limit, timeout, and malformed response each produce a distinct non-2xx with a clean user-facing message — no fabricated recipe, and no provider key or raw upstream error body in the response                           | "The final status was 200, so the retry worked." Also verify that no provider credential or raw upstream body leaks into the client response                                                                                    | The error-translation path from the provider call to the HTTP response                                                                                                                                                              | Integration with the provider boundary stubbed to fail each way                                | Only exercising the happy path; snapshotting the error string without asserting the _class_ of failure         |
| #7   | Out-of-list, missing, oversized, and free-text parameter values are rejected at the boundary and never reach the prompt                                                                                                       | "The dropdown only offers valid values." The endpoint is reachable without the dropdown                                                                                                                                         | The validation schema for the generation endpoint and the point where parameters enter the prompt                                                                                                                                   | Unit on the validation schema plus one integration test posting a crafted body                 | Testing the schema in isolation while the endpoint never calls it                                              |
| #8   | From a real browser session, generate a recipe, reach the approval screen, click approve, and confirm exactly the listed products are gone from inventory and the recipe now appears in history, surviving a real page reload | "The integration tests already prove the loop works." They prove the contract, not the wiring — a button pointed at the wrong endpoint or a dropped client param passes every integration test and only fails in a real browser | Which components own generate/approve (the `use-recipe-generation` hook, inventory/recipe pages), which endpoints they call, how success/failure is rendered, and whether `auth.setup.ts`'s storageState covers login for this flow | e2e (Playwright) — exists only in the rendered UI, no unit/integration test can see DOM wiring | Asserting on toast text alone instead of actual inventory/history state after approve                          |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                | Goal (one line)                                                                                                                                           | Risks covered    | Test types                                  | Status      | Change folder                                          |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------- | ----------- | ------------------------------------------------------ |
| 1   | Runner bootstrap + recipe-generation core | Prove at-risk state is computed correctly, reaches the model request, and that failures fail loudly                                                       | #1, #6 (partial) | unit + integration (model boundary stubbed) | complete    | `context/changes/testing-recipe-generation-core/`      |
| 1b  | Expired-product handling                  | Prove past-dated stock never reaches the model and that the user is told, and that each generation failure carries its own status and a user-safe message | #2, #6           | unit + integration (model boundary stubbed) | complete    | `context/changes/expired-product-handling/`            |
| 2   | Approval contract integrity               | Prove approval is all-or-nothing and removes exactly the set it displayed                                                                                 | #3, #5           | integration                                 | complete    | `context/changes/testing-approval-contract-integrity/` |
| 3   | Data isolation and input trust            | Prove a second user cannot reach the first user's rows, and that crafted input is rejected at the boundary                                                | #4, #7           | integration + unit                          | not started | —                                                      |
| 4   | Quality-gates wiring                      | Lock the floor in the existing CI job                                                                                                                     | cross-cutting    | gates                                       | not started | —                                                      |
| 5   | E2E: generate→approve→removal wiring      | Prove the UI wiring for generate→approve→removal matches its API contract, from a real browser                                                            | #8               | e2e (Playwright)                            | not started | `context/changes/testing-generate-approve-e2e/`        |

Phase 1b was split out of Phase 1 on 2026-08-15. Phase 1 research found Risk #2 to
be a live defect rather than a coverage gap — `isAtRisk()` is one-sided, so expired
stock is marked at-risk and the at-risk floor guard then _forces_ it into the recipe.
Closing it requires new product behaviour (an `expired` state, exclusion from the
prompt, and telling the user), which does not belong in a test-rollout phase. The
oracle for 1b is settled and recorded in
`context/changes/testing-recipe-generation-core/research.md` §"Resolved Oracle".
1b depends on 1 for the runner.

Risk #6 was split across the same boundary on 2026-08-15, for the same
reason. Phase 1 pinned the half the code already satisfies: a failure never
resolves as success, never hangs, and never leaks the provider key or the
raw upstream body. The other half is a live defect, not a coverage gap —
ten failure classes collapse onto one flat HTTP 500, and three of them
(`ZodError`, `SyntaxError`, PostgREST) return raw internal text as the
user's toast. Closing it needs a typed service error and message hygiene,
which is product work, so it moves to 1b along with Risk #2. The
consequence for 1b: it now owns **two** independent red-test sequences
(the expired-product decisions D1–D4, then the error contract) and both
touch `generate.ts`'s catch block — its `/10x-tdd` run must sequence them
rather than treat them as one phase. The failure inventory is in
`context/changes/testing-recipe-generation-core/research.md` §Risk #6.

Phase 1 must land first: there is no test runner in this project today, so
no other phase can produce a signal until it exists. Phases 2 and 3 depend
on the existing local database seed being usable as-is — if it is not,
§1 principle #4 applies and the phase drops to the cheapest honest layer
rather than building a rig.

Phase 5 depends on Phase 2 (approval contract integrity, complete) for the
API-layer guarantee it builds on top of: Phase 2 proves `approve_recipe` is
all-or-nothing and set-exact at the contract level; Phase 5 proves the UI
actually calls that contract correctly from a real browser. The change
folder `context/changes/testing-generate-approve-e2e/` already exists with
a draft `change.md` — reuse it rather than opening a new one when this
phase starts.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                    | Tool                                                   | Version                                        | Notes                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| unit + integration       | Vitest                                                 | 4.1.10 (latest at 2026-08-15 — pin in Phase 1) | none yet — see §3 Phase 1. Configure via `getViteConfig()` from `astro/config`; Astro 6 requires `environment: 'node'` for anything rendering Astro components                       |
| API / provider mocking   | none — stub at the module boundary                     | n/a                                            | §1 principle #4: no MSW or dedicated mock server unless a phase proves the module boundary insufficient                                                                              |
| database for integration | existing local Supabase seed (`npx supabase db reset`) | n/a                                            | Reused, not built. Yields a working `test@example.com` login per `context/archive/2026-06-05-recipe-generation-loop/change.md`                                                       |
| e2e                      | Playwright                                             | ^1.62.1                                        | `tests/seed.spec.ts` + `tests/auth.setup.ts` landed 2026-08-18 (commit 91934fe); adopted for a small number of risk-tied flows, not general UI coverage. See §7. checked: 2026-08-18 |
| accessibility            | none — excluded                                        | n/a                                            | Deliberate; follows from the UI exclusion. See §7                                                                                                                                    |
| AI-native                | none                                                   | n/a                                            | No AI-native layer in this rollout. See §7 for the revisit trigger                                                                                                                   |

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

| Gate                  | Where                                      | Required?                 | Catches                                                                                                                                                                    |
| --------------------- | ------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint                  | local + CI                                 | required (wired)          | syntactic drift, lint-rule violations                                                                                                                                      |
| build                 | CI                                         | required (wired)          | build-breaking and configuration errors                                                                                                                                    |
| typecheck             | local + CI                                 | required after §3 Phase 4 | type drift — the script exists but is currently ungated                                                                                                                    |
| unit + integration    | local from §3 Phase 1; CI after §3 Phase 4 | required after §3 Phase 4 | logic regressions on the risks in §2                                                                                                                                       |
| e2e on critical flows | —                                          | excluded                  | Would catch broken critical user paths end-to-end. Deliberately not adopted (§7); the accepted consequence is that no gate exercises the browser-side of the approval flow |
| post-edit hook        | local (agent loop)                         | optional                  | regressions at edit time. Not configured by this rollout                                                                                                                   |
| pre-prod smoke        | between merge and prod                     | optional                  | environment-specific failures                                                                                                                                              |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

Colocate it: `src/**/<module>.test.ts` next to `<module>.ts`. Import
`describe`/`it`/`expect`/`vi` explicitly — `globals` is off in
`vitest.config.ts`, which is what keeps ESLint's `strictTypeChecked` pass
working on test files. Worked example: `src/lib/services/product.service.test.ts`.

- **Freeze the clock for anything date-derived.** `vi.useFakeTimers()` +
  `vi.setSystemTime(FROZEN_NOW)` in `beforeEach`, `vi.useRealTimers()` in
  `afterEach`. Derive every fixture date from `FROZEN_NOW` with a small
  `expiryIn(days)` helper rather than writing literal dates — a literal
  passes today and rots next month.
- **The timezone is pinned to UTC**, matching workerd. `vitest.config.ts`
  sets `process.env.TZ` at config load (not only `test.env`) so it also
  holds under Stryker's threads pool; `recipe-prompt.test.ts` carries a
  one-line guard asserting `getTimezoneOffset() === 0`. Don't re-pin it
  per file.
- **Boundary rules get one `it.each` table, not one test per row.** Name
  the case from the behaviour (`{ offset: 3, label: "expires on the last
day of the window", expected: true }`) so the reporter prints four
  distinguishable cases. Include the first row _outside_ the window — the
  window's edge is the only interesting part of it.
- **Write the oracle into the test as a comment citing its source**
  (`prd.md:31`, `types.ts:11`, a git ref for a recovered literal). If the
  only justification available is the current implementation, stop: that
  is a mirror test, and the oracle question belongs back in
  `/10x-research`.
- **Stub a Supabase query builder as a thenable chain**, not with a mock
  library: an object whose `select`/`eq` return itself and whose terminal
  call (`order`) returns `Promise.resolve({ data, error })`, cast once via
  `as unknown as SupabaseClient`. Only worth doing for a service function
  whose logic sits _around_ the query.

### 6.2 Adding an integration test

The model provider is reached through bare global `fetch`, so
`vi.stubGlobal("fetch", …)` is the whole stub story — no MSW, per §1
principle #4. Worked example: `src/lib/services/recipe.service.test.ts`.

- **Stub the seam, capture the payload.** A stub that parses `init.body`
  and records the outbound user turn lets the same helper serve both
  "what did we send" and "what happens when the reply is X". Type the init
  as a narrow local interface (`{ body: string }`), not `RequestInit`: a
  body that stopped being a serialized string then fails loudly at
  `JSON.parse` instead of being stringified into `"[object Object]"`.
- **`vi.mock("astro:env/server", …)` with a recognisable fake key.** The
  real key is absent under the runner, so `expect(msg).not.toContain(undefined)`
  would pass vacuously. Substituting `sk-or-v1-test-key-must-not-leak` is
  what makes a leak assertion mean something — and assert first that the
  request really _carried_ the credential, otherwise the negative passes on
  a request that never had one.
- **Assert the property, not the constant.** "Every at-risk id survives
  into the payload" and "the payload is bounded" are the guarantees;
  `promptProducts.length === 25` is a tunable and pinning it fails on a
  legitimate change. Same rule for temperature, model id, and the 30 s
  timeout.
- **Order fixtures so the regression can actually happen.** The at-risk
  products sit _last_ in the survival test's input, so a refactor slicing
  before sorting drops all of them. A fixture arranged the convenient way
  proves nothing about ordering.
- **Assert rejection, not wording, when the wording is someone else's.**
  Guardrail messages move in `expired-product-handling`, so those cases use
  `rejects.toThrow()` bare. Where the message _is_ the contract (the four
  user-facing provider-failure strings) assert it, and add one test that
  the classes stay _distinct_ — four passing single-message tests would
  still pass if every class collapsed onto one string.
- **A deliberate error is part of the contract.** For malformed provider
  envelopes, assert the rejection is not a `TypeError` or `SyntaxError`:
  those mean the envelope was walked or parsed unguarded and raw internal
  text reaches the user's toast.
- **Stub `console.error` in failure paths** (`vi.spyOn`), both to keep the
  suite output readable and to assert the upstream body went to the log
  rather than to the caller.

### 6.3 Adding a test for a new API endpoint

Call the exported `POST` / `GET` directly — no HTTP server. Worked example:
`src/pages/api/recipes/generate.test.ts`.

- **`vi.mock("@/lib/supabase")` is mandatory.** `createClient()` returns
  `null` when `SUPABASE_URL`/`SUPABASE_KEY` are unset, and every route
  short-circuits to 503 before reaching anything interesting. Without the
  stub the whole file asserts 503 and proves nothing. Serve rows from a
  `vi.hoisted()` holder so each test sets the inventory it needs, and reset
  it in `afterEach`.
- **Build the context in exactly one typed helper.** Type it
  `Parameters<APIRoute>[0]`, construct only what the route reads
  (`request`, `cookies`, `locals.user`) and cast once with
  `as unknown as RouteContext`. ESLint runs `strictTypeChecked` over test
  files, so a per-test `any` fights `no-unsafe-assignment`; one helper does
  not. Keep it inline until a third file needs it (§7).
- **Assert the class of outcome, not the status number, while the status
  is known-wrong.** Today every generation failure collapses onto one flat
  500, so these tests assert `response.ok === false` and
  `status >= 400`. Literal codes are asserted only where the code _is_ the
  contract and is correct today (401 unauthenticated, 400 invalid body).
- **A failed request must not carry the payload of a successful one** —
  assert `body` has no `recipe` key, and that the response text contains
  neither the API key nor the upstream body. The client renders the error
  field verbatim as a toast.
- **Assert the provider was never called** (`expect(fetchSpy).not.toHaveBeenCalled()`)
  on every precondition rejection. A 401 that still spends the shared key
  is a resource-abuse hole the status code alone will not show.
- **Pin deliberate-looking-wrong behaviour with its reason.** The absent /
  unparseable request body generating a 200 reads like a swallowed bug; the
  test and its comment are what stop a later refactor from "fixing" it into
  a 400 that breaks the primary flow.

### 6.4 Adding a test that touches the database

- TBD — see §3 Phase 2 (pattern for asserting all-or-nothing writes and
  set-identity against the existing local seed).

### 6.5 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a two- to
three-line note here capturing anything surprising the phase taught.)

**Phase 1 — runner bootstrap + recipe-generation core (2026-08-15)**

- `getViteConfig()` resolves `astro:env/server` and the `@/*` alias with no
  mocking at all, because it registers Astro's `astroEnv` virtual-module
  plugin. That contradicts the hazard logged at `infrastructure.md:89`;
  server modules are directly importable under Vitest.
- It also drags in the Cloudflare adapter's Vite plugins, which refuse to
  start when a worker environment carries `resolve.external` — Vitest never
  gets past config resolution. `vitest.config.ts` strips any plugin whose
  name matches `/cloudflare/i` for tests only; the build path never reads
  that file.
- Vitest's `test.env` applies TZ _inside_ the worker, which is too late to
  move Node's cached timezone under a threads pool — invisible under the
  default forks pool, fatal under Stryker. `process.env.TZ = "UTC"` at
  config load is what actually holds.
- Mutation gate (`npx stryker run --mutate "src/lib/services/recipe.service.ts"`,
  Stryker 10 + `@stryker-mutator/vitest-runner`, ad hoc — never CI):
  **40.98% → 52.68%** total (50.00% → 63.16% covered) after killing eight
  classes of survivor that a user would feel. The sort-before-slice mutants
  were already dead — the survival test does its job. Newly killed: the
  missing prompt cap (unbounded token spend on a shared key), at-risk
  products leaking into the optional section, an optional section announced
  over an empty list, a default `excludeTitles` that is not empty, a
  `.min(1)`→`.max(1)` flip on `ingredients`/`instructions` that would reject
  every real recipe, `every`→`some` in the unknown-id guardrail (a recipe
  mixing real ids with an invented one passing through to a deletion),
  every transport failure being reported as a timeout, and an unguarded
  walk of a truncated provider envelope surfacing a raw `TypeError` /
  `SyntaxError` to the user.
- Survivors accepted consciously, by group: (a) the `RESPONSE_FORMAT`
  `json_schema` literals, `OPENROUTER_URL`, `MODEL`, the request method and
  headers, the `plugins` list and the message roles — killing these means
  asserting our own constants against themselves through a stub that cannot
  validate them, which is §7's "configuration as a test subject" and a
  mirror test besides; (b) the guardrail and empty-response `message`
  strings, whose wording is Risk #6 presentation work owned by
  `expired-product-handling`; (c) the temperature ternary and the `join`
  separator, tunables whose mutation costs prompt quality, not correctness;
  (d) `/[\r\n]+/g`→`/[\r\n]/g` and the replacement `" "`→`""` — neither
  restores a newline, so neither reopens the header-forging path the
  sanitiser exists for. One real gap is recorded rather than closed: the
  `excludeTitles` regenerate branch is uncovered (its "never append the
  clause" mutant survives), because no risk in §2 covers repeat
  suggestions. Revisit if a user reports the same recipe on regenerate.

**Phase 1b — expired-product handling + the error contract (2026-08-16)**

- The typed service error (`src/lib/services/service-error.ts`) makes hygiene
  structural rather than habitual: the endpoint answers with a `ServiceError`'s
  status and message or with its own generic 500, so an unconverted throw site
  degrades to safe copy instead of leaking. The allowlist being a _type_ is what
  removes the "remember to sanitise here too" failure mode that let `ZodError`,
  `SyntaxError` and PostgREST text reach three separate toasts.
- Keying status _and_ message off one `kind` table has a consequence worth
  recording: a class cannot carry three different messages, so the empty-response
  and both guardrail sites collapsed onto shared copy a phase earlier than planned.
  The distinction they lose is preserved in the server log, and a test asserts the
  two guardrail causes stay distinguishable there — the log assertion is the
  compensating control for the shared user-facing string, not an extra.
- The expired partition lives in the endpoint, not in `generateRecipe`. That kept
  the service's signature and resolved shape untouched, so every Phase 1 assertion
  survived the change verbatim — the property those tests were written for.
- One manual check was closed by automation rather than by hand: forcing a real
  provider to return malformed JSON is not something a person can do on demand, so
  the "readable toast, not a JSON dump" property is carried by the two suppression
  tests instead (model prose and `ZodError`, each guarded against passing
  vacuously). Recorded here because the plan's row reads as manually verified.
- Mutation gate (same scope and command as Phase 1): **52.68% → 52.80%** total.
  Two real survivors killed, both the same class — a guardrail throwing an
  unclassified error still satisfied `rejects.toThrow()`, so the endpoint would
  have answered a generic 500 where the user needs the actionable 502. Survivors
  accepted: the diagnostic `cause` on the timeout, the log _wording_ at four sites
  (killing those means snapshotting internal copy, which §6 forbids), and the
  empty-envelope guard — which now survives only because the parse wrapper catches
  the fallthrough and produces an identical class, status and message.

**Phase 2 — approval contract integrity (2026-08-16)**

- The RPC's own all-or-nothing and set-identity guarantees are Postgres
  properties, not JS ones — no mock can establish them. A `SECURITY INVOKER`
  `BEFORE DELETE` trigger keyed on an exact sentinel product name forces the
  atomicity test's failure without any global side effect (a `REVOKE`/`GRANT`
  approach was considered and rejected — it would have to touch every
  session, not just the test's own DELETE).
- Risk #5 was a live defect, not a coverage gap: `approve_recipe` silently
  excluded stale or foreign product ids from the delete instead of reporting
  them, and the PRD's own "never more, never fewer" guardrail wording claimed
  a guarantee the system did not honor. Closing the gap meant changing the
  RPC's return shape (`UUID` → `JSONB`), which needed a `DROP FUNCTION` first
  — `CREATE OR REPLACE` cannot change a return type in place.
- Mutation gate (`npx stryker run --mutate "src/lib/services/recipe.service.ts:257-281"`,
  scoped to `approveRecipe`): **0.00% → 71.43%** total (0.00% → 76.92%
  covered). The integration suite calls the RPC directly rather than through
  this wrapper, so `approveRecipe` started this phase with zero coverage
  from any test in the suite — two new unit tests (mocking the Supabase
  client, no DB needed) killed ten mutants, including a dropped
  `deleted_ids` from the response and a swallowed PostgREST error that would
  have let a datastore failure resolve as a fake success. Survivors accepted:
  the diagnostic `cause` option (same class Phase 1 accepted), and three
  mutants on the `if (!result?.recipe_id)` defensive branch — out of scope
  per this phase's plan (unreachable by construction, same category as the
  `ServiceError` `CONTRACT` fallback).

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **User interface, rendering, and look and feel** — no component tests, no
  snapshots, no visual diffing. This also covers the vendored components
  under `src/components/ui/`, whose upstream project is the test. Accepted
  consequence: a regression that breaks only the at-risk _highlight_ on the
  home screen — the PRD's Secondary success criterion — will ship uncaught;
  the at-risk _computation_ behind it is covered by §3 Phase 1 instead.
  Re-evaluate if a rendering bug reaches a user. (Source: Phase 2 interview
  Q5.) **Narrowed 2026-08-18:** this no longer means "no browser-driven e2e
  at all." A small number of risk-tied e2e flows are now in scope — see
  Risk #8 and §3 Phase 5 — because that failure class (UI wiring diverging
  from its already-proven API contract) is invisible to every other layer
  in this stack. The exclusion still holds for rendering/visual/snapshot
  testing generally; e2e is adopted narrowly, per risk, not as general UI
  coverage.
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

- Strategy (§1–§5) last reviewed: 2026-08-18
- Stack versions last verified: 2026-08-15
- AI-native tool references last verified: 2026-08-15

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
