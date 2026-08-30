# Redesign inventory.astro as pantry/recipe-settings view — Implementation Plan

## Overview

Restyle `inventory.astro` from its current dark "cosmic" glassmorphism theme into the
light "Moja spiżarnia" (My pantry) view specified by the Figma frame `Desktop - 3`
(`fileKey=HijlsMP1h4eCPUbUIjBoPI`, `nodeId=1:240`). This is a visual restyle of
already-shipped functionality (product list, expiry pills, recipe-settings selects,
"Generate" button) plus one genuinely new piece of shared chrome: an authenticated nav
bar (logo, "Moja spiżarnia"/"Historia przepisów" tabs, a working sign-out dropdown) that
doesn't exist anywhere in the app today.

## Current State Analysis

- `src/pages/inventory.astro` renders a one-off gradient `<h1>` + single "Recipe
  history" link inside a `bg-cosmic` (dark gradient) wrapper, then mounts
  `<InventoryPanel client:load />`.
- `src/components/inventory/inventory-panel.tsx` (412 lines) owns all interactive
  behavior — add-product form, product list with "At risk"/"Expired" pills and delete
  (with confirmation `AlertDialog`), and the Technique/Method/Time recipe-settings
  selects + "Generate Recipe" button + recipe-review `AlertDialog` — all still styled
  with `border-white/20 bg-white/10` glassmorphism on `bg-cosmic`.
- No shared authenticated nav exists. `Topbar.astro` (logo + Sign in/Create account
  links) is logged-out-only, used by `Welcome.astro`. `dashboard.astro` has its own
  inline "Welcome, {email}" text and a bare `<form method="POST"
action="/api/auth/signout">` for sign-out.
- Auth gating for `/inventory` is already correct (`src/middleware.ts:4,18-22`) — no
  change needed there.
- `src/styles/global.css` already carries the brand-token system (`--color-brand-green`,
  `-ink`, `-muted`, `-muted-2`, `-surface`, `-border`, `-input-border`) and font
  utilities (`font-display`/`font-body`/`font-logo`) from the two prior Figma-driven
  changes, but no tokens yet for the "Expired"/"At risk" pill colors this frame
  introduces.
- No `Card`/`Input`/`Select`/`Badge`/`DropdownMenu` exist under `src/components/ui/` —
  only `button.tsx`, `alert-dialog.tsx` (Radix, via the `"radix-ui"` package), and
  `sonner.tsx`. Both prior Figma changes deliberately did not add new shadcn
  primitives, staying on raw Tailwind + `brand-*` tokens.

## Desired End State

Logging in and visiting `/inventory` shows the light-themed "Moja spiżarnia" page: a
nav bar (logo, active "Moja spiżarnia" tab underlined in green, "Historia przepisów"
link, and a working email dropdown with sign-out) above a two-column layout — a
bordered "Produkty" card (inline add-row, product rows with restyled pills and a
disabled pencil / working trash icon) beside a filled "Ustawienia przepisu" card
(Technique/Method/Time selects + "Generate" button). All existing behavior (add,
delete, generate, approve) continues to work unchanged; only appearance and the new
nav are new.

**Verification**: `npm run typecheck`, `npm run lint`, and `npm run build` all pass;
manual walkthrough of the page against the Figma frame and the full add/delete/
generate/approve/sign-out flows (detailed per-phase below).

### Key Discoveries:

- The Figma frame's `Technique`/`Method`/`Time preference` select boxes show
  `"example@mail.com"` as their value text (nodes `2:70`, `2:77`, `2:83`) — this is
  leftover placeholder content from a reused Figma component, not literal copy to
  hardcode. The boxes must show the select's actual current value (e.g. `"Any"`).
- The Figma product-row secondary text reads `"Exp. date: 24.11.2025"` (node
  `EL-7696795a`) — a `DD.MM.YYYY` dot-separated format with a literal `"Exp. date: "`
  prefix, replacing the current raw ISO string (`2026-09-15`) display.
