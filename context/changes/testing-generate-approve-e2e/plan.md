# E2E: generate→approve→removal wiring Implementation Plan

## Overview

Add one Playwright E2E test that proves the generate→approve→removal loop's UI wiring
matches its already-proven API contract — Risk #8 in `context/foundation/test-plan.md`
(§3 Phase 5). The DB/RPC layer (atomicity, exact-set deletion) was already closed by the
`testing-approval-contract-integrity` phase; this plan protects the layer above it: that
the Generate button hits the right endpoint with the right params, the approval dialog
shows the right product names, the Approve button sends the right body, and the DOM (not
just a toast) reflects the real outcome — surviving a real page reload.

## Current State Analysis

- The whole loop lives on one page, `/inventory` (`InventoryPanel`, `src/components/inventory/inventory-panel.tsx`).
  There is no separate "approval screen" — Generate opens a Radix `AlertDialog` showing
  the recipe plus a "Will remove from inventory: `<names>`" line (lines 384-390), with
  Cancel / "Generate Different Recipe" / Approve buttons.
- `useRecipeGeneration` (`src/components/hooks/use-recipe-generation.ts`): `generate()`
  POSTs `/api/recipes/generate`; `approve()` POSTs `/api/recipes/approve` with the **full**
  recipe body (`title`, `ingredients`, `instructions`) plus `usedProductIds` — nothing is
  persisted server-side until approval succeeds, so there is no recipe id to approve
  against.
- Success/failure render via `sonner` toasts on error; success is dialog-close plus
  in-place list diffing on the response's `deletedIds` — no redirects anywhere in this flow.
- Recipe history lives at `/recipes` (`RecipeHistoryPanel`); a newly approved recipe should
  appear as the first `<li>` after navigating there.
- Playwright is already wired: `tests/auth.setup.ts` logs in via a direct API POST (not the
  UI) to `/api/auth/signin` and writes `playwright/.auth/user.json`, reused by all three
  browser projects (`playwright.config.ts`). `tests/seed.spec.ts` is the one existing
  exemplar — `getByRole`/`getByLabel` locators, a `Date.now()`-uniqued product name, no
  `waitForTimeout`, and self-cleanup at the end of the test body. The local Supabase seed
  (`supabase/seed.sql`) provides a working `test@example.com` login but seeds **no**
  products or recipes — every run starts from a clean inventory and empty history.
- `recipe.service.ts` calls a real external model (OpenRouter) **server-side** —
  `OPENROUTER_URL` is currently a hardcoded literal
  (`recipe.service.ts:17`), not env-configurable, unlike `OPENROUTER_API_KEY` which already
  comes through `astro:env/server`. `test-plan.md` §7 already excludes live model calls
  from CI (rate-limited, ~27s observed latency), and a server-side `fetch` cannot be
  intercepted by Playwright's `page.route()` — so this plan needs a deterministic stand-in
  reachable by the dev server, not a browser-level mock.
- `approve_recipe`'s atomicity and exact-set-deletion guarantees are already proven by
  `context/changes/testing-approval-contract-integrity/plan.md` (complete, all phases
  landed) — this plan does not re-test them.

## Desired End State

- `OPENROUTER_URL` is a declared, optional `astro:env/server` field (default: the real
  OpenRouter endpoint), read by `recipe.service.ts` instead of the hardcoded literal.
  Existing unit/integration tests are unaffected.
- A new Playwright spec drives the real `/inventory` → generate → approve → `/recipes`
  flow against a locally stubbed model response, asserting the product is actually gone
  from inventory (surviving a reload) and the approved recipe appears in history.

### Key Discoveries:

- `recipe.service.ts:186-198` — the model response is parsed from
  `data.choices?.[0]?.message?.content`, itself a JSON **string** re-parsed and validated
  against `GeneratedRecipeSchema`. Any stub must nest its canned recipe this way, not as a
  bare top-level object.
- `recipe.service.ts:214-220` — `generateRecipe` rejects any `used_product_ids` not present
  in the prompt's own product list (the `validIds` cross-check). A static canned UUID in
  the stub will always fail this guardrail and surface as a toast error instead of opening
  the approval dialog — the stub must echo back the _real_ product id.
