# Runner Bootstrap + Recipe-Generation Core Tests — Implementation Plan

## Overview

Stand up the project's first test runner (Vitest), then use it to pin the two things
test-plan §3 Phase 1 exists to protect: **Risk #1** — the generated recipe must never
silently stop using at-risk products — and the oracle-true half of **Risk #6** — a
generation failure must never surface as success, an indefinite wait, or a leak of the
provider key or raw upstream body.

Everything the code currently gets *wrong* is deliberately out of scope. Risk #2
(expired stock) was already split to `expired-product-handling`; the Risk #6 status-code
collapse and message-hygiene leaks join it there (see "Deferred to
`expired-product-handling`"). What remains here is a genuine test-rollout phase: tests
against code that already satisfies its oracle.

## Current State Analysis

**Zero test infrastructure.** No `vitest.config.*`, no `*.test.ts` anywhere outside
`node_modules`, no test dependency, no `test` script. CI (`.github/workflows/ci.yml`)
runs `astro sync` → `lint` → `build` and auto-deploys to Cloudflare on `main`. Wiring
tests into CI belongs to test-plan §3 Phase 4, not here.

**Risk #1 is structurally protected and completely unverified.** Three mechanisms carry
the guarantee, and nothing enforces any of them:

1. `recipe.service.ts:74–77` — at-risk-first stable sort **before** the
   `MAX_PROMPT_PRODUCTS = 25` slice. This ordering is the entire reason the cap cannot
   evict every at-risk product. A refactor that slices first reintroduces Risk #1 in
   full, silently.
2. `recipe.service.ts:157–160` — model-returned IDs must all be in the prompt set.
3. `recipe.service.ts:165–170` — if any at-risk product was sent, at least one returned
   ID must be at-risk.

**Risk #6 is half-handled.** `OPENROUTER_API_KEY` never appears in an error path, and
the OpenRouter response body — which carries account and quota metadata for the shared
key — is `console.error`'d and never returned (`recipe.service.ts:138–145`). That half
is genuinely safe and is what this change pins. The other half — ten failure classes
collapsing to one HTTP 500, three of them returning raw internal text — is real and
deferred.

**The environment unknown is resolved.** `getViteConfig()` calls `createVite()`, which
registers the `astroEnv` virtual-module plugin
(`node_modules/astro/dist/core/create-vite.js:160`), so `recipe.service.ts` and
`supabase.ts` are importable under Vitest without mocking `astro:env/server`. All three
env fields are `optional: true` (`astro.config.mjs:17–21`), so an unset key resolves to
`undefined` rather than throwing — correct when the provider `fetch` is stubbed.

## Desired End State

`npm test` runs green locally against a colocated Vitest suite that:

- fails if the at-risk sort stops preceding the `MAX_PROMPT_PRODUCTS` slice;
- fails if a model response that ignores every at-risk product is passed through as a
  valid recipe;
- fails if the all-`any` system prompt drifts from the wording it shipped with;
- fails if a product name containing a newline can forge a prompt section header;
- fails if any provider failure class yields a 2xx, a `recipe` payload, the API key, or
  the raw upstream body.

Verify with `npm test` (all green), `npm run lint`, `npm run typecheck`, and one Stryker
run over `recipe.service.ts` whose surviving mutants have each been consciously accepted
or killed.

### Key Discoveries

- **The `buildSystemPrompt` oracle is external and verified.** `recipe-prompt.ts:54–60`
  states the acceptance criterion; the pre-parameter literal is recoverable at
  `git show d137c98^:src/lib/services/recipe.service.ts` (913 bytes). I rendered the
  current all-`any` output and compared: **identical**. This is an oracle from history,
  not from the implementation — the distinction CLAUDE.md's oracle rule turns on.
- **`recipe-prompt.ts` is deliberately `astro:env`-free** (comment at lines 3–7) and
  type-only on `@/types`, so it is testable with no stubbing at all.
- **The provider seam is bare global `fetch`** (`recipe.service.ts:106`) —
  `vi.stubGlobal` is the entire stub story. No MSW, matching test-plan §4.
- **Endpoint tests must stub `@/lib/supabase`.** `createClient()` returns `null` when
  `SUPABASE_URL`/`SUPABASE_KEY` are unset (`supabase.ts:6–8`), short-circuiting to 503
  before any interesting code runs. Without the stub every endpoint test asserts 503 and
  proves nothing. Phase 1 needs no local database (`test-plan.md:90`).
- **ESLint runs `strictTypeChecked` with `projectService: true` over every TS file**, so
  test files are type-checked and linted at full strictness. Constructing a fake
  `APIContext` will fight `no-unsafe-assignment` / `no-explicit-any` — see Critical
  Implementation Details.
- **`isAtRisk()` is one-sided** (`product.service.ts:6–11`): every past date returns
  `true`. That defect belongs to `expired-product-handling`. Fixtures here use
  future-dated expiry values **only**, so these assertions survive that change untouched.

## What We're NOT Doing

- **Not fixing `isAtRisk()`'s missing lower bound**, not introducing an `expired` state,
  not filtering expired products from the prompt, not adding the all-expired branch.
  All of that is `expired-product-handling` (test-plan §3 Phase 1b).
- **Not asserting negative expiry offsets** (−1, −30, −365). Today they return `true`;
  the oracle says they should not. Asserting either value here writes a test that
  Phase 1b must immediately rewrite.
- **Not differentiating HTTP status codes** and **not sanitising the ZodError /
  SyntaxError / PostgREST leaks** — deferred, see below.
- **Not asserting `status === 500`** anywhere. The oracle-true assertion is *non-2xx*;
  pinning 500 would pin behaviour the test plan calls wrong and would break the moment
  the deferred work lands.
- **Not wiring tests into CI** — test-plan §3 Phase 4 owns that gate.
- **Not testing the timezone drift** in `isAtRisk()`'s upper bound. Real, but unreachable
  in production (`workerd` is UTC, `infrastructure.md:10`); research Open Question 2
  recommends pinning `TZ=UTC` instead of pinning behaviour the product does not depend on.
- **No UI, component, snapshot, or e2e tests**; no fixture factories, no custom DSL, no
  coverage thresholds (test-plan §7).
- **No live model calls** (test-plan §7).

## Deferred to `expired-product-handling`

Risk #6's unmet half moves into the Phase 1b change (user decision, this session):

| Deferred item | Where it lives today | Why it can't be tested here |
|---|---|---|
| Distinct non-2xx per failure class | `generate.ts:64–67` catch-all | Requires a typed service error; the test would be red until the code changes |
| `ZodError` dump reaching the toast | `recipe.service.ts:154` | ~700-byte JSON including the internal UUID regex |
| `SyntaxError` echoing model prose | `recipe.service.ts:154` | `JSON.parse` message quotes the model's refusal text |
| Raw PostgREST diagnostics | `product.service.ts:20` | A second upstream leaking where OpenRouter's was suppressed |
| Guardrail jargon as user copy | `recipe.service.ts:159,168` | "inventory guardrail violated" is correct detection, wrong presentation |

**Consequence to record in the handoff:** `expired-product-handling` now touches
`generate.ts`'s catch block for two independent reasons (D4's all-expired branch plus
this status/message discipline). It is no longer *one* nameable red test, so its
`/10x-tdd` run must sequence them — D1→D4 first, then the error contract — rather than
treating them as one phase.

