# Explain Why the Edit Dialog Refuses to Save — Implementation Plan

## Overview

The "Edit product" dialog refuses invalid input **silently**: the Save button greys out and
no message is rendered anywhere. The user's typing registers, the form looks normal, and
nothing says what is wrong or how to fix it.

This plan keeps every validation rule exactly as it is — on both the create and the edit
path — and makes the refusal legible. The predicate that decides validity is extracted into
a pure, node-testable module so the rule can be asserted directly, and the dialog renders an
inline message under whichever field is at fault.

## Current State Analysis

`EditProductDialog` (`src/components/inventory/inventory-panel.tsx:490-668`) computes
validity inline and gates Save on it:

- `:518` — `const isValid = name.length > 0 && name.length <= 255 && expiryDate >= today;`
- `:626` — `disabled={!isDirty || !isValid || isSubmitting}`

`today` is threaded in as a prop (`:461`, declared `:485`) from a single computation at
`:91`. The dialog prefills from the product being edited (`:511-512`), so for a product whose
`expiry_date` has passed, `isValid` is `false` **before the user types anything**.

The `error` state (`:493`) is written only inside `handleSubmit` (`:531-560`), from a fetch
response. Because Save is disabled, `handleSubmit` never runs, so `error` stays `null` and the
render at `:610` — `{error && <p className="text-brand-danger text-sm">{error}</p>}` — emits
nothing. **The server's message is unreachable by construction.** `PATCH` would answer
`400 "Expiry date must be today or in the future"` (`src/pages/api/products/[id].ts:33-36`),
but the client blocks the request before the server can speak.

The same silence covers an empty name: `required` on the input never fires, because native
constraint validation runs on submit and submit is unreachable.

### Key Discoveries:

- **The rule itself is deliberate and stays.** `context/archive/2026-08-30-product-edit/`
  specifies it for the edit path in `change.md:12`, `research.md:110`, and signs it off in
  `plan.md:124`, `:184`, `:262`. This plan does not touch it.
- **Client and schema duplicate the rule independently.** `product.schema.ts:5-8` and
  `inventory-panel.tsx:518` express "today or later" separately; the client never imports the
  schema. Extraction gives the client rule one home without altering the schema.
- **The add form is the asymmetric one, and is out of scope.** Its submit is
  `disabled={isSubmitting}` only (`:204`) — it has no `isValid` and relies on native `min=`
  plus a server 400. Edit is the stricter path. Nothing here changes the add form.
- **Error copy pattern**: `<p className="text-brand-danger …text-sm">` at `:610` (dialog),
  `:207` and `:215` (panel). Reuse it.
- **No test exercises the rule at any layer** — no `product.schema.test.ts` exists, and no
  unit, integration, or Playwright test asserts a past-date rejection. Phase 1 is therefore
  net-new coverage, not a rewrite.
- **No React component test infrastructure exists** (no `@testing-library`, no jsdom;
  `vitest.config.ts` sets `environment: "node"`), and `context/foundation/test-plan.md`
  §7:431-433 excludes component tests. A pure predicate sidesteps both constraints.

## Desired End State

Opening Edit on a product whose expiry date has passed shows an inline message under the date
field stating the date must be today or in the future. Clearing the name shows a message under
the name field. Save remains disabled while either holds, and enables the moment the input is
corrected. No validation rule has changed: the same inputs are accepted and rejected as before,
on both create and edit — only the explanation is new.

Verified by: the Phase 1 unit test asserting the predicate's boundaries, plus the Phase 2
manual checks below.

## What We're NOT Doing

- **Not changing any validation rule.** `expiry_date >= today` stays on both create and edit.
  Editing a product with a past date still requires moving the date forward.
- **Not splitting `productSchema`.** `src/lib/services/product.schema.ts`,
  `src/pages/api/products/index.ts`, `src/pages/api/products/[id].ts` and
  `src/lib/services/product.service.ts` are untouched.
- **Not touching the add-product form** or its native-validation behavior.
- **Not unifying the duplicated "today" computation** (defect D5,
  `context/domain/03-anti-corruption-layer.md:257-271`) — explicitly declined for this change.
