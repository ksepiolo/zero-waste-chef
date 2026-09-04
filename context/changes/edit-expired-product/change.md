---
change_id: edit-expired-product
title: Explain why the edit dialog refuses to save
status: implemented
created: 2026-09-04
updated: 2026-09-04
archived_at: null
---

## Notes

> **Change-id note**: the slug `edit-expired-product` predates the scoping decision below and
> now misdescribes the work — this change does **not** enable editing expired products. The id
> is kept because `/10x-implement edit-expired-product` and the plan's Progress section
> reference it, and nothing else in the repo does (no roadmap row). Read the title, not the id.

**The reported symptom**: "I can't update a product." Opening Edit on a product whose
`expiry_date` has passed leaves Save permanently greyed out — the user can retype the name and
nothing happens, with no message anywhere explaining why.

**The cause**: `productSchema` (`src/lib/services/product.schema.ts:9`) requires
`expiry_date >= today`. The client mirrors that rule inline at `inventory-panel.tsx:518` and
gates Save on it at `:626`. The dialog prefills from the product being edited, so for an
expired product validity is false before the user types. Because Save is disabled,
`handleSubmit` never runs, `error` is never set, and the render at `:610` emits nothing — the
server's message `"Expiry date must be today or in the future"` is unreachable by construction.
The same silence covers an empty name.

**Scoping decision (2026-09-04)**: the rule **stays, unchanged, on both create and edit**. It
was not an oversight — `context/archive/2026-08-30-product-edit/` specifies it for the edit path
(`change.md:12`, `research.md:110`) and signs it off (`plan.md:124`, `:184`, `:262`). Invariant
N-16 (`context/domain/02-invariant-aggregate-refactor.md:73`) scopes the "not in the past" rule
to a product _being added_, and adding stock is not a correction.

So this change is about **feedback, not permissiveness**: the silent refusal is a defect under
any rule. Editing an expired product still requires moving its date forward — the user will now
be told so.

**Scope**: extract the client-side validity rule into a pure, node-testable module returning
field-keyed messages; unit-test its boundaries; render each message inline under its field in
the edit dialog, linked via `aria-describedby`. `productSchema`, both API routes,
`product.service.ts`, the add-product form, and the database are all untouched.

**Explicitly deferred**: defect D5, the duplicated "today" computation
(`context/domain/03-anti-corruption-layer.md:257-271`); the stale `today` at
`inventory-panel.tsx:91` that never refreshes across UTC midnight; and the stale register
entries (`prd.md:128` and `test-plan.md` Risk #5 still assert "No product editing"; the
roadmap's Parked entry for product editing was never closed).

**Diagnosis is empirically verified — do not re-derive it.** Both halves were reproduced against
the real schema and the real `isValid` expression: the schema rejects a rename that keeps the
product's own past date, and Save stays disabled for the same edit. Baseline at planning time
was green — 121 tests passing, `typecheck` 0 errors, `lint` clean.

**Testing constraint**: there is no React component-test infrastructure (no `@testing-library`,
no jsdom; `vitest.config.ts` sets `environment: "node"`), and `context/foundation/test-plan.md`
§7:431-433 excludes component tests. The pure-predicate approach works within that exclusion
rather than amending it.