- The right-side "avatar" badge (node `10:27`) reuses the same `lucide/chef-hat` glyph
  as the logo, but with an ink-colored stroke (`#2F3231`) instead of the logo's green
  stroke (`#35BA6D`) — this is the literal Figma content, not a copy-paste error to
  "fix."
- `alert-dialog.tsx` already sources Radix from the consolidated `"radix-ui"` npm
  package (`import { AlertDialog as AlertDialogPrimitive } from "radix-ui"`) rather
  than via the shadcn CLI — the same package exports `DropdownMenu`, so the new
  sign-out dropdown can follow this exact sourcing pattern without installing anything
  new or touching `src/components/ui/`.
- `AlertDialog`'s existing styling (`bg-background`, shadcn's light default tokens) is
  already white/light regardless of the page's dark theme — the delete-confirmation and
  recipe-review dialogs need no color changes in this change.

## What We're NOT Doing

- Restyling `recipes.astro` (Figma `Desktop - 4`, recipe history) — it keeps its
  current bare header and dark theme until its own future change.
- Restyling or touching `dashboard.astro` — its inline "Welcome, {email}" text and
  sign-out form stay exactly as they are.
- Adding product edit/update functionality. The Figma pencil icon renders per-design
  but is inert — no `updateProduct` service function or `PATCH` route.
- Installing any new shadcn primitive (no `npx shadcn add [name]`).
- Any i18n/translation system. Polish Figma copy ("Moja spiżarnia", "Produkty",
  "Ustawienia przepisu", "Nowy produkt", "Nazwa produktu", "Data ważności") is
  hardcoded verbatim, following the precedent set by `home-page-ui-update`.
- Dark-mode (`.dark`) variants.
- New automated (unit/E2E) test coverage — manual verification only, matching both
  prior Figma-driven changes' testing policy.

## Implementation Approach

Three phases, each independently manually verifiable: (1) static nav shell + new color
tokens, (2) the one genuinely new interactive piece (sign-out dropdown), (3) the
InventoryPanel restyle itself. This ordering means the page is visually complete and
navigable after Phase 1, fully functional (including sign-out) after Phase 2, and
pixel-matches the Figma frame after Phase 3 — each phase leaves the app in a shippable
state.

## Critical Implementation Details

**Figma placeholder content**: The `Technique`/`Method`/`Time preference` select boxes'
`"example@mail.com"` text and the `Nazwa produktu`/`Data ważności` add-row text are
Figma placeholder/label content, not values to hardcode — render actual state
(selected option, input placeholder attribute) as today, just restyled.

