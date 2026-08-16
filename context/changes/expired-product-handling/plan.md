# Expired-product handling and the generation error contract — Implementation Plan

## Overview

Two behaviour changes ship together because they land in the same catch block.

**Risk #2** — `isAtRisk()` is one-sided, so a product that expired a year ago is
marked at-risk, sorted to the front of the prompt, and then _required_ by the
at-risk floor guard. This plan makes `expired` a real state, keeps past-dated
stock out of the prompt entirely, and tells the user what was left out.

**Risk #6 (remaining half)** — every one of ten failure classes collapses onto a
flat HTTP 500, and three of them render raw internal text as the user's toast.
This plan introduces a typed service error so the endpoint can translate failure
_class_ into a distinct status and a message that is safe to show.

Both were researched on 2026-08-15 and re-verified against the current tree on
2026-08-16: `git log 9281bc1..HEAD -- src/` touches only test files, so every
finding below holds verbatim.

## Current State Analysis

**The expired-product defect is live and compounding.**
`src/lib/services/product.service.ts:6-11` compares only against the upper bound:

- `product.service.ts:24,41` — every past date yields `is_at_risk = true`
- `recipe.service.ts:74` — at-risk items sort _ahead_ of fresh stock
- `recipe.service.ts:77` — so they are guaranteed to survive the 25-item cap
- `recipe.service.ts:91` — and are rendered under _"the recipe must use at least one of these"_
- `recipe.service.ts:165-170` — the floor guard then **throws** if the model sensibly avoided them

A user with one year-old yoghurt and ten fresh items cannot get any recipe unless
the model agrees to cook the yoghurt. There is no `expired` concept anywhere:
`types.ts:11` is `Product & { is_at_risk: boolean }`.

**The error path discards the one thing the endpoint needs.** The service knows
the failure class and signals by `throw`ing a bare `Error`; `generate.ts:64-67`
catches everything and returns `500` with `err.message` verbatim. The client
renders that string as a toast (`use-recipe-generation.ts:32-35`). Consequences:

| Class             | Raised at                   | Today                                                    |
| ----------------- | --------------------------- | -------------------------------------------------------- |
| timeout / abort   | `recipe.service.ts:132-134` | safe copy, 500                                           |
| 401 / 402         | `recipe.service.ts:60`      | safe copy, 500                                           |
| 429               | `recipe.service.ts:61`      | safe copy, 500                                           |
| other non-2xx     | `recipe.service.ts:62`      | safe copy, 500                                           |
| empty content     | `recipe.service.ts:150`     | names the provider, 500                                  |
| non-JSON body     | `recipe.service.ts:154`     | raw `SyntaxError` quoting model prose, 500               |
| schema violation  | `recipe.service.ts:154`     | ~700-byte `ZodError` dump incl. internal UUID regex, 500 |
| unknown ids       | `recipe.service.ts:159`     | "inventory guardrail violated" jargon, 500               |
| zero at-risk used | `recipe.service.ts:168`     | same jargon, 500                                         |
| database read     | `product.service.ts:20`     | raw PostgREST diagnostics, 500                           |

**What is already safe and must stay safe.** The provider key and the raw
OpenRouter body never reach the client — the body is `console.error`'d and a
sanitised message thrown (`recipe.service.ts:138-145`). Phase 1 pinned this.

**Call-site inventory** (determines blast radius):

- `generateRecipe` — exactly one caller, `generate.ts:59`
- `listProducts` — three callers: `inventory.astro:13`, `api/products/index.ts:26`, `generate.ts:49`
- `createProduct` — one caller, `api/products/index.ts:60`

**Phase 1's tests were written to make room for this change** and constrain it:

- `recipe.service.test.ts` asserts `rejects.toThrow()` bare on guardrail cases, and
  asserts message text _only_ for the four provider-fault strings — plus one test
  that those four stay **distinct** (`messages.size === 4`).
- `generate.test.ts` asserts `response.ok === false` / `status >= 400`, never `500`.
  Literal codes appear only where they are correct today (401, 400).
- Every fixture is future-dated on purpose, so this change cannot silently
  reclassify an existing case.

## Desired End State

- A past-dated product is classified `expired`, never `at-risk`, never reaches the
  prompt, and is reported back to the caller by id and name.
