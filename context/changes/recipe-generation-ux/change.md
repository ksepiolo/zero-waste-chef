---
change_id: recipe-generation-ux
title: Recipe generation UX improvements
status: plan_reviewed
created: 2026-08-12
updated: 2026-08-12
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