**Sign-out interaction model**: `dashboard.astro`'s plain `<form method="POST"
action="/api/auth/signout">` relies on the browser following the API route's redirect
natively. The nav's sign-out lives inside a Radix `DropdownMenu.Item`, which doesn't
compose cleanly with a native form submission mid-menu — use `onSelect` → `fetch(...,
{ method: "POST" })` → `window.location.href = "/"` on success instead (mirrors the
existing `fetch` + `try/catch` pattern already used for add/delete in
`inventory-panel.tsx`), with a `toast.error(...)` fallback on failure so a failed
sign-out doesn't fail silently.

## Phase 1: Design tokens + AppNav shell

### Overview

Add the two new pill color-token pairs, build the static (non-interactive) nav shell
as a new `AppNav.astro` component, and wire it into `inventory.astro` in place of the
current one-off header. The nav's right-side avatar/email/chevron renders statically
in this phase (Phase 2 makes it a functional dropdown), and `InventoryPanel` itself is
not yet touched (Phase 3).

### Changes Required:

#### 1. Status-pill and page background tokens

**File**: `src/styles/global.css`

**Intent**: Add the "Expired"/"At risk" pill color tokens the Figma frame introduces
(none of the existing `brand-*` tokens or stock Tailwind `red-100`/`amber-100` match),
following the `--color-brand-input-border` precedent of adding one-off tokens for new
Figma hexes rather than hardcoding raw hex values in component markup.

**Contract**: Add to the `brand-*` block inside the existing `@theme inline` rule,
after `--color-brand-input-border`:

```css
--color-brand-danger: #b14039;
--color-brand-danger-bg: #fbebea;
--color-brand-danger-border: #f0d2d0;
--color-brand-warn: #b17939;
--color-brand-warn-bg: #fbf3ea;
--color-brand-warn-border: #f0e1d0;
```

#### 2. New shared nav shell

**File**: `src/components/AppNav.astro` (new)

**Intent**: Static nav markup — logo/wordmark, the two nav tabs (active "Moja
spiżarnia" with a 3px green bottom-border underline; plain "Historia przepisów" link
to `/recipes`), a static right-side avatar+email+chevron (placeholder for Phase 2's
dropdown), and a full-width divider beneath. Named/placed like `Topbar.astro` (PascalCase,
`src/components/`, not nested) since it's the same category of shared chrome.

**Contract**: Props: `{ email: string }`. Reuses `Topbar.astro`'s logo/wordmark markup
verbatim (chef-hat inline SVG in a `bg-brand-surface` circle + tri-weight
`font-logo` "Zero"/"Waste"/"Chef" spans) rather than re-deriving it. Since `AppNav` is
only mounted on the pantry page this change, the active tab is hardcoded to "Moja
spiżarnia" (no `Astro.url.pathname` branching needed yet — a future change restyling
`recipes.astro` will add that). The right-side avatar reuses the same chef-hat SVG with
an ink-colored (`brand-ink`) stroke instead of green, matching the Figma content
exactly.

#### 3. Wire AppNav into inventory.astro; switch page to light theme

**File**: `src/pages/inventory.astro`

**Intent**: Replace the current gradient `<h1>` + single link header with `<AppNav
email={Astro.locals.user.email} />`, switch the page wrapper off `bg-cosmic` onto a
light background, and add the "Moja spiżarnia" heading (`font-display`, `text-2xl`,
`brand-ink`) + Figma subtitle line ("Wpisz to, co masz pod ręką — nawet jeśli to tylko
kilka przypadkowych składników.", `font-body`, `text-sm`, `brand-muted`) above the
content area. `InventoryPanel`'s internal styling is untouched in this phase (still
`bg-cosmic`-styled — Phase 3).

**Contract**: Container width should comfortably hold Phase 3's two cards at roughly
Figma's ~60/40 proportions (~950-1000px combined, not the Figma canvas's literal
1600px) and remain responsive (stack on narrow viewports, no explicit mobile frame in
Figma — follow this codebase's existing `sm:` breakpoint convention).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Visiting `/inventory` while logged in shows the new nav bar (logo, underlined "Moja
  spiżarnia" tab, "Historia przepisów" link, static email + chevron) and the new
  heading/subtitle, matching the Figma frame's layout and colors.
- "Historia przepisów" navigates to `/recipes`.
- Page remains usable/readable at a narrow (mobile) viewport width.
- `InventoryPanel` below the new header still functions exactly as before (still
  dark-themed at this point — expected, restyled in Phase 3).

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 2: UserMenu sign-out dropdown

### Overview

Replace `AppNav`'s static avatar/email/chevron with a functional dropdown (Radix
`DropdownMenu`, sourced the same way `alert-dialog.tsx` sources `AlertDialog` — via
the already-installed `"radix-ui"` package, no new shadcn primitive) whose single item
signs the user out.

### Changes Required:

#### 1. UserMenu island

**File**: `src/components/nav/user-menu.tsx` (new)

**Intent**: A small React island — avatar badge + email + chevron trigger, opening a
menu with one "Sign out" item that posts to the existing `/api/auth/signout` route and
navigates home on success.

**Contract**: Props: `{ email: string }`. Import `DropdownMenu` from `"radix-ui"`
(matching `alert-dialog.tsx`'s import pattern), style the trigger/content with raw
Tailwind + `brand-*` tokens (no new `src/components/ui/` file). `onSelect` on the
"Sign out" item: `fetch("/api/auth/signout", { method: "POST" })`, then
`window.location.href = "/"` on success; on a non-ok response or thrown error, call
`toast.error(...)` (matching the `sonner` usage already in `inventory-panel.tsx`)
instead of leaving the user with no feedback.

#### 2. Mount UserMenu in AppNav

**File**: `src/components/AppNav.astro`

**Intent**: Swap the Phase 1 static avatar/email/chevron markup for `<UserMenu
email={email} client:load />` in the same position.

**Contract**: Same visual output when the menu is closed; only the interaction layer
is new.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Clicking the email/chevron opens a dropdown with a "Sign out" item; keyboard
  navigation (Tab/Enter/Escape) works via Radix's built-in behavior.
- Selecting "Sign out" signs the user out and lands on `/`; visiting `/inventory`
  afterward redirects to `/auth/signin` (confirms the session actually ended).
- Killing the network (e.g. devtools offline) before clicking "Sign out" surfaces a
  toast error rather than a silent failure or broken UI state.

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 3: Restyle InventoryPanel

### Overview

Restyle `InventoryPanel`'s existing markup — add-row, product list, pills, recipe
settings selects, and generate button — into the Figma frame's light two-column card
layout. No behavioral changes: every handler (`handleAdd`, `handleConfirmDelete`,
`handleGenerate`, `handleApprove`) stays as-is.

### Changes Required:

#### 1. Two-column card layout + "Produkty" section

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Wrap the existing add-form + product list in a bordered, white,
`rounded-[20px]` "Produkty" card (`border-brand-border`); replace the current stacked
add-form with an inline row — name input, date input, and an icon-only round green
"+" button (`lucide-react`'s `Plus`, replacing the current text "Add"/"Adding…"
button; keep a `Loader2` spinner swap for the submitting state, matching the pattern
already used for `isGenerating`) — labeled "Nowy produkt" above it, per Figma. Restyle
each product row as a `brand-surface`-filled, `rounded-[20px]` block.

**Contract**: `handleAdd`'s logic, `addError` handling, and the delete confirmation
`AlertDialog` are unchanged — only markup/classes move. Product secondary text changes
from `{product.expiry_date}` to a formatted `` `Exp. date: ${day}.${month}.${year}` ``
string (fixed `DD.MM.YYYY`, dot-separated, not locale-dependent — no `Intl` needed
since the input is always `YYYY-MM-DD`).

#### 2. Status pills

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Replace the current raw `bg-amber-100 text-amber-800` / `bg-red-100
text-red-800` pill classes with the Phase 1 tokens.

**Contract**: "At risk" → `bg-brand-warn-bg text-brand-warn border-brand-warn-border`;
"Expired" → `bg-brand-danger-bg text-brand-danger border-brand-danger-border`. Mutual
exclusivity logic (`is_at_risk`/`is_expired`) is unchanged.

#### 3. Pencil (disabled) + trash icons

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Add a `lucide-react` `Pencil` icon per product row, matching the Figma
frame, rendered inert (no `onClick`, `aria-disabled`, reduced-opacity styling) since no
edit functionality exists. The existing working `Trash2` delete button is restyled but
otherwise unchanged.

**Contract**: The pencil icon must not be a focusable/actionable control (no
`<button>` wrapper with a handler) — visual-only, consistent with the "omit
functionality that doesn't exist" decision applied via a disabled rather than fully
hidden treatment.

#### 4. Recipe settings card

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Wrap the Technique/Method/Time selects + "Generate Recipe" button in a
`brand-surface`-filled, borderless, `rounded-[20px]` "Ustawienia przepisu" card;
restyle each `<select>` from the current `border-white/20 bg-white/10 text-white` to
`bg-white border-brand-input-border text-brand-ink`, with a static `ChevronDown`
(`lucide-react`) icon overlaid on the right (`appearance-none` on the `<select>` +
absolutely positioned icon — matches the Figma bordered-box-with-chevron visual since
native selects don't otherwise support this). Change the button label from "Generate
Recipe" to "Generate" (matching the Figma text node exactly) and its background from
the current blue-purple gradient to `bg-brand-green hover:bg-brand-green/90`.

**Contract**: `params` state, `RECIPE_TECHNIQUE_LABELS`/`RECIPE_METHOD_LABELS`/
`RECIPE_TIME_LABELS`, and the `handleGenerate`/`isGenerating` logic are unchanged —
styling and copy only. The "Generating…" loading label keeps its current text (only
the idle-state label changes to "Generate").

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `/inventory` visually matches the Figma frame: two-column card layout, inline
  add-row with icon-only "+" button, restyled pills, disabled pencil icon, restyled
  selects with chevron, green "Generate" button.
- Add product, delete product (with confirmation), generate recipe, and approve recipe
  all still work end-to-end exactly as before the restyle.
- Product secondary text shows `Exp. date: DD.MM.YYYY` format.
- "At risk"/"Expired" pills render in the new colors and remain mutually exclusive.
- Layout stacks sensibly at a narrow (mobile) viewport width.
- No console errors/warnings introduced by the restyle.

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- None planned — this is a visual restyle of already-tested behavior, matching the
  manual-verification-only policy both prior Figma-driven changes used.

### Integration Tests:

- None planned, per the above.

### Manual Testing Steps:

1. Sign in, visit `/inventory` — confirm nav, heading, and two-column layout render
   per Figma.
2. Click "Historia przepisów" — confirm navigation to `/recipes`.
3. Open the email dropdown, tab through it with the keyboard, select "Sign out" —
   confirm redirect to `/` and that `/inventory` now redirects to `/auth/signin`.
4. Sign back in; add a product, delete a product (confirm the `AlertDialog` still
   appears), generate a recipe, approve it — confirm all four flows work unchanged.
5. Add a product with today's date and one further out — confirm "At risk"/"Expired"
   pills (if applicable) render in the new colors.
6. Resize the browser to a narrow width — confirm the layout stacks without breaking.

## Performance Considerations

None — this is a styling/markup change with one small new client-hydrated island
(`UserMenu`); no new data fetching or heavier computation is introduced.

## Migration Notes

Not applicable — no data model or schema changes.

## References

- Research: `context/changes/dashboard-ux-update/research.md`
- Figma frame: `Desktop - 3` (`fileKey=HijlsMP1h4eCPUbUIjBoPI`, `nodeId=1:240`)
- Prior precedent: `context/changes/home-page-ui-update/plan.md`,
  `context/changes/sign-up-ux-update/plan.md`
- Existing dropdown/Radix pattern: `src/components/ui/alert-dialog.tsx:1-9`
- Existing sign-out route: `src/pages/api/auth/signout.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step
> lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Design tokens + AppNav shell

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 9576cd8
- [x] 1.2 Linting passes: `npm run lint` — 9576cd8
- [x] 1.3 Build succeeds: `npm run build` — 9576cd8