- `recipe.service.ts:116` — the prompt renders each product as
  `` `${sanitizeName(p.name)} (id: ${p.id})` `` in the user turn, so the real id is
  recoverable from the outbound request body via a simple regex.
- `playwright.config.ts` has no `webServer` block — the app is assumed already running
  (existing project convention); this plan's stub must be reachable by whatever process is
  already running `npm run dev`, not started fresh by Playwright.

## What We're NOT Doing

- Not re-testing `approve_recipe`'s atomicity or set-identity guarantees (already proven).
- Not adding a second E2E test for the forced-failure or skip/toast (concurrent-deletion)
  paths — one happy-path test, per the E2E skill's tight test budget.
- Not adding a delete-recipe capability for test cleanup — the recipe row this test creates
  is left in the local dev DB until the next `npx supabase db reset`, matching the project's
  reuse-what-exists principle.
- Not adding a companion integration test for `approve.ts`'s endpoint-level zod
  validation/error-mapping, even though research found it currently untested — that gap is
  a separate, unclaimed risk, not Risk #8.
- Not restricting the new spec to a single browser project — it runs on all three
  (chromium, firefox, webkit), consistent with `seed.spec.ts`.

## Implementation Approach

Two phases: first make the model boundary configurable (a small, isolated production
change plus updated test mocks), then add the E2E test itself with a spec-local stub
server. Splitting them means Phase 1's automated verification is the existing fast unit
suite, and Phase 2 is the one slow, browser-driven phase — a clean pause point between
them.

## Critical Implementation Details

- **Stub response envelope.** The stub must return
  `{ choices: [{ message: { content: "<json-string>" } }] }`, where `content` is a
  `JSON.stringify`'d `{ title, ingredients, instructions, used_product_ids }` object — not
  a plain JSON body. Getting this wrong fails silently into `unusable_model_response`
  rather than a connection error, which is harder to debug.
- **Echo the real product id.** Extract it from the incoming request body with
  `/\(id: ([0-9a-fA-F-]{36})\)/` against the last user-turn message content, and put that
  same id in `used_product_ids`. A mismatched or fabricated id trips the guardrail at
  `recipe.service.ts:216` and the dialog never opens.
- **The dev server must already be pointed at the stub before the test starts.** Astro
  resolves `astro:env/server` values when the server process starts, and
  `playwright.config.ts` has no `webServer` block — so whoever runs this spec must start
  the dev server with `OPENROUTER_URL=http://127.0.0.1:4399/mock-openrouter` already set.
  `.env.e2e` (committed — carries no secret, just the loopback stub URL) plus
  `npm run dev:e2e` (`astro dev --mode e2e`) does this: Astro/Vite loads `.env.[mode]` on
  top of `.env` automatically when `--mode` is passed, so the override is documented and
  reproducible without touching the shared `.env`/`.env.local` files. The spec's
  `test.beforeAll` only needs to have something listening on that port by the time the
  test's fetch fires, not before the dev server starts — but the env var itself must
  already be set at dev-server startup.
