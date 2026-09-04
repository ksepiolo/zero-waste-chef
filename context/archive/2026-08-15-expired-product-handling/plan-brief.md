# Expired-product handling and the generation error contract — Plan Brief

> Full plan: `context/changes/expired-product-handling/plan.md`
> Research: `context/changes/testing-recipe-generation-core/research.md` (oracle D1–D5, Risk #6 failure inventory)

## What & Why

Two live defects ship a fix together because they meet in the same catch block.
**Risk #2**: a product that expired a year ago is marked at-risk, sorted to the
front of the prompt, and then _required_ by the at-risk floor guard — the app does
not merely tolerate expired food, it insists on it. **Risk #6 (remaining half)**:
all ten generation failure classes collapse onto one flat HTTP 500, and three of
them render raw internal text — a 700-byte `ZodError` dump, the model's own
refusal prose, PostgREST diagnostics — as the user's toast.

## Starting Point

`isAtRisk()` (`product.service.ts:6-11`) compares only against the upper bound, so
every past date satisfies it; there is no `expired` state anywhere in the codebase.
`generate.ts:64-67` is a single catch-all returning `err.message` verbatim, because
the service signals failure class by throwing a bare `Error` and the boundary
discards it. Rollout Phase 1 already pinned the halves that work — a failure never
resolves as success, never hangs, and never leaks the provider key or the upstream
body — and deliberately asserted `!response.ok` rather than `500` so this change
can differentiate statuses without rewriting those tests.

## Desired End State

A past-dated product is classified expired, never reaches the model, and is
reported back by id and name; an all-expired inventory gets its own 422 instead of
the untrue "Inventory is empty"; rate limit, timeout, provider fault, unusable
model response and datastore failure each return a distinct status with copy we
wrote; the inventory list shows an "Expired" badge and a generation that skipped
stock says which.

## Key Decisions Made

| Decision            | Choice                                                   | Why (1 sentence)                                                                                                                    | Source        |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Expiry model        | Three states: expired / at-risk / safe                   | The PRD's "expiring within 3 days" excludes past dates; the product owner settled what past-dated stock should do                   | Research (D1) |
| Prompt exclusion    | Expired products never reach the payload                 | Dissolves the floor-guard harm by construction rather than weakening the guard                                                      | Research (D2) |
| Type representation | Two flags from one classifier, not a discriminated union | Smallest blast radius; a single derivation point is what makes the illegal both-true state unreachable                              | Plan          |
| Filter location     | Endpoint-side, before the service call                   | Keeps `generateRecipe`'s resolved shape intact so Phase 1's success assertion survives; the endpoint already needs the excluded set | Plan          |
| Exclusion report    | `excluded_expired: [{ id, name }]`                       | A count is not actionable — the user cannot tell which products were skipped                                                        | Plan          |
| All-expired branch  | Distinct 422                                             | Machine-distinguishable from the genuinely-empty 400 without matching on copy                                                       | Plan          |
| Status granularity  | HTTP semantics per class (429/504/503/502/500)           | Retryability becomes readable from the status by clients, proxies and monitoring                                                    | Plan          |
| Message hygiene     | Typed service error carrying status + copy               | Safe by construction: an unconverted throw site degrades to a generic message instead of leaking                                    | Plan          |
| Guardrail copy      | One shared retryable message                             | Three internal causes lead a user to the same action; they stay distinct in the log and the status                                  | Plan          |
| UI scope            | Badge and toast                                          | Without the badge an expired product loses its (wrong) "At risk" label and gains nothing                                            | Plan          |

## Scope

**In scope:** two-sided `isAtRisk()` plus `is_expired`; exclusion from the prompt;
the `excluded_expired` response contract; the all-expired 422; a typed service
error with a class→status map; wrapping the three leaking throw sites; guardrail
copy; the "Expired" badge and the exclusion toast; test-plan §3/§6 close-out.

**Out of scope:** database migration (both flags are derived); rejecting
past-dated products at creation (Risk #7, rollout Phase 3); the approve path
(Risk #5, rollout Phase 2); UI tests (§7); automatic retry; testing the timezone
drift — the arithmetic is made drift-free instead.

## Architecture / Approach

`listProducts` derives both flags at one point and feeds three call sites
(`inventory.astro`, `GET /api/products`, `generate.ts`). `generate.ts` partitions
on `is_expired`, hands `generateRecipe` only usable stock, and reports the rest —
so the service keeps its signature and its guardrails, and expired items are gone
before the at-risk sort ever runs. On the failure side the direction reverses: the
service names the failure _class_ in a typed error carrying status and user-safe
copy, and the endpoint's catch block becomes a lookup, with anything untyped
falling through to a generic 500.

## Phases at a Glance

| Phase                         | What it delivers                                           | Key risk                                                                                                      |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1. Three-state classification | Two-sided `isAtRisk()` + `is_expired`                      | A new required field breaks a Phase 1 fixture — mechanical, but must not be mistaken for regressing its locks |
| 2. Exclusion + report         | Expired stock never reaches the prompt; `excluded_expired` | The response contract changes shape for every existing client                                                 |
| 3. All-expired branch         | Distinct 422 with true copy                                | Branch ordering — the empty check must stay first or the 400 is unreachable                                   |
| 4. Typed error + statuses     | Distinct non-2xx per failure class                         | Every throw site must be converted; a missed one degrades silently (safely) to generic                        |
| 5. Message hygiene + copy     | No raw internal text reaches a toast                       | Hygiene assertions can pass vacuously unless the raw text is proven produced first                            |
| 6. UI + close-out             | "Expired" badge, exclusion toast, §3/§6 sync               | Ships on manual verification only, per §7                                                                     |

**Prerequisites:** the Vitest runner, provider stub pattern and endpoint-context
helper from `testing-recipe-generation-core` — all landed; cookbook §6.1–§6.3 describes them.
**Estimated effort:** ~2–3 sessions across six phases; phases 1–3 and 4–5 are two
independent red-test sequences and must not be run as one.

## Open Risks & Assumptions

- Phases 1–3 and 4–5 both touch `generate.ts`; running them as one sequence is the
  failure mode `change.md` warns about, and the phase split is the mitigation.
- 502 for "our own guardrail rejected the model" is a defensible but arguable
  reading of Bad Gateway; it groups with malformed responses because the user's
  action is the same.
- `AbortSignal.timeout()` under `workerd` is verified on Node only (research Open
  Question #1); if it differs, the 504 path degrades to the generic 500 in
  production only.
- The exclusion toast and badge are unverified by tests by design, so a rendering
  regression there would ship uncaught (§7's accepted consequence).

## Success Criteria (Summary)

- A user with expired stock gets a recipe that does not use it, and is told what
  was skipped — instead of getting no recipe at all.
- An all-expired inventory produces an accurate message rather than "Inventory is empty".
- No generation failure ever shows the user text that we did not write.
