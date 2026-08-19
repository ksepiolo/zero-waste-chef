# Data Isolation and Input Trust — Plan Brief

> Full plan: `context/changes/testing-data-isolation-input-trust/plan.md`

## What & Why

Rollout Phase 3 of `context/foundation/test-plan.md`: prove a second authenticated user
cannot reach the first user's products/recipes by constructing an id (Risk #4), and that
crafted generation parameters are rejected before reaching the model prompt (Risk #7).
Both risks trace to real evidence — Risk #4 to a documented near-miss in
`context/foundation/lessons.md`, Risk #7 to the closed-list contract Roadmap S-04
introduced.

## Starting Point

The codebase is already compliant on both risks — this is a coverage gap, not a live
defect. `listProducts`, `deleteProduct`, and `listRecipes` all already chain an explicit
`.eq("user_id", userId)` alongside RLS. `generate.ts`'s closed-list validation already
rejects an out-of-enum `technique`. What's missing: no test proves the isolation holds
against a real second user and a real database, and only one of three closed lists
(`technique`) has an endpoint-level rejection test — `method` and `time` are unverified.

## Desired End State

A real second seeded user, tested against the real local Postgres instance, cannot see
or delete the first user's rows through any reachable endpoint. All three closed
generation parameters — not just one — are proven to reject an out-of-list value before
the provider is ever called. One known, currently-unreachable gap (the `time` param's
direct prompt interpolation) is recorded in the project's own test-plan record rather
than silently left for a future reader to rediscover.

## Key Decisions Made

| Decision                               | Choice                                                        | Why (1 sentence)                                                                                                                                                                  | Source |
| -------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Risk #4 test layer                     | Route-layer, both directions (GET collections + DELETE by id) | No single-resource GET route exists to attack directly; testing the actual exported handlers with a real signed-in client is the most faithful proxy for the real attack surface. | Plan   |
| `excludeTitles` boundary tests         | Out of scope                                                  | It's free text by design, not a closed list — outside Risk #7's literal framing.                                                                                                  | Plan   |
| `time` field direct-interpolation gap  | Document only, no code change                                 | The path is unreachable today (zod is the only entry point); adding production code here contradicts test-plan.md's "reuse, don't build" principle for a test-rollout phase.      | Plan   |
| `approveRecipe` (structural exception) | Leave untouched                                               | Already has a passing cross-user test from Phase 2; re-touching it is redundant scope creep.                                                                                      | Plan   |
| Cross-user fixtures                    | Per-test insert/cleanup                                       | Matches the pattern Phase 2 already established and proved out; no seed.sql changes needed.                                                                                       | Plan   |

## Scope

**In scope:**

- Route-level integration tests: cross-user product listing, cross-user product
  deletion, cross-user recipe listing (Risk #4)
- Extending the existing out-of-list unit test into an `it.each` covering all three
  closed generation parameters (Risk #7)
- A test-plan.md phase note and rollout status update
- A scoped mutation-testing pass over the newly-covered service functions

**Out of scope:**

- Any new API route (no `recipes/[id].ts`, no product `GET`/`PATCH` by id)
- `excludeTitles` boundary testing
- Any change to `approveRecipe` or the `time`-field interpolation code
- CI wiring (test-plan.md Phase 4's job)

## Architecture / Approach

Two independent risks, closed independently. Risk #4 needs a new technique: mocking
`@/lib/supabase`'s `createClient` to return a **real, already-signed-in**
`@supabase/supabase-js` client (via a `vi.hoisted` mutable holder swapped between the two
seeded users), rather than the usual query-stub — this lets a test call the actual
exported route handler with real RLS enforcement, since every route builds its own
Supabase client from cookies rather than reading one off `locals`. Risk #7 needs no new
infrastructure at all — it's a one-line extension of an existing mocked unit test.

## Phases at a Glance

| Phase                                          | What it delivers                                                                            | Key risk                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Data Isolation — route-layer tests          | 3 new integration test files proving cross-user isolation on real Postgres                  | Getting the mock-real-client pattern wrong could silently test nothing (false green)                                                     |
| 2. Input Trust — closed-list boundary coverage | `it.each` extension proving `method`/`time` reject out-of-list values, not just `technique` | Low — mechanical extension of an already-proven pattern                                                                                  |
| 3. Close-out                                   | Mutation-testing pass, test-plan.md note and status update                                  | Mutants surviving on the `.eq("user_id", ...)` filters would mean the new tests aren't actually catching the defect class they exist for |

**Prerequisites:** Local Supabase running (`npx supabase start && npx supabase db reset`) for Phase 1's integration tests; both seeded users already exist from Phase 2.
**Estimated effort:** ~1 session across 3 phases — small, well-scoped gap-closing work.

## Open Risks & Assumptions

- The mock-real-client-behind-`createClient` pattern is new to this codebase (Phase 2's
  cross-user test bypassed the route layer entirely and called the RPC directly). If it
  proves awkward in practice, falling back to service-layer-direct testing (calling
  `listProducts`/`deleteProduct`/`listRecipes` directly, like Phase 2 did with the RPC)
  is the documented alternative from the planning discussion.
- The `time` field's direct-interpolation gap remains latent. If a future refactor ever
  constructs `RecipeParams` outside the zod-validated path, this becomes exploitable —
  worth re-flagging if `recipe-prompt.ts`'s call sites change.

## Success Criteria (Summary)

- A second seeded user cannot see or delete a first user's product/recipe rows through
  any reachable endpoint, proven against the real database.
- All three closed generation parameters reject an out-of-list value before the provider
  is called.
- `npm run test` passes identically whether or not the local Supabase stack is running.