- An inventory where everything has expired returns a distinct 422 with copy that
  says so — not the untrue "Inventory is empty".
- Rate limit, timeout, provider fault, unusable model response, and datastore
  failure each return a different HTTP status, and every user-facing message is
  written by us — no `ZodError`, `SyntaxError`, or PostgREST text can reach a toast.
- The inventory list shows an "Expired" badge, and a generation that skipped
  expired stock says which products it skipped.

Verified by: `npx vitest run` green, `npm run typecheck` and `npm run lint` clean,
and a manual pass over the inventory screen with one past-dated product.

### Key Discoveries

- `src/lib/services/product.service.ts:6-11` — the one-sided comparison; the whole
  of Risk #2 originates here
- `src/lib/services/recipe.service.ts:165-170` — the floor guard that turns the
  defect into active harm; D2 dissolves it by construction rather than weakening it
- `src/lib/services/recipe.service.ts:138-145` — the existing sanitise-and-log
  pattern that the typed error should generalise, not replace
- `src/pages/api/recipes/generate.ts:31-38` — an absent body is a _valid_ request;
  pinned by two Phase 1 tests, must not be disturbed
- `src/components/inventory/inventory-panel.tsx:212-214` — the badge pattern to mirror
- `src/components/hooks/use-recipe-generation.ts:5` — `onApproveSuccess` is the
  existing shape for pushing a post-request signal to the component
- `vitest.config.ts` — `process.env.TZ = "UTC"` is set at config load, so date
  arithmetic in tests is deterministic without per-file pinning
- `context/foundation/test-plan.md` §7 — UI rendering is deliberately untested;
  Phase 6 therefore ships on manual verification only

## What We're NOT Doing

- **No database migration.** `is_expired` is derived on read, exactly like
  `is_at_risk`. The `products` table is untouched.
- **Not rejecting past-dated products at creation.** `POST /api/products` accepts
  any valid date; the UI's `min={today}` (`inventory-panel.tsx:180`) is a
  client-side convenience only. Server-side parameter trust is Risk #7, rollout
  Phase 3.
- **No UI tests, no snapshots, no e2e** — test-plan §7.
- **Not touching the approve path.** `approve_recipe` set identity is Risk #5,
  rollout Phase 2.
- **Not rewriting Phase 1's assertions.** Phase 1 tests change only where a new
  required field forces a fixture update (see Phase 1 below).
- **Not testing the timezone drift** documented in research Open Question #2 — the
  arithmetic is made drift-free in Phase 1, which removes the failure without
  pinning behaviour the product does not depend on.
- **No retry logic.** Distinguishing a retryable failure is in scope; acting on it
  automatically is not.

## Implementation Approach

Six phases in dependency order. Phases 1-3 are the expired-product sequence
(D1-D4); phases 4-5 are the error contract; phase 6 surfaces and closes out.

`change.md` is explicit that phases 1-3 and 4-5 are **two independent red-test
sequences** that both touch `generate.ts`'s catch block, and must not be run as
one. The split below honours that: nothing in phases 1-3 changes error handling,
and nothing in phases 4-5 changes inventory state.

Phases 1-5 are `/10x-tdd` (each has a nameable red test). Phase 6 is
`/10x-implement` — it is UI plus documentation, which §7 excludes from testing.

## Critical Implementation Details

**Ordering inside `generate.ts` is load-bearing.** The empty-inventory check
(`generate.ts:55`) must stay _first_: an empty inventory is not an all-expired
inventory, and reversing the two makes the 400 unreachable. The order is
empty → all-expired → generate.

**Adding a required field to `ProductWithRisk` breaks a Phase 1 fixture.**
`recipe.service.test.ts:36-45` constructs `ProductWithRisk` literals; they need
`is_expired: false` added. This is a mechanical type fix, not an assertion
rewrite — no `expect` in that file changes. Call it out in the commit so it is not
mistaken for regressing Phase 1's locks.

**One derivation point prevents the illegal state.** `is_at_risk` and `is_expired`
are mutually exclusive by construction only if both come from the same call. A
second call site that computes one without the other reintroduces the two-boolean
hazard the discriminated-union option would have made impossible.

---

## Phase 1: Three-state classification (D1)

