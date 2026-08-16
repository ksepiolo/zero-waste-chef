---
change_id: expired-product-handling
title: Exclude expired products from recipe generation and tell the user
status: impl_reviewed
created: 2026-08-15
updated: 2026-08-16
archived_at: null
---

## Notes

Split out of `testing-recipe-generation-core` (test-plan §3 Phase 1) on 2026-08-15,
so that phase stays a test-rollout phase and this one carries the product change.

**Covers test-plan §2 Risk #2** — "the user is told to cook with a product that is
already past its expiry date."

The oracle is already researched and resolved — **do not re-derive it**. See
`context/changes/testing-recipe-generation-core/research.md`, section
**"Resolved Oracle — expired products (user decision, 2026-08-15)"**, decisions
D1–D4. In short:

- **D1** — three mutually exclusive states replace the `is_at_risk` boolean:
  `expired` (`expiry_date < today`), `at-risk` (`today <= expiry_date <= today + 3`),
  `safe`. The existing upper bound is correct and must not move.
- **D2** — expired products are filtered out _before_ the at-risk sort and the
  `MAX_PROMPT_PRODUCTS` slice in `recipe.service.ts`. They never reach the prompt and
  never enter the at-risk floor set.
- **D3** — the user is informed on two surfaces: an `is_expired` flag driving an
  "Expired" badge mirroring `inventory-panel.tsx:212` (flag tested, badge not — §7),
  and the generate response reporting which products it excluded.
- **D4** — an inventory where _every_ product is expired needs its own branch and
  message, distinct from the genuinely-empty case at `generate.ts:55`.

**Confirmed defect this fixes** (verified empirically, see research.md probe table):
`isAtRisk()` at `src/lib/services/product.service.ts:6-11` is one-sided, so a product
that expired a year ago is marked at-risk, sorted to the front of the prompt, and the
floor guard at `recipe.service.ts:165-170` then _rejects any recipe that avoids it_.

**Execution mode**: `/10x-tdd`. The first red test is nameable in one sentence — "a
past-dated product is excluded from the prompt and reported back to the caller."

**Depends on** `testing-recipe-generation-core` landing the Vitest runner first —
there is no test infrastructure in this project today. That dependency is now
satisfied: the runner, the provider stub pattern and the endpoint-context helper all
exist, and the cookbook in `context/foundation/test-plan.md` §6.1–§6.3 describes them.

## Also covers test-plan §2 Risk #6 — the generation-failure error contract

Handed over from `testing-recipe-generation-core` on 2026-08-15. That change pinned
the half of Risk #6 the code already satisfies — a failure never resolves as success,
never hangs, and never leaks `OPENROUTER_API_KEY` or the raw upstream body. The half
below is a live defect rather than a coverage gap: closing it changes behaviour, so it
belongs to a product change, not a test-rollout phase.

**The failure inventory is already researched — do not re-derive it.** See
`context/changes/testing-recipe-generation-core/research.md` §"Risk #6 — the
error-translation path" (line 198), which enumerates all ten failure classes and where
each is raised.

| Deferred item                      | Where it lives today                                | Why it could not be tested in Phase 1                                                                                      |
| ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Distinct non-2xx per failure class | `src/pages/api/recipes/generate.ts:64-67` catch-all | Every class collapses onto one flat HTTP 500. Requires a typed service error; the test would be red until the code changes |
| `ZodError` dump reaching the toast | `src/lib/services/recipe.service.ts:154`            | ~700-byte JSON including the internal UUID regex is rendered verbatim to the user                                          |
| `SyntaxError` echoing model prose  | `src/lib/services/recipe.service.ts:154`            | `JSON.parse`'s message quotes the model's own refusal text back at the user                                                |
| Raw PostgREST diagnostics          | `src/lib/services/product.service.ts:20`            | A second upstream leaking where OpenRouter's was suppressed                                                                |
| Guardrail jargon as user copy      | `src/lib/services/recipe.service.ts:159,168`        | "inventory guardrail violated" is correct detection, wrong presentation                                                    |

**Sequencing consequence — read before starting `/10x-tdd`.** This change now touches
`generate.ts`'s catch block for two independent reasons: D4's all-expired branch, and
the status/message discipline above. It is therefore **not** one nameable red test and
must not be run as a single sequence. Do D1–D4 first (the first red test being "a
past-dated product is excluded from the prompt and reported back to the caller"), then
the error contract as its own sequence.

**What Phase 1's tests already lock, so this change must not regress it:** no failure
path may return 2xx, carry a `recipe` key, or contain the provider key or upstream body
(`src/lib/services/recipe.service.test.ts`, `src/pages/api/recipes/generate.test.ts`).
Those tests deliberately assert `!response.ok` rather than `500`, and assert rejection
rather than message text, precisely so this change can differentiate statuses and
rewrite the messages without rewriting them.