- **The stub port collides across concurrent Playwright projects.** `OPENROUTER_URL` is
  fixed at dev-server startup, so the stub in `tests/generate-approve.spec.ts` binds a
  fixed port (4399), not an ephemeral one. Running more than one `--project` in the same
  invocation (or the config's default fully-parallel multi-project run) races multiple
  workers for that port and fails with `EADDRINUSE`. Run the three Success Criteria
  commands below one at a time, not combined.

## Phase 1: Make the OpenRouter endpoint configurable

### Overview

Turn `OPENROUTER_URL` from a hardcoded literal into an optional `astro:env/server` field,
so a local run can point the model call at a stub without touching `recipe.service.ts`'s
logic. Existing behavior (and existing tests) must be unaffected when the var is unset.

### Changes Required:

#### 1. Declare the env field

**File**: `astro.config.mjs`

**Intent**: Add `OPENROUTER_URL` alongside the existing `OPENROUTER_API_KEY` declaration,
so it resolves through the same `astro:env/server` mechanism the rest of the codebase
already uses for server config.

**Contract**: `OPENROUTER_URL: envField.string({ context: "server", access: "public", optional: true, default: "https://openrouter.ai/api/v1/chat/completions" })`.
`access: "public"` (not `"secret"`) because a URL carries no credential — matches the
semantic distinction from `OPENROUTER_API_KEY`, which stays `"secret"`.

#### 2. Read it in the service

**File**: `src/lib/services/recipe.service.ts`

**Intent**: Replace the hardcoded `const OPENROUTER_URL = "..."` with the env-resolved
value so `generateRecipe`'s `fetch` call target becomes overridable.

**Contract**: Change the import at line 3 to
`import { OPENROUTER_API_KEY, OPENROUTER_URL } from "astro:env/server";` and delete the
literal `const OPENROUTER_URL = ...` at line 17. No other logic in `generateRecipe`
changes.

#### 3. Keep existing tests green

**File**: `src/lib/services/recipe.service.test.ts`

**Intent**: The file's `vi.mock("astro:env/server", ...)` currently only exports
`OPENROUTER_API_KEY`; once `recipe.service.ts` also imports `OPENROUTER_URL` from that
module, the mock must export it too — otherwise the import resolves to `undefined` and
`fetch` is called with an undefined URL, breaking every test in this file.

**Contract**: Add `OPENROUTER_URL: "https://openrouter.ai/api/v1/chat/completions"`
(the real literal, so any existing assertion on the request URL still holds) to the
`vi.mock("astro:env/server", () => ({ ... }))` factory.

#### 4. Same fix, second test file

**File**: `src/pages/api/recipes/generate.test.ts`

**Intent**: Same reasoning as #3 — this file also mocks `astro:env/server` for
`OPENROUTER_API_KEY` and needs the same addition to avoid an undefined fetch URL.

**Contract**: Add `OPENROUTER_URL: "https://openrouter.ai/api/v1/chat/completions"` to its
`vi.mock("astro:env/server", () => ({ ... }))` factory.

#### 5. Document the override

**File**: `.env.example`

**Intent**: Make the new optional var discoverable for a future developer setting up local
e2e runs.

**Contract**: Add a line `# OPENROUTER_URL=` with a short comment noting it's optional,
defaults to the real OpenRouter endpoint, and is only overridden for local e2e stubbing.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Recipe service tests pass unchanged: `npx vitest run src/lib/services/recipe.service.test.ts`
- Generate endpoint tests pass unchanged: `npx vitest run src/pages/api/recipes/generate.test.ts`
- Full unit/integration suite passes: `npm run test`

#### Manual Verification:

- The `.env.example` comment is clear enough that a developer unfamiliar with this change
  understands the var is optional and what it's for

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 2: Add the generate→approve→removal E2E test

### Overview

Add the one risk-tied Playwright spec: a spec-local stub server standing in for
OpenRouter, and a test that drives the real UI through generate → approve → removal →
history, asserting on actual DOM/data state rather than toast text.

### Changes Required:

#### 1. The E2E spec

**File**: `tests/generate-approve.spec.ts`

**Intent**: Protect Risk #8 end-to-end: a real browser session generates a recipe, reaches
the approval dialog, approves, and the test confirms the used product is gone from
`/inventory` (including after a reload) and the recipe appears on `/recipes`.

**Contract**:

- `test.beforeAll`: start a plain `node:http` server on `127.0.0.1:4399`. On each request,
  read the body, extract the real product id via
  `/\(id: ([0-9a-fA-F-]{36})\)/.exec(body)`, and respond `200` with
  `{ choices: [{ message: { content: JSON.stringify({ title, ingredients, instructions, used_product_ids: [extractedId] }) } }] }`
  using a fixed canned title/ingredients/instructions.
- `test.afterAll`: close that server.
- Test body, following `tests/seed.spec.ts`'s style (timestamped unique name, `getByRole`/
  `getByLabel` locators, no `waitForTimeout`):
  1. `page.goto("/inventory")`; add one product via the UI form with a `Date.now()`-uniqued
     name and an expiry ~7 days out (keeps it off the at-risk path, matching the seed test).
  2. Click `getByRole("button", { name: "Generate Recipe" })`.
  3. Wait for the approval dialog; assert its "Will remove from inventory" text contains
     the product name.
  4. Click `getByRole("button", { name: "Approve", exact: true })`; wait for the dialog to
     close.
  5. Assert the product name is no longer visible in the inventory list.
  6. `page.reload()`; assert the product is still not visible (proves DB-level removal, not
     just optimistic client state).
  7. `page.goto("/recipes")`; assert the stubbed recipe's title appears in the history list.
