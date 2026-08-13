---
change_id: recipe-generation-ux
title: Recipe generation UX improvements
status: implementing
created: 2026-08-12
updated: 2026-08-13
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Roadmap slice **S-04**. Runs parallel with S-03 (`recipe-history`), which is `plan_reviewed`
and touches two of the same files (`src/lib/services/recipe.service.ts`,
`src/pages/inventory.astro`) with disjoint additions — see plan.md § Parallel Work Collision.

Plan review triaged 2026-08-12: all 8 findings fixed, verdict REVISE → SOUND. Structural
changes worth knowing before implementing:

- Phase 1 is now **two ordered steps** — step A neutralises the few-shot demonstration
  (quality gate 1.12), step B widens the product list. Do not collapse them.
- Phase 2 creates a **new file**, `src/lib/services/recipe-prompt.ts`, which must stay free of
  `astro:env` imports so the byte-identity check (2.4) is runnable outside an Astro build.
- Enums shrank: `method` dropped `stovetop-only`, `time` dropped `90` (8 × 5 × 4).
- Two new required guardrails in Phase 1: at-risk inclusion assertion, and a reworded
  `RESPONSE_FORMAT` description.

### Deviations

- **Phase 2 — the Variety rule is now templated too** (approved 2026-08-13). The plan said
  every rule other than Techniques/Method/Time keeps its current wording. But Variety tells
  the model to "change the cooking method, the dish format (…)" on a regenerate, which
  contradicts a pinned technique or method — the exact failure §Critical Implementation
  Details warns about. `varietyLine()` now strikes a pinned dimension from that list, and
  falls back to flavour + main ingredients when both are pinned. All-`"any"` renders the
  original sentence verbatim, so criterion 2.4 still passes byte-identically.
