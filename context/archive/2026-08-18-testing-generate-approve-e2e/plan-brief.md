# E2E: generate→approve→removal wiring — Plan Brief

> Full plan: `context/changes/testing-generate-approve-e2e/plan.md`

## What & Why

Add a Playwright test that proves the generate→approve→removal loop's UI wiring matches
its API contract, from a real browser. This is Risk #8 in `context/foundation/test-plan.md`:
the existing integration tests call the API directly, bypassing the DOM entirely, so a
control wired to the wrong endpoint, a dropped client param, or a false success state would
currently pass every test in the suite and only fail for a real user.

## Starting Point

The generate→approve loop lives entirely on `/inventory` (no separate approval screen) —
a dialog opens on Generate, shows the recipe and which products it will remove, and Approve
sends the full recipe body plus the used product ids to the server. The DB/RPC layer
(atomicity, exact-set deletion) is already proven by the completed
`testing-approval-contract-integrity` phase; nothing above that layer — the UI's wiring —
has been tested yet.

## Desired End State

A single E2E test drives the real flow: add a product, generate a recipe, approve it,
confirm the product is gone from inventory (surviving a page reload), and confirm the
recipe shows up in history — all against a locally stubbed model response instead of the
real, slow, rate-limited OpenRouter call.

## Key Decisions Made

| Decision                           | Choice                                           | Why (1 sentence)                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model boundary                     | Local stub server + new `astro:env/server` field | `OPENROUTER_URL` was a hardcoded literal, not overridable; making it configurable (mirroring `OPENROUTER_API_KEY`) lets a stub replace the real 27s, rate-limited call without touching request logic |
| Test scope                         | One happy-path test only                         | Matches the E2E skill's tight test budget; real DOM assertions at each step already catch "success shown despite failure" without a dedicated failure-path test                                       |
| Test data cleanup                  | Accept accumulation                              | No delete-recipe endpoint exists; building one solely for test cleanup is scope creep beyond Risk #8                                                                                                  |
| `approve.ts` endpoint-contract gap | Out of scope                                     | Found during research (no route-level test for its zod validation/error mapping) but is a separate, unclaimed risk, not Risk #8                                                                       |
| Stub server location               | Spec-local `test.beforeAll`/`afterAll`           | No shared Playwright config changes for a need only this one test has today                                                                                                                           |
| Browser coverage                   | All three configured projects                    | Consistent with the existing `seed.spec.ts`, no special-casing                                                                                                                                        |

## Scope

**In scope:**

- Making `OPENROUTER_URL` configurable via `astro:env/server`
- One new E2E spec covering generate → approve → inventory removal → history appearance
- A spec-local stub standing in for the OpenRouter call

**Out of scope:**

- Re-testing `approve_recipe` atomicity/set-identity (already proven)
- A dedicated failure-path or skip/toast E2E test
- A delete-recipe endpoint or any other test-cleanup infrastructure
- Closing the `approve.ts` endpoint-level test-coverage gap found during research

## Architecture / Approach

Two phases. Phase 1 makes the model call's target URL env-configurable (small, isolated,
verified by the existing fast unit suite). Phase 2 adds the actual E2E spec, which starts a
tiny local HTTP server that echoes the real product id back inside a canned OpenRouter-shaped
response — the dev server must already be pointed at that stub's port via `.env` before it
starts, since Playwright has no `webServer` block here and assumes the app is already
running.

## Phases at a Glance

| Phase                               | What it delivers                                                     | Key risk                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Configurable OpenRouter endpoint | `OPENROUTER_URL` as an optional env field, existing tests unaffected | Forgetting to update the two `astro:env/server` Vitest mocks breaks existing tests with an undefined fetch URL |
| 2. E2E test                         | One Playwright spec protecting Risk #8, running on all 3 browsers    | Stub must echo the _real_ product UUID or the model-response guardrail rejects it and the dialog never opens   |

**Prerequisites:** Playwright infra already in place (`playwright.config.ts`,
`tests/auth.setup.ts`); local Supabase running with the seeded `test@example.com` user;
`npm run dev` running locally with `.env` pointed at the stub port for Phase 2's manual/
automated runs.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes `npm run dev` (plain Node/Vite dev server) is how this suite is run locally, not
  `wrangler dev`/Cloudflare local preview — if that assumption is wrong, the env var needs
  to come from `.dev.vars` instead of `.env` at setup time.
- Assumes Radix's `AlertDialog` renders with a locatable role/text the test can wait on
  (`role="alertdialog"` or the recipe title) — not independently re-verified beyond the
  research agent's read of the component.

## Success Criteria (Summary)

- A real browser session can generate, approve, and see the product gone from inventory
  and the recipe present in history — without hitting the live model.
- The new test fails if the risk it protects against actually occurs (verified via
  `/10x-e2e`'s deliberate-break check during execution).
- Existing unit/integration suite is unaffected by the Phase 1 config change.