- No cleanup of the created recipe row (see What We're NOT Doing).

### Success Criteria:

#### Automated Verification:

- Spec passes on chromium: `npx playwright test tests/generate-approve.spec.ts --project=chromium`
- Spec passes on firefox: `npx playwright test tests/generate-approve.spec.ts --project=firefox`
- Spec passes on webkit: `npx playwright test tests/generate-approve.spec.ts --project=webkit`

#### Manual Verification:

- Run the flow once in headed mode (`--headed`) to confirm the approval dialog's copy and
  the Approve/Cancel interactions look and feel correct
- Confirm a developer following only `.env.example` plus this plan can reproduce a passing
  local run from a clean checkout

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Phase 1 relies entirely on the existing `recipe.service.test.ts` and `generate.test.ts`
  suites continuing to pass — no new unit tests are added, since the change is a pure
  configuration indirection with no new branching logic.

### Integration Tests:

- None added — Risk #8 is specifically about UI wiring the integration layer cannot see
  (per `test-plan.md`'s Risk #8 evidence); the existing integration suite for
  `approveRecipe`/`approve_recipe` already covers the layer below this test.

### Manual Testing Steps:

1. Run `npm run dev:e2e` (loads `.env.e2e` — see Critical Implementation Details), then
   run the Phase 2 spec headed and watch the dialog open/close.
2. Confirm the product removed matches exactly the one shown in the "Will remove from
   inventory" line.
3. Confirm the approved recipe's title is visible on `/recipes` without needing a manual
   page refresh beyond the test's own navigation.

## Performance Considerations

None — the stub server responds in-process with no network latency, so this test should
run in low single-digit seconds per browser project, well under the ~27s the real model
would add.

## Migration Notes

Not applicable — no data migration involved.

## References

- Risk source: `context/foundation/test-plan.md` §2 Risk #8, §2 Risk Response Guidance
  row #8, §3 Phase 5
- Prior phase this builds on: `context/changes/testing-approval-contract-integrity/plan.md`
  (complete — proves `approve_recipe` atomicity and set-identity)
- E2E exemplar: `tests/seed.spec.ts`
- Auth/storageState wiring: `tests/auth.setup.ts`, `playwright.config.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Make the OpenRouter endpoint configurable

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 5f0c5cf
- [x] 1.2 Lint passes: `npm run lint` — 5f0c5cf
- [x] 1.3 Recipe service tests pass unchanged: `npx vitest run src/lib/services/recipe.service.test.ts` — 5f0c5cf
- [x] 1.4 Generate endpoint tests pass unchanged: `npx vitest run src/pages/api/recipes/generate.test.ts` — 5f0c5cf
- [x] 1.5 Full unit/integration suite passes: `npm run test` — 5f0c5cf

#### Manual

- [x] 1.6 `.env.example` comment is clear about the optional override — 5f0c5cf

### Phase 2: Add the generate→approve→removal E2E test

#### Automated

- [x] 2.1 Spec passes on chromium: `npx playwright test tests/generate-approve.spec.ts --project=chromium`
- [x] 2.2 Spec passes on firefox: `npx playwright test tests/generate-approve.spec.ts --project=firefox`
- [x] 2.3 Spec passes on webkit: `npx playwright test tests/generate-approve.spec.ts --project=webkit`

#### Manual

- [ ] 2.4 Headed run confirms dialog copy and Approve/Cancel interactions
- [ ] 2.5 A developer can reproduce a passing local run from `.env.example` + this plan