- **Not fixing the stale `today` at `:91`**, which is computed once per render and does not
  refresh across UTC midnight. Pre-existing; out of scope.
- **Not correcting stale docs** (`prd.md:128` and `test-plan.md` Risk #5 still assert "No
  product editing"; the roadmap's Parked entry was never closed). Separate change.
- **No database migration, no RLS change, no API contract change.**

## Implementation Approach

Two phases, strictly ordered. Phase 1 is a pure extraction with its own tests and no
user-visible change, so it can land and be verified in isolation. Phase 2 consumes it and is
the only phase that alters what a user sees.

The predicate returns **field-keyed messages** rather than a boolean, because the dialog needs
to know not just _that_ input is invalid but _which field_ and _what to say_ — that mapping is
the whole point of the change. Validity for the Save gate is then derived from the absence of
messages.

## Critical Implementation Details

**State-reset timing.** The dialog resets its fields during render, not in an effect
(`:506-515`), keyed on the `null`→non-null "opening" transition — a deliberate pattern
documented in the comment there and in `context/archive/2026-08-30-product-edit/reviews/impl-review.md:37`.
The predicate must be called during render from the current `name`/`expiryDate` state so
messages track edits immediately. Do not introduce an effect or a second state variable to
hold the messages — that would reintroduce the staleness the render-time reset exists to avoid.

**Message wording must match the server's exactly.** The client string for the date case is
`"Expiry date must be today or in the future"`, byte-for-byte the message in
`product.schema.ts:8`. The two rules are enforced in separate places; identical copy is what
keeps them from silently describing the same rule differently.

---

## Phase 1: Extract the draft-validity predicate

### Overview

Move the validity rule out of the JSX into a pure function with a unit test. No behavior
change; nothing renders differently. The dialog still uses its inline `isValid` at the end of
this phase — Phase 2 does the swap.

### Changes Required:

#### 1. New validation module

**File**: `src/lib/services/product.validation.ts`

**Intent**: Own the client-side draft rule in one testable place, expressed as field-keyed
messages so a caller can explain a refusal rather than only detect one. Mirrors — but does not
import or alter — `product.schema.ts`.

**Contract**: Exports a function taking the draft (`name`, `expiry_date`) and `today` as an
explicit `YYYY-MM-DD` argument, returning an object with optional `name` and `expiry_date`
message strings; an empty object means valid. `today` is a required parameter, not read from
the clock inside — that is what makes the boundary test deterministic without faking timers.
The `expiry_date` message is exactly `"Expiry date must be today or in the future"`. Name rules
stay as they are today: non-empty, at most 255 characters.

#### 2. Unit test for the predicate

**File**: `src/lib/services/product.validation.test.ts`

**Intent**: Pin the boundaries the rule turns on — the case that shipped unverified.

**Contract**: Table-driven over expiry offsets **-1, 0, +1** against a fixed `today`, matching
the boundary convention already used in `product.service.test.ts:41-45` and prescribed by
`test-plan.md:69`. Name cases: empty, 1 char, 255 chars, 256 chars. Asserts the exact message
strings, not just presence, so wording drift from the server is caught.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- The new test file is included in the run (matches `src/**/*.test.ts`) and covers offsets -1, 0, +1
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- The existing 121 tests still pass with no new failures

---

## Phase 2: Surface the reason in the edit dialog

### Overview

Wire `EditProductDialog` to the predicate and render its messages inline. This is the
user-visible half.

### Changes Required:

#### 1. Edit dialog validity + inline messages

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Replace the inline `isValid` expression with a call to the extracted predicate, and
render each returned message beneath its field so a disabled Save is always accompanied by the
reason. Save stays disabled while any message is present — the gate's behavior is unchanged.

**Contract**: `:518` computes messages from the predicate using the existing `today` prop, with
validity derived from that result; `:626`'s `disabled` expression keeps its `!isDirty` and
`isSubmitting` terms and sources validity from the predicate. New `<p>` elements under the name
input (`:588-596`) and the date input (`:598-607`) use the established
`text-brand-danger …text-sm` copy pattern from `:610`.

Each message is associated with its input via `aria-describedby`, and the input carries
`aria-invalid` while the message shows — the greyed-out button conveys nothing to a screen
reader, so the text must be programmatically linked, not merely adjacent. The existing
server-error `<p>` at `:610` stays as-is; it serves a different case.

**Contract note**: `min={today}` on the date input (`:600`) stays. It is the add form's
mechanism too, and removing it would change which dates the picker offers.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes, including `jsx-a11y` rules on the new markup: `npm run lint`
- E2E suite still passes: `npm run test:e2e`

#### Manual Verification:

- Opening Edit on an expired product shows the date message immediately, before any typing, with Save disabled
- Changing the date to today or later clears the message, enables Save, and the edit saves successfully
- Clearing the name shows the name message with Save disabled; restoring it clears both
- Reverting every field back to the product's original values disables Save via `!isDirty` with no message shown
- The message is reachable by keyboard and screen reader (announced via `aria-describedby`, not hover-only)
- The add-product form is visually and behaviorally unchanged
- The discard-confirmation flow on close still behaves as before

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before considering the change done.

---

## Testing Strategy

### Unit Tests:

- Expiry boundaries at offsets -1, 0, +1 against a fixed `today`
- Name at lengths 0, 1, 255, 256
- Exact message strings asserted, so client copy cannot drift from `product.schema.ts:8`
- Both fields invalid at once returns both messages

### Integration Tests:

None added. No API contract, schema, service, or database behavior changes in this plan; the
existing `[id].integration.test.ts` cross-user isolation coverage remains valid untouched.

### Manual Testing Steps:

1. Seed or pick a product whose `expiry_date` is before today (the "Expired" badge marks one).
2. Click the pencil icon. Confirm the date message renders immediately and Save is disabled.
3. Rename the product without touching the date. Confirm Save stays disabled and the message persists.
4. Set the date to today. Confirm the message clears, Save enables, and saving succeeds.
5. Reopen the same product, clear the name, and confirm the name message appears.
6. Tab through the dialog with a screen reader active and confirm each message is announced with its field.
7. Add a new product via the top form to confirm that path is unchanged.

## Performance Considerations

None. The predicate is two string comparisons and a length check, called during render on a
dialog that renders one product at a time.

## Migration Notes

None. No schema, data, or API changes.

## References

- Change identity: `context/changes/edit-expired-product/change.md`
- Prior decision this plan deliberately preserves: `context/archive/2026-08-30-product-edit/plan.md:124,184,262`
- Boundary-table convention: `src/lib/services/product.service.test.ts:41-45`; `context/foundation/test-plan.md:69`
- Component-test exclusion this plan works within: `context/foundation/test-plan.md:431-433`
- Error copy pattern: `src/components/inventory/inventory-panel.tsx:610`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract the draft-validity predicate

#### Automated

- [x] 1.1 Unit tests pass: `npm run test` — 7197bf3
- [x] 1.2 New test file runs and covers offsets -1, 0, +1 — 7197bf3
- [x] 1.3 Type checking passes: `npm run typecheck` — 7197bf3
- [x] 1.4 Linting passes: `npm run lint` — 7197bf3
- [x] 1.5 Existing 121 tests still pass with no new failures — 7197bf3

### Phase 2: Surface the reason in the edit dialog

#### Automated

- [x] 2.1 Full test suite passes: `npm run test` — 4486e3b
- [x] 2.2 Type checking passes: `npm run typecheck` — 4486e3b
- [x] 2.3 Linting passes, including `jsx-a11y` rules on the new markup: `npm run lint` — 4486e3b
- [x] 2.4 E2E suite still passes: `npm run test:e2e` — 4486e3b

#### Manual

- [x] 2.5 Expired product shows the date message immediately, Save disabled — 4486e3b
- [x] 2.6 Correcting the date clears the message, enables Save, and the edit saves — 4486e3b
- [x] 2.7 Clearing the name shows the name message; restoring it clears both — 4486e3b
- [x] 2.8 Reverting all fields disables Save via `!isDirty` with no message shown — 4486e3b
- [x] 2.9 Messages are keyboard- and screen-reader reachable via `aria-describedby` — 4486e3b
- [x] 2.10 Add-product form is visually and behaviorally unchanged — 4486e3b
- [x] 2.11 Discard-confirmation flow on close behaves as before — 4486e3b