## Implementation Approach

Five phases, executor chosen per CLAUDE.md's rule (can you name the first red test in one
sentence?):

- **Phase 1** — `/10x-implement`. Environment setup; there is no red test to name.
- **Phases 2–4** — `/10x-tdd`. Each phase's first assertion is nameable in one sentence,
  even though the code under test already exists. The value of the mode here is the pause
  *before* the implementation is consulted: it is what stops the assertion from being
  copied out of `recipe.service.ts`.
- **Phase 5** — `/10x-implement`. Mutation gate, documentation, handoff.

Two stub boundaries only, both at the module edge (test-plan §4, §1 principle #4):
`globalThis.fetch` for the provider, `@/lib/supabase` for inventory reads.

## Critical Implementation Details

**Fixture dating.** Every product fixture in Phases 2–4 uses a **future** `expiry_date`
relative to the frozen clock — at-risk fixtures at `+1`/`+2` days, safe fixtures at `+30`.
A past-dated fixture is currently marked at-risk and will stop being so when Phase 1b
lands D2, silently turning these into different test cases.

**Fake `APIContext` under `strictTypeChecked`.** Endpoint tests call the exported `POST`
directly, which needs a context carrying `request`, `cookies` and `locals.user`. Building
it will trip `@typescript-eslint/no-unsafe-assignment` and `no-explicit-any`. Do the cast
in exactly one local helper typed as `Parameters<APIRoute>[0]`, with a single scoped
`eslint-disable-next-line` and a comment naming why — not `any` sprinkled per test. This
helper is the "same setup code in a third file" trigger test-plan §7 warns about; keep it
inline in the endpoint test file until a third file needs it.

**Timeout testing without timers.** `AbortSignal.timeout(30_000)` interacts badly with
fake timers. Test the *translation*, not the elapsed wall clock: stub `fetch` to reject
with an error whose `name` is `"TimeoutError"` and assert the friendly message. Research
verified on Node that the real `DOMException` satisfies `instanceof Error` and
`name === "TimeoutError"`, so the stub matches the real shape at the guard
(`recipe.service.ts:132`).

**`console.error` in the error path.** `recipe.service.ts:143` logs the upstream body on a
non-2xx. Tests exercising that path should stub `console.error` so the suite output stays
readable — and the stub doubles as the assertion that the body went to the log rather than
to the response.

---

## Phase 1: Vitest Bootstrap

### Overview

Install and configure the runner so a test can import a server module and run
deterministically. Delivers the conventions Phases 1b, 2 and 3 of the test plan inherit.

### Changes Required

#### 1. Test runner dependency

**File**: `package.json`

**Intent**: Add Vitest as the project's first test dependency and expose the scripts the
rest of the rollout will call.

**Contract**: `devDependencies` gains `vitest` pinned to `4.1.10` (test-plan §4;
satisfies the `getViteConfig()` floor of 3.2/4.1+). `scripts` gains `"test": "vitest run"`
and `"test:watch": "vitest"`. No coverage reporter, no additional test packages — §7 rules
out infrastructure beyond the minimum.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Configure Vitest through Astro so `astro:env/server` and the `@/*` alias
resolve, and pin the timezone so date logic is deterministic.

**Contract**: Default-exports `getViteConfig()` from `astro/config` with a `test` block
setting `environment: "node"` (required by Astro 6), `include` scoped to
`src/**/*.test.ts`, and `env: { TZ: "UTC" }`. Globals stay **off** — every test imports
`describe` / `it` / `expect` / `vi` explicitly, which keeps ESLint working without a
globals declaration.

```ts
// getViteConfig is async-config-aware; the test block is passed as its second argument,
// not merged into the first. Getting this wrong silently drops the config.
export default getViteConfig({}, { test: { /* … */ } });
```

#### 3. Environment smoke test

**File**: `src/lib/services/recipe-prompt.test.ts` (new)

**Intent**: Prove the runner resolves the `@/*` alias and that a module importing
`astro:env/server` loads without mocking — the single biggest environment question for
this phase.

**Contract**: One test importing `buildSystemPrompt` from `./recipe-prompt` and asserting
it returns a non-empty string, plus one `await import("@/lib/services/recipe.service")`
asserting the module resolves. The real assertions on this file arrive in Phase 2.

### Success Criteria

#### Automated Verification

- `npm test` runs and the smoke test passes
- `npm run lint` passes with the new files present
- `npm run typecheck` passes (`astro check` covers `**/*` per `tsconfig.json`)
- `npm run build` still succeeds — `vitest.config.ts` must not perturb the Astro build

#### Manual Verification

- `npm run test:watch` starts and re-runs on a saved edit
- Test output shows no `astro:env` or unresolved-alias warnings

**Implementation Note**: Pause for manual confirmation before Phase 2.

---

## Phase 2: Risk #1 — Classification and Prompt Rules

### Overview

Pin the two pure functions Risk #1 rests on: at-risk classification at its boundary
dates, and the system prompt's wording. No stubbing needed beyond the clock.

### Changes Required

#### 1. At-risk boundary table

**File**: `src/lib/services/product.service.test.ts` (new)

**Intent**: Prove the at-risk window is exactly "expiring within 3 days" at its upper
boundary, under a frozen clock, so the window cannot drift unnoticed.

**Contract**: An `it.each` table over offsets `+0`, `+1`, `+3`, `+4` from a frozen
`today`, asserting `isAtRisk` returns `true`, `true`, `true`, `false`. Oracle:
`prd.md:31` and `prd.md:98` — "expiring within 3 days from today's date", inclusive at
+3. Clock frozen with `vi.setSystemTime` in `beforeEach` and released in `afterEach`.
**No negative offsets** — that row belongs to Phase 1b's oracle.

A second case asserts `listProducts` maps `is_at_risk` onto each returned row, with the
Supabase client stubbed as a thenable query builder. Oracle: `ProductWithRisk`
(`types.ts:11`) — the flag is derived server-side, never trusted from the row.

#### 2. System prompt byte identity

**File**: `src/lib/services/recipe-prompt.test.ts` (extend Phase 1's smoke test)

**Intent**: Pin the all-`any` system prompt to the exact wording it shipped with, so a
parameter refactor cannot quietly reword the rules every generation depends on.

**Contract**: Assert `buildSystemPrompt({ technique: "any", method: "any", time: "any" })`
equals the pre-parameter `SYSTEM_PROMPT` literal, inlined into the test as a template
string with a comment citing `git show d137c98^:src/lib/services/recipe.service.ts`.
Verified identical during planning (913 bytes) — this test is green on arrival.

Second assertion, the contradiction-freedom invariant: for every non-`any` technique, the
rendered prompt contains **exactly one** line starting `- Techniques:`, and it is not the
generic "use only sauté, boil, …" line. Oracle: a prompt carrying two conflicting
technique instructions is ambiguous by construction; `MAX`/`NEVER` clause presence is
asserted as a property, not as a full-string snapshot.

Third: for each non-`any` `time`, the rendered cap equals the selected value and never
exceeds 45 — oracle `types.ts:63–64`, "the control only narrows it."

### Success Criteria

#### Automated Verification

- `npm test` passes, including the boundary table and byte-identity assertions
- The boundary table produces four named cases in the reporter, not one
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification

- Temporarily changing `AT_RISK_DAYS` to `4` turns the `+4` case red — confirm, then revert
- Temporarily appending a word to `ANY_TECHNIQUE_LINE` turns byte identity red — confirm, then revert

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Risk #1 — Outbound Payload and Guardrails

### Overview

The core of Risk #1: prove at-risk products reach the model flagged and survive the cap,
and that a response ignoring them is rejected rather than returned.

### Changes Required

#### 1. At-risk survival across the cap

**File**: `src/lib/services/recipe.service.test.ts` (new)

**Intent**: Prove the ordering guarantee — at-risk products always reach the outbound
payload regardless of inventory size — without pinning the cap number, which is a
tunable implementation detail.

**Contract**: Stub `globalThis.fetch` with `vi.stubGlobal`, capture the request body, and
assert every at-risk product ID appears in the outbound user turn. Fixture: 30 products
where the at-risk ones sit **last** in the input array, so a slice-before-sort refactor
drops them. Assert the *survival property*, never `promptProducts.length === 25`. Oracle:
test-plan §2 Risk #1 — "the outbound request carries them flagged"; the deviation from
FR-007's literal "always receives the full inventory" is documented and deliberate
(`recipe.service.ts:75–76`).

#### 2. Prompt section structure

**File**: same

**Intent**: Prove the two-branch user turn matches FR-007 — the prioritisation clause
appears when at-risk items exist and is omitted entirely when none do.

**Contract**: With at-risk products present, the user turn contains the "must use at least
one" clause and lists at-risk IDs under it, with non-at-risk IDs in a separate section.
With none present, the turn contains no prioritisation clause and no empty at-risk
section. Oracle: `prd.md:102` — with nothing at risk, a recipe is "generated freely from
the full inventory."

#### 3. Prompt-injection defence

**File**: same

**Intent**: Prove a user-supplied product name cannot forge a section header and demote
the at-risk framing.

**Contract**: A product named with an embedded `\n` followed by
`Other available ingredients:` yields a user turn where the at-risk section still holds
that product and no second `Other available ingredients:` header exists before it. Also
assert the 60-character truncation. Oracle: names are free text validated only as a
≤255-char string, and the user turn is newline-delimited and multi-section — the
structure is only as trustworthy as the sanitiser.

#### 4. Post-response guardrails

**File**: same

**Intent**: Prove a model response that violates the inventory contract is rejected rather
than returned as a valid recipe — the half of Risk #1 that prompt text cannot guarantee.

**Contract**: Three cases, each stubbing `fetch` with a well-formed OpenRouter envelope:
(a) `used_product_ids` containing an ID never sent → rejects; (b) at-risk products sent
but `used_product_ids` containing only non-at-risk IDs → rejects; (c) at-risk products
sent and at least one at-risk ID returned → resolves with the parsed recipe. Assert the
call **rejects**, not the message wording — the wording is Risk #6's, and it moves in
Phase 1b. Oracle: test-plan §2 Risk #1 — "a model response containing zero at-risk
products is detected rather than passed through."

### Success Criteria

#### Automated Verification

- `npm test` passes all four groups
- Guardrail cases assert rejection without asserting message text
- No fixture in this file carries a past-dated `expiry_date`
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification

- Reorder `recipe.service.ts:74–77` to slice before sorting — the survival test goes red. Confirm, then revert
- Delete the at-risk floor guard (`recipe.service.ts:165–170`) — case (b) goes red. Confirm, then revert

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Risk #6 — Failure Never Fakes Success

### Overview

Cover the half of Risk #6 the code already satisfies: every failure class fails loudly,
bounded, and without leaking the provider key or the raw upstream body. Status-code
differentiation and message hygiene are deferred.

### Changes Required

#### 1. Service-level failure translation

**File**: `src/lib/services/recipe.service.test.ts` (extend)

**Intent**: Prove each provider failure class produces a distinguishable, bounded,
user-safe rejection instead of hanging or resolving.

**Contract**: Stub `fetch` per case and assert `generateRecipe` rejects: 401 and 402 →
"Recipe service unavailable — try again later"; 429 → "Rate limited — try again shortly";
other non-2xx → "Recipe generation failed"; a rejection with `name: "TimeoutError"` →
"Recipe generation timed out — try again"; an empty `choices[0].message.content` →
rejects. These four strings are oracle-conformant today (clean, user-facing, no internal
detail) so asserting them is safe. Do **not** assert on the `ZodError` or `SyntaxError`
paths' message content — those are the deferred leaks.

#### 2. No credential or upstream-body leak

**File**: same

**Intent**: Prove the shared API key and the quota-bearing upstream body never reach the
caller — the half of Risk #6 that is genuinely handled and worth locking down.

**Contract**: On a non-2xx whose body contains a recognisable secret-shaped marker,
assert the rejection message contains neither that marker nor the stubbed
`OPENROUTER_API_KEY` value, and that `console.error` (stubbed) received the body. Oracle:
test-plan §2 Risk #6 — "no provider key or raw upstream error body in the response."

#### 3. Endpoint failure contract

**File**: `src/pages/api/recipes/generate.test.ts` (new)

**Intent**: Prove the endpoint never converts a generation failure into a success, and
never returns a recipe it did not get.

**Contract**: With `@/lib/supabase` stubbed to a client returning products and `fetch`
stubbed to fail, assert the response status is **not** 2xx and the parsed body has no
`recipe` key and does not contain the API key. Assert `!response.ok` — never the literal
`500`. Additional cases: no authenticated user → 401; empty inventory → 400. Oracle:
test-plan §2 Risk #6 — "no fabricated recipe"; `generate.ts:51–57` for the deliberate
empty-inventory exception.

#### 4. Unparseable body tolerated

**File**: same

**Intent**: Pin the deliberate decision that a POST with no body, or an unparseable one,
still generates — behaviour that reads like a bug and would otherwise be "fixed."

**Contract**: A request whose `json()` rejects produces a 200 with a recipe (provider
stubbed to succeed), not a 400. Oracle: `generate.ts:31–38` names the requirement — a
first generation posts no body — and the closed-enum defaults at `generate.ts:15–20` make
`{}` valid. A malformed *present* body still reaches validation, so a body with an
out-of-list `technique` returns 400.

### Success Criteria

#### Automated Verification

- `npm test` passes all Risk #6 cases
- No assertion anywhere in the suite compares a status to `500`
- No assertion depends on `ZodError` or `SyntaxError` message content
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification

- Make the endpoint catch-all return 200 with `{ recipe: null }` — the endpoint failure
  test goes red. Confirm, then revert
- Confirm suite output is not polluted by `console.error` from the stubbed failure paths

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Mutation Gate, Cookbook, and Handoff

### Overview

Verify the Risk #1 tests would actually catch the regression they exist for, then record
the patterns and hand the deferred scope to Phase 1b.

### Changes Required

#### 1. Selective mutation run

**File**: `stryker.config.json` (new, repo root)

**Intent**: Answer the question coverage cannot — would a test fail if the sort-before-
slice ordering were broken?

**Contract**: Minimal Stryker config with `testRunner: "vitest"`, `mutate` narrowed to
`src/lib/services/recipe.service.ts`, run ad hoc via
`npx stryker run --mutate "src/lib/services/recipe.service.ts"`. Not in CI, not a
commit gate (CLAUDE.md's selective-gate workflow; test-plan §7's minimum-infrastructure
rule is satisfied by the single-file scope). For each survived mutant, judge "would this
hurt a user or the business?" — kill it or record the conscious ignore. Do not chase
100%.

#### 2. Cookbook patterns

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the three TBD placeholders with the patterns this phase established,
so the next phase does not re-derive them.

**Contract**: §6.1 gets the frozen-clock + `TZ=UTC` + `it.each` boundary-table pattern.
§6.2 gets the `vi.stubGlobal("fetch")` provider-stub pattern and the "assert the property,
not the constant" rule. §6.3 gets the direct-`POST`-invocation pattern with the typed
fake-context helper and the `vi.mock("@/lib/supabase")` requirement. §6.5 gets a two- to
three-line note; the surprise worth recording is that `getViteConfig()` resolves
`astro:env/server` unmocked, contradicting the hazard logged at `infrastructure.md:89`.

#### 3. Rollout status and Risk #6 handoff

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that Phase 1 shipped and that Risk #6 is now half-covered here, half
owned by Phase 1b.

**Contract**: §3 Phase 1 Status → `done`. Phase 1b's "Risks covered" cell becomes `#2, #6`
and its Goal line extends to name the error contract. Add a short paragraph under the
table explaining the split, mirroring the existing Phase 1b note.

#### 4. Deferred-scope handoff

**File**: `context/changes/expired-product-handling/change.md`

**Intent**: Give Phase 1b the Risk #6 scope in full, including the sequencing consequence,
so it is not rediscovered mid-TDD.

**Contract**: Append a section carrying the five deferred items from this plan's "Deferred
to `expired-product-handling`" table, a pointer to `research.md` §Risk #6 for the failure
inventory, and the explicit note that the change now has **two** red-test sequences
(D1–D4, then the error contract) and must not be run as one.

### Success Criteria

#### Automated Verification

- `npx stryker run --mutate "src/lib/services/recipe.service.ts"` completes and produces an HTML report
- `npm test` still passes after any mutant-killing assertions are added
- `npm run lint` passes (the config file is JSON — Prettier via lint-staged)
- No TBD placeholder remains in test-plan §6.1, §6.2 or §6.3

#### Manual Verification

- Every survived mutant has been reviewed and either killed or consciously accepted, with the reasoning noted in §6.5
- The sort-before-slice mutant is killed, not accepted
- Phase 1b's `change.md` reads as a complete brief to someone who has not read this plan

---

## Testing Strategy

### Unit Tests

- `isAtRisk` upper-boundary table (+0/+1/+3/+4) under a frozen clock at `TZ=UTC`
- `listProducts` derives `is_at_risk` per row
- `buildSystemPrompt` all-`any` byte identity against the git-recovered literal
- Exactly-one-`- Techniques:`-line invariant across all non-`any` techniques
- Time cap never exceeds 45 minutes

### Integration Tests (model boundary stubbed)

- At-risk survival across a 30-product inventory with at-risk items ordered last
- Two-branch user-turn structure (with and without at-risk products)
- Newline injection in a product name cannot forge a section header
- Unknown-ID and at-risk-floor guardrails both reject
- Each provider failure class rejects with a clean, bounded message
- No API key or upstream body in any rejection
- Endpoint returns non-2xx with no `recipe` on failure; 401 unauthenticated; 400 empty inventory
- Absent or unparseable request body still generates

### Manual Testing Steps

1. Run `npm test` — all green, no `console.error` noise.
2. Reorder the sort and slice in `recipe.service.ts:74–77` — the survival test goes red. Revert.
3. Delete the at-risk floor guard — the floor test goes red. Revert.
4. Change `AT_RISK_DAYS` to `4` — the `+4` boundary case goes red. Revert.
5. Run Stryker and read the HTML report end to end before accepting any survivor.

## Performance Considerations

The suite is fully hermetic — no database, no network, no live model — so runtime should
stay in the low single-digit seconds. The one slow step is Stryker, which is ad hoc and
scoped to a single file. If the suite ever needs a real database, that is test-plan §3
Phase 2's problem, not this one's.

## Migration Notes

No data or schema changes. The only production-facing artifact is `vitest.config.ts` at
the repo root; confirm it does not enter the Cloudflare build output (Phase 1's build
check covers this).

## References

- Research: `context/changes/testing-recipe-generation-core/research.md`
- Test plan: `context/foundation/test-plan.md` §2 Risk #1/#6, §3 Phase 1, §4, §6, §7
- Downstream change: `context/changes/expired-product-handling/change.md`
- Prompt oracle: `git show d137c98^:src/lib/services/recipe.service.ts` (pre-parameter `SYSTEM_PROMPT`)
- Guardrail implementation: `src/lib/services/recipe.service.ts:74-77`, `:157-160`, `:165-170`
- Error path: `src/pages/api/recipes/generate.ts:64-67`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Vitest Bootstrap

#### Automated

- [x] 1.1 `npm test` runs and the smoke test passes
- [x] 1.2 `npm run lint` passes with the new files present
- [x] 1.3 `npm run typecheck` passes
- [x] 1.4 `npm run build` still succeeds

#### Manual

- [x] 1.5 `npm run test:watch` starts and re-runs on a saved edit
- [x] 1.6 Test output shows no `astro:env` or unresolved-alias warnings

### Phase 2: Risk #1 — Classification and Prompt Rules

#### Automated

- [ ] 2.1 `npm test` passes, including the boundary table and byte-identity assertions
- [ ] 2.2 The boundary table produces four named cases in the reporter
- [ ] 2.3 `npm run lint` and `npm run typecheck` pass

#### Manual

- [ ] 2.4 `AT_RISK_DAYS = 4` turns the `+4` case red, then reverted
- [ ] 2.5 Appending a word to `ANY_TECHNIQUE_LINE` turns byte identity red, then reverted

### Phase 3: Risk #1 — Outbound Payload and Guardrails

#### Automated

- [ ] 3.1 `npm test` passes all four groups
- [ ] 3.2 Guardrail cases assert rejection without asserting message text
- [ ] 3.3 No fixture in this file carries a past-dated `expiry_date`
- [ ] 3.4 `npm run lint` and `npm run typecheck` pass

#### Manual

- [ ] 3.5 Slicing before sorting turns the survival test red, then reverted
- [ ] 3.6 Deleting the at-risk floor guard turns case (b) red, then reverted

### Phase 4: Risk #6 — Failure Never Fakes Success

#### Automated

- [ ] 4.1 `npm test` passes all Risk #6 cases
- [ ] 4.2 No assertion compares a status to `500`
- [ ] 4.3 No assertion depends on `ZodError` or `SyntaxError` message content
- [ ] 4.4 `npm run lint` and `npm run typecheck` pass

#### Manual

- [ ] 4.5 Returning 200 with `{ recipe: null }` from the catch-all turns the endpoint test red, then reverted
- [ ] 4.6 Suite output is not polluted by `console.error`

### Phase 5: Mutation Gate, Cookbook, and Handoff

#### Automated

- [ ] 5.1 Stryker run over `recipe.service.ts` completes and produces an HTML report
- [ ] 5.2 `npm test` still passes after mutant-killing assertions
- [ ] 5.3 `npm run lint` passes
- [ ] 5.4 No TBD placeholder remains in test-plan §6.1, §6.2 or §6.3

#### Manual

- [ ] 5.5 Every survived mutant reviewed and killed or consciously accepted, reasoning in §6.5
- [ ] 5.6 The sort-before-slice mutant is killed, not accepted
- [ ] 5.7 Phase 1b's `change.md` reads as a complete brief on its own
