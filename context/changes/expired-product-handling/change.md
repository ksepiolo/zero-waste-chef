---
change_id: expired-product-handling
title: Exclude expired products from recipe generation and tell the user
status: new
created: 2026-08-15
updated: 2026-08-15
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
- **D2** — expired products are filtered out *before* the at-risk sort and the
  `MAX_PROMPT_PRODUCTS` slice in `recipe.service.ts`. They never reach the prompt and
  never enter the at-risk floor set.
- **D3** — the user is informed on two surfaces: an `is_expired` flag driving an
  "Expired" badge mirroring `inventory-panel.tsx:212` (flag tested, badge not — §7),
  and the generate response reporting which products it excluded.
- **D4** — an inventory where *every* product is expired needs its own branch and
  message, distinct from the genuinely-empty case at `generate.ts:55`.

**Confirmed defect this fixes** (verified empirically, see research.md probe table):
`isAtRisk()` at `src/lib/services/product.service.ts:6-11` is one-sided, so a product
that expired a year ago is marked at-risk, sorted to the front of the prompt, and the
floor guard at `recipe.service.ts:165-170` then *rejects any recipe that avoids it*.

**Execution mode**: `/10x-tdd`. The first red test is nameable in one sentence — "a
past-dated product is excluded from the prompt and reported back to the caller."

**Depends on** `testing-recipe-generation-core` landing the Vitest runner first —
there is no test infrastructure in this project today.