### Overview

Make `isAtRisk()` two-sided and introduce `is_expired`, derived together at a
single point so the two flags can never disagree. No generation behaviour changes
yet — an expired product simply stops being labelled at-risk, which moves it from
the prompt's floor section into its optional section. Phase 2 removes it entirely.

### Changes Required:

#### 1. Expiry classification

**File**: `src/lib/services/product.service.ts`

**Intent**: Close the defect at its source. `isAtRisk()` gains a lower bound so
past dates fall out of the at-risk window, and a sibling predicate identifies
them as expired. Both are exposed through one classifier that callers use instead
of calling the predicates individually.

**Contract**: `isAtRisk(expiryDate)` is true iff `today <= expiryDate <= today + AT_RISK_DAYS`;
`isExpired(expiryDate)` is true iff `expiryDate < today`. A single exported
`classifyExpiry(expiryDate)` returns `{ is_at_risk, is_expired }` and is the only
thing `listProducts` and `createProduct` call. `AT_RISK_DAYS = 3` is unchanged and
the upper bound must not move — research's probe table confirms +3 inclusive /
+4 exclusive is already correct per `prd.md:31`.

Compute today and the threshold with UTC accessors rather than the current
`setDate()` + `toISOString()` mix. That pairing re-projects local wall-clock into
UTC and shifts the window by a day on a non-UTC machine (research, "a timezone
off-by-one in the upper bound"). Since this function is being rewritten anyway,
making it drift-free costs nothing and removes the hazard rather than documenting it.

#### 2. Product type

**File**: `src/types.ts`

**Intent**: Carry the new state to every consumer of a product read.

**Contract**: `ProductWithRisk = Product & { is_at_risk: boolean; is_expired: boolean }`.
Both flags remain server-derived; neither is ever read from a row.

#### 3. Phase 1 fixture repair

**File**: `src/lib/services/recipe.service.test.ts`

**Intent**: Keep the existing suite compiling after the type gains a required field.

**Contract**: the `product()` helper (lines 36-45) sets `is_expired: false`. No
assertion, oracle comment, or test name changes.

#### 4. Classification tests

**File**: `src/lib/services/product.service.test.ts`

**Intent**: Extend the boundary table with the negative offsets Phase 1
deliberately omitted, now that the oracle exists, and assert the flags are
mutually exclusive across the whole range.

**Contract**: the `it.each` table gains rows at −365, −30 and −1 (expired: `is_at_risk`
false, `is_expired` true) and keeps 0, +1, +3, +4. Its oracle comment cites
`research.md` D1 and `prd.md:31` rather than the implementation. The existing
`listProducts` tests extend to assert both derived flags, including that a row
arriving with a forged `is_expired` is overwritten.

### Success Criteria:

#### Automated Verification:

- Classification tests pass: `npx vitest run src/lib/services/product.service.test.ts`
- The full suite still passes: `npx vitest run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- A product dated yesterday no longer shows the "At risk" badge on `/inventory`
  (it shows no badge yet — Phase 6 adds "Expired")

---

## Phase 2: Exclusion from the prompt and the exclusion report (D2, D3a)

### Overview

The nameable first red test: _"a past-dated product is excluded from the prompt
and reported back to the caller."_ The endpoint splits the inventory and hands
`generateRecipe` only usable stock, so the service's signature and resolved shape
are untouched and Phase 1's success assertion survives.

### Changes Required:

#### 1. Endpoint-side split

**File**: `src/pages/api/recipes/generate.ts`

**Intent**: Expired products never reach the model, and the caller learns which
ones were held back.

**Contract**: after `listProducts` and the existing empty check, partition on
`is_expired`. `generateRecipe` receives only the non-expired products. A
successful response becomes `{ recipe, excluded_expired }`, where
`excluded_expired` is an array of `{ id, name }` — empty when nothing was
excluded, so the key is always present and callers need no presence check.

#### 2. Response type

**File**: `src/types.ts`

**Intent**: Name the new contract so the endpoint and the client hook agree.

**Contract**: an `ExcludedProduct` shape of `{ id: string; name: string }`.
Deliberately not the full `Product`: `expiry_date` and `user_id` are not needed to
tell a user what was skipped, and a narrower payload is a narrower leak surface.

#### 3. Exclusion tests

**File**: `src/pages/api/recipes/generate.test.ts`

**Intent**: Prove the exclusion at the seam where it is observable — the outbound
user turn — and prove the report is exact.

**Contract**: new cases over a mixed inventory (one expired, one fresh) assert the
expired id appears nowhere in the outbound prompt body, that `excluded_expired`
contains exactly the expired product's id and name, and that the recipe still
generates. A fresh-only inventory asserts `excluded_expired` is empty. The
existing `productRow` helper gains a date offset parameter so a past-dated row can
be built; its current callers keep the +30 default.

### Success Criteria:

#### Automated Verification:

- Endpoint tests pass: `npx vitest run src/pages/api/recipes/generate.test.ts`
- The full suite still passes: `npx vitest run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- With one expired and several fresh products, generation succeeds and the
  response body (browser devtools, Network tab) lists the expired product under
  `excluded_expired`

---

## Phase 3: The all-expired branch (D4)

### Overview

An inventory where everything has expired currently falls through to
`generate.ts:55` and is told _"Inventory is empty — add a product first"_, which
is untrue and unactionable. It gets its own status and its own message.

### Changes Required:

#### 1. Distinct precondition branch

**File**: `src/pages/api/recipes/generate.ts`

**Intent**: Separate "you have nothing" from "everything you have has expired" so
the user is told the truth and the client can branch on status.

**Contract**: after the partition from Phase 2, a non-empty inventory whose usable
set is empty returns **422** with a message naming expired stock as the reason.
The genuinely-empty case keeps its **400** and its existing message. Ordering is
empty → all-expired → generate; neither branch calls the provider.

#### 2. Branch tests

**File**: `src/pages/api/recipes/generate.test.ts`

**Intent**: Pin both the distinction and the resource-abuse property.

**Contract**: an all-expired inventory returns 422; an empty inventory still
returns 400; the two messages differ; `fetch` is not called in either case —
following the existing precondition-test pattern at lines 172-195, where asserting
the provider was never called is what proves the check runs _before_ the spend.

### Success Criteria:

#### Automated Verification:

- Endpoint tests pass: `npx vitest run src/pages/api/recipes/generate.test.ts`
- The full suite still passes: `npx vitest run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- An inventory containing only past-dated products shows a message about expired
  stock, not "Inventory is empty"

---

## Phase 4: Typed service error and distinct statuses (Risk #6a)

### Overview

The first half of the error contract: give the endpoint the failure _class_ it
currently discards, and map each class to a status that means something. Message
wording is unchanged in this phase — the four provider-fault strings Phase 1 pinned
stay exactly as they are.

### Changes Required:

#### 1. The error type

**File**: `src/lib/services/service-error.ts` (new)

**Intent**: One error type carrying everything the endpoint needs to answer, so
translation is a lookup rather than a guess.

**Contract**: an `Error` subclass with a `kind` discriminant naming the failure
class — rate limit, timeout, provider unavailable, upstream fault, unusable model
response, data access — plus a `status` and a user-safe `message`. Status and
message are derived from a single table keyed by `kind`, so a class cannot exist
without both. Nothing else in the codebase constructs one of these; the service
layer is its only producer.

**Class → status map** (this is the contract other phases depend on):

| `kind`                  | Status | Covers                                                                |
| ----------------------- | ------ | --------------------------------------------------------------------- |
| rate limit              | 429    | upstream 429                                                          |
| timeout                 | 504    | `TimeoutError` / `AbortError`                                         |
| provider unavailable    | 503    | upstream 401 / 402 — our account is unusable                          |
| upstream fault          | 502    | any other non-2xx from the provider                                   |
| unusable model response | 502    | empty content, non-JSON, schema violation, unknown ids, at-risk floor |
| data access             | 500    | datastore read failure                                                |

#### 2. Service throw sites

**Files**: `src/lib/services/recipe.service.ts`, `src/lib/services/product.service.ts`

**Intent**: Replace bare `Error` throws with typed ones, preserving today's wording.

**Contract**: the sites at `recipe.service.ts:60-62,133,150,159,168` and
`product.service.ts:20` throw the typed error with the matching `kind`. The
existing sanitise-and-log behaviour at `recipe.service.ts:138-145` is unchanged —
the upstream body still goes to `console.error` and never into the message. The
non-abort rethrow at `recipe.service.ts:135` stays a rethrow: a transport failure
is not a timeout, and Phase 1 has a test saying so.

#### 3. Endpoint translation

**File**: `src/pages/api/recipes/generate.ts`

**Intent**: Answer with the class the service named, and refuse to pass anything
else through.

**Contract**: the catch block returns the typed error's status and message. Any
error that is _not_ the typed kind — an unconverted throw site, a bug in our own
code, a library throwing from somewhere unexpected — becomes a generic 500 with a
message we wrote. This is the load-bearing property: hygiene comes from the
allowlist being a _type_, not from remembering to sanitise.

#### 4. Status tests

**Files**: `src/lib/services/recipe.service.test.ts`, `src/pages/api/recipes/generate.test.ts`

**Intent**: Assert the property the test plan asks for — classes are
distinguishable — rather than memorising six numbers.

**Contract**: an endpoint-level table drives each failure class through the stubbed
provider and asserts its status. One test collects the statuses across classes and
asserts they are distinct where the map says they differ, mirroring the existing
`messages.size` test at `recipe.service.test.ts:436-448`. One test asserts an
untyped throw becomes 500 with our generic copy and not the thrown text. Phase 1's
existing `ok === false` assertions keep passing unchanged — they were written to
survive exactly this.

### Success Criteria:

#### Automated Verification:

- Service tests pass: `npx vitest run src/lib/services/recipe.service.test.ts`
- Endpoint tests pass: `npx vitest run src/pages/api/recipes/generate.test.ts`
- The full suite still passes: `npx vitest run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- With an invalid `OPENROUTER_API_KEY`, generation returns 503 rather than 500
  (browser devtools, Network tab)

---

## Phase 5: Message hygiene and guardrail copy (Risk #6b)

### Overview

The second half: the three sites that leak raw internal text stop doing so, and
the guardrail jargon becomes something a user can act on. Statuses from Phase 4
are unchanged.

### Changes Required:

#### 1. Wrap the leaking sites

**File**: `src/lib/services/recipe.service.ts`

**Intent**: `ZodError` and `SyntaxError` carry text written by zod and by the
model. Neither is ours, so neither may be shown.

**Contract**: the `JSON.parse` + schema parse at line 154 is wrapped so both
failures surface as the _unusable model response_ kind. The original error goes to
`console.error` for diagnosis, following the pattern already at lines 138-145 — the
requirement is that the detail reaches the log, not that it is discarded.

#### 2. Wrap the datastore site

**File**: `src/lib/services/product.service.ts`

**Intent**: PostgREST diagnostics are a second upstream leaking where OpenRouter's
was carefully suppressed.

**Contract**: `line 20` throws the _data access_ kind with our own copy; the
PostgREST message goes to `console.error`. `createProduct` and `deleteProduct`
throw sites are converted the same way for consistency, since they are the same
class of leak reached through a different route.

#### 3. Guardrail copy

**File**: `src/lib/services/recipe.service.ts`

**Intent**: _"inventory guardrail violated"_ is correct detection with wrong
presentation. The three guardrail outcomes plus the empty-response case all mean
one thing to a user: the suggestion that came back cannot be used, and generating
again is likely to work.

**Contract**: the sites at lines 150, 159 and 168 share one user-facing message to
that effect, and all carry the _unusable model response_ kind. The wording avoids
"didn't match your inventory" — accurate for the two guardrails, false for an empty
provider response, and the four share a message precisely because a user acts the
same way on all of them. The specific cause is still distinguishable in the server
log, which is where that distinction is useful.

#### 4. Hygiene tests

**File**: `src/lib/services/recipe.service.test.ts`

**Intent**: Assert the negative that matters, using the technique Phase 1
established for the credential tests.

**Contract**: a malformed-JSON case asserts the response carries neither the
model's prose nor the word `SyntaxError`; a schema-violation case asserts it
carries no `ZodError` fragment and not the internal UUID `pattern`; a datastore
failure asserts no PostgREST text survives. Each first asserts the raw text really
was produced upstream, so the negative cannot pass vacuously — the guard pattern
from `recipe.service.test.ts:500`. Phase 1's rule still applies: assert the class
of failure, never a snapshot of the string.

### Success Criteria:

#### Automated Verification:

- Service tests pass: `npx vitest run src/lib/services/recipe.service.test.ts`
- The full suite still passes: `npx vitest run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Scoped mutation run over the changed translation path:
  `npx stryker run --mutate "src/lib/services/recipe.service.ts"`

#### Manual Verification:

- Survived mutants reviewed one by one; an assertion added only where the mutant
  represents a user-visible bug (CLAUDE.md — do not chase 100%)
- A forced malformed provider response produces a readable toast, not a JSON dump

---

## Phase 6: UI surfacing and rollout close-out

### Overview

D3's two surfaces, plus the test-plan bookkeeping that closes rollout Phase 1b.
Not TDD — §7 excludes UI from the test base, so this phase ships on manual
verification.

### Changes Required:

#### 1. Expired badge

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: An expired product currently loses its (wrong) "At risk" badge in
Phase 1 and gains nothing, which makes the list less informative than before. The
badge closes that gap.

**Contract**: alongside the at-risk badge at lines 212-214, an "Expired" badge
rendered on `is_expired`, mirroring the existing markup with a visually distinct
colour. The two are mutually exclusive by construction, so no precedence logic.

#### 2. Exclusion toast

**Files**: `src/components/hooks/use-recipe-generation.ts`, `src/components/inventory/inventory-panel.tsx`

**Intent**: Tell the user at the moment of generation which products were skipped.

**Contract**: the hook reads `excluded_expired` from the response and reports it
through an optional callback in its existing `Options` object, mirroring
`onApproveSuccess` (line 5). The panel passes a handler that raises a toast naming
the skipped products, and raises nothing when the list is empty.

#### 3. Test-plan sync

**File**: `context/foundation/test-plan.md`

**Intent**: Close rollout Phase 1b and record what the phase taught.

**Contract**: §3 row 1b Status → `complete`. A §6.5 note covering the typed-error
pattern, the endpoint-side partition, and anything surprising the phases surfaced.
§1, §2 and §7 are not edited — those move only under `/10x-test-plan --refresh`.

#### 4. Change record

**File**: `context/changes/expired-product-handling/change.md`

**Intent**: Reflect the shipped state.

**Contract**: `status: complete`, `updated` stamped.

### Success Criteria:

#### Automated Verification:

- The full suite still passes: `npx vitest run`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- A past-dated product shows an "Expired" badge, visually distinct from "At risk"
- Generating with a mixed inventory raises a toast naming the skipped products
- Generating with an all-fresh inventory raises no such toast
- The recipe never contains an expired ingredient

---

## Testing Strategy

### Unit Tests

- Boundary table over −365, −30, −1, 0, +1, +3, +4 with the clock frozen; the
  first row outside each edge is the interesting one (§6.1)
- The two flags are mutually exclusive at every offset
- Derived flags overwrite forged values arriving on a row

### Integration Tests

- Expired products appear nowhere in the outbound prompt body
- `excluded_expired` is exact set identity against the expired input, not a count
- All-expired → 422, empty → 400, distinct messages, provider never called
- Each failure class maps to its status, and the classes stay distinguishable
- An untyped throw becomes a generic 500 carrying our copy, not the thrown text
- No `ZodError`, `SyntaxError`, PostgREST text, provider key, or upstream body
  reaches the response — each guarded against passing vacuously

### Manual Testing Steps

1. Add a product dated yesterday and one dated in 30 days; confirm the "Expired"
   badge and no "At risk" badge on the past-dated one.
2. Generate a recipe; confirm it succeeds, the expired product is not an
   ingredient, and a toast names it as skipped.
3. Delete the fresh product, leaving only expired stock; generate; confirm the
   message names expired stock and the response is 422.
4. Break `OPENROUTER_API_KEY`; generate; confirm a 503 and a clean toast.
5. Delete every product; generate via the API directly; confirm 400 and the
   original empty-inventory copy.

## Performance Considerations

None material. The partition is one pass over an inventory bounded in practice by
what a person keeps in a fridge, and it runs _before_ the 25-item prompt cap, so
the outbound payload can only get smaller.

## Migration Notes

No database migration. Both flags are derived on read, so existing rows need no
backfill and a rollback is a pure code revert. Expired rows that pre-date this
change are reclassified the moment they are read.

## References

- Change record: `context/changes/expired-product-handling/change.md`
- Research (oracle D1-D5, Risk #6 failure inventory):
  `context/changes/testing-recipe-generation-core/research.md`
- Test plan (§2 risks, §6 cookbook, §7 exclusions): `context/foundation/test-plan.md`
- Cookbook patterns this plan follows: test-plan §6.1, §6.2, §6.3
- Prior art for the sanitise-and-log pattern: `src/lib/services/recipe.service.ts:138-145`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Three-state classification (D1)

#### Automated

- [x] 1.1 Classification tests pass: `npx vitest run src/lib/services/product.service.test.ts` — 8fac27d
- [x] 1.2 The full suite still passes: `npx vitest run` — 8fac27d
- [x] 1.3 Type checking passes: `npm run typecheck` — 8fac27d
- [x] 1.4 Linting passes: `npm run lint` — 8fac27d

#### Manual

- [x] 1.5 A product dated yesterday no longer shows the "At risk" badge — 8fac27d

### Phase 2: Exclusion from the prompt and the exclusion report (D2, D3a)

#### Automated

- [x] 2.1 Endpoint tests pass: `npx vitest run src/pages/api/recipes/generate.test.ts` — f872bdd
- [x] 2.2 The full suite still passes: `npx vitest run` — f872bdd
- [x] 2.3 Type checking passes: `npm run typecheck` — f872bdd
- [x] 2.4 Linting passes: `npm run lint` — f872bdd

#### Manual

- [x] 2.5 Generation succeeds and the response lists the expired product under `excluded_expired` — f872bdd

### Phase 3: The all-expired branch (D4)

#### Automated

- [x] 3.1 Endpoint tests pass: `npx vitest run src/pages/api/recipes/generate.test.ts`
- [x] 3.2 The full suite still passes: `npx vitest run`
- [x] 3.3 Type checking passes: `npm run typecheck`
- [x] 3.4 Linting passes: `npm run lint`

#### Manual

- [ ] 3.5 An all-expired inventory shows a message about expired stock, not "Inventory is empty"

### Phase 4: Typed service error and distinct statuses (Risk #6a)

#### Automated

- [ ] 4.1 Service tests pass: `npx vitest run src/lib/services/recipe.service.test.ts`
- [ ] 4.2 Endpoint tests pass: `npx vitest run src/pages/api/recipes/generate.test.ts`
- [ ] 4.3 The full suite still passes: `npx vitest run`
- [ ] 4.4 Type checking passes: `npm run typecheck`
- [ ] 4.5 Linting passes: `npm run lint`

#### Manual

- [ ] 4.6 An invalid provider key returns 503 rather than 500

### Phase 5: Message hygiene and guardrail copy (Risk #6b)

#### Automated

- [ ] 5.1 Service tests pass: `npx vitest run src/lib/services/recipe.service.test.ts`
- [ ] 5.2 The full suite still passes: `npx vitest run`
- [ ] 5.3 Type checking passes: `npm run typecheck`
- [ ] 5.4 Linting passes: `npm run lint`
- [ ] 5.5 Scoped mutation run: `npx stryker run --mutate "src/lib/services/recipe.service.ts"`

#### Manual

- [ ] 5.6 Survived mutants reviewed one by one; assertions added only for user-visible bugs
- [ ] 5.7 A forced malformed provider response produces a readable toast, not a JSON dump

### Phase 6: UI surfacing and rollout close-out

#### Automated

- [ ] 6.1 The full suite still passes: `npx vitest run`
- [ ] 6.2 Type checking passes: `npm run typecheck`
- [ ] 6.3 Linting passes: `npm run lint`
- [ ] 6.4 Build passes: `npm run build`

#### Manual

- [ ] 6.5 A past-dated product shows an "Expired" badge, visually distinct from "At risk"
- [ ] 6.6 A mixed inventory raises a toast naming the skipped products
- [ ] 6.7 An all-fresh inventory raises no such toast
- [ ] 6.8 The recipe never contains an expired ingredient
