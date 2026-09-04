# Explain Why the Edit Dialog Refuses to Save — Plan Brief

> Full plan: `context/changes/edit-expired-product/plan.md`

## What & Why

The "Edit product" dialog refuses invalid input silently. Save greys out, no message is
rendered, and the user is left with a form that looks normal and does nothing. This change
keeps every validation rule exactly as it is and makes the refusal legible.

The trigger was "I can't update a product." The cause is a create-path rule
(`expiry_date >= today`) that also governs edit, so a product whose date has passed cannot be
renamed without re-dating it. **That rule stays** — it was a deliberate, signed-off decision.
What is being fixed is that nothing tells the user any of this.

## Starting Point

`EditProductDialog` computes validity inline at `inventory-panel.tsx:518` and gates Save on it
at `:626`. The dialog prefills from the product being edited, so for an expired product
validity is `false` before the user types. The `error` state is written only from a fetch
response inside `handleSubmit` — and because Save is disabled, `handleSubmit` never runs. The
server's message, `"Expiry date must be today or in the future"`, is unreachable by
construction. The same silence covers an empty name.

## Desired End State

Opening Edit on an expired product shows an inline message under the date field explaining the
requirement, with Save disabled until the date is corrected. Clearing the name behaves the same
way under the name field. The same inputs are accepted and rejected as before, on both create
and edit — only the explanation is new.

## Key Decisions Made

| Decision               | Choice                                 | Why                                                                                                          | Source       |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| Edit-path rule         | Unchanged — same as create             | Explicitly specified and signed off for edit in the archived `product-edit` change; not an oversight to undo | Plan (user)  |
| Create-path rule       | Untouched                              | Invariant N-16 is scoped to a product _being added_; nothing about adding stock is a correction              | Plan (user)  |
| Nature of the fix      | Feedback, not permissiveness           | The silent refusal is a defect under any rule; the rule itself is defensible                                 | Plan (user)  |
| Client rule coverage   | Extract a pure predicate, unit-test it | No component-test infra exists and `test-plan.md` §7 excludes such tests; a pure function sidesteps both     | Plan (user)  |
| Message placement      | Inline, under the offending field      | The complaint is "I didn't know why" — the answer must be visible without clicking a dead button             | Plan (user)  |
| Adjacent issues        | None folded in                         | Keep the review surface tight                                                                                | Plan (user)  |
| Name-field coverage    | Included                               | Empty name is the identical defect one field over; the predicate already covers it                           | Plan (model) |
| Client message wording | Byte-identical to the server's         | Two enforcement points describing one rule must not drift apart                                              | Plan (model) |

## Scope

**In scope:**

- New pure validation module in `src/lib/services/` returning field-keyed messages
- Its unit test, table-driven over expiry offsets -1, 0, +1 and name lengths 0, 1, 255, 256
- `EditProductDialog`: consume the predicate, render inline messages, wire `aria-describedby` / `aria-invalid`

**Out of scope:**

- Any change to validation rules, `productSchema`, the API routes, `product.service.ts`, or the database
- The add-product form and its native-validation behavior
- Defect D5 (duplicated "today" computation) and the stale `today` at `:91`
- Correcting stale docs (`prd.md:128`, Risk #5, the roadmap's Parked entry) — separate change

## Architecture / Approach

One new pure module owns the client-side rule; the dialog imports it and renders what it
returns. `today` is passed in as an argument rather than read from the clock inside, which is
what makes the boundary test deterministic without faking timers. The predicate returns
field-keyed messages rather than a boolean, because the dialog needs to know _which_ field and
_what to say_ — validity for the Save gate is derived from the absence of messages.

## Phases at a Glance

| Phase                    | What it delivers                           | Key risk                                                   |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------- |
| 1. Extract the predicate | Pure module + unit test; no visible change | Low — nothing consumes it yet                              |
| 2. Surface the reason    | Inline messages in the edit dialog         | Breaking the render-time state reset the dialog depends on |

**Prerequisites:** None. Baseline is green — 121 tests passing, `typecheck` 0 errors, `lint` clean.
**Estimated effort:** ~1 session; roughly a 60-line diff across 3 files, 2 of them new.

## Open Risks & Assumptions

- The dialog resets state **during render**, not in an effect (`:506-515`) — a deliberate
  documented pattern. Introducing an effect or a second state variable for the messages would
  reintroduce the staleness that pattern exists to avoid. This is the one real way Phase 2 can
  go wrong.
- Users who wanted to rename an expired product without re-dating it are still blocked. That
  follows directly from keeping the rule, and is a decision, not an oversight.
- `test-plan.md` §7's negative space (no component tests) is respected rather than amended, so
  the rendering of the messages is covered by manual verification only.

## Success Criteria (Summary)

- A disabled Save is never unexplained — every refusal names the field and the requirement
- Correcting the input clears the message and enables Save immediately
- No input that was previously accepted is now rejected, or vice versa, on either path