#### Manual

- [x] 1.4 New nav bar (logo, underlined tab, link, static email+chevron) and
      heading/subtitle render per Figma — 9576cd8
- [x] 1.5 "Historia przepisów" navigates to `/recipes` — 9576cd8
- [x] 1.6 Page remains usable at a narrow viewport width — 9576cd8
- [x] 1.7 InventoryPanel below still functions as before (dark-themed, expected) — 9576cd8

### Phase 2: UserMenu sign-out dropdown

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — d0ecf86
- [x] 2.2 Linting passes: `npm run lint` — d0ecf86
- [x] 2.3 Build succeeds: `npm run build` — d0ecf86

#### Manual

- [x] 2.4 Dropdown opens with "Sign out" item; keyboard navigation works — d0ecf86
- [x] 2.5 Sign out lands on `/`; `/inventory` afterward redirects to `/auth/signin` — d0ecf86
- [x] 2.6 Offline sign-out attempt surfaces a toast error, not a silent failure — d0ecf86

### Phase 3: Restyle InventoryPanel

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build succeeds: `npm run build`

#### Manual

- [x] 3.4 Page visually matches the Figma frame (layout, add-row, pills, pencil,
      selects, button)
- [x] 3.5 Add / delete / generate / approve flows all still work end-to-end
- [x] 3.6 Product secondary text shows `Exp. date: DD.MM.YYYY` format
- [x] 3.7 Pills render in new colors and remain mutually exclusive
- [x] 3.8 Layout stacks sensibly at a narrow viewport width
- [x] 3.9 No console errors/warnings introduced
