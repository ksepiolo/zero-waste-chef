# Redesign inventory.astro as pantry view — Plan Brief

> Full plan: `context/changes/dashboard-ux-update/plan.md`
> Research: `context/changes/dashboard-ux-update/research.md`

## What & Why

Restyle `inventory.astro` from its dark "cosmic" glassmorphism theme into the light
"Moja spiżarnia" (My pantry) view specified by Figma frame `Desktop - 3`. Every piece
of content already works in the live app (product list, expiry pills, recipe-settings
selects, generate button) — this is almost entirely a visual restyle, plus one
genuinely new piece: a shared authenticated nav bar with a working sign-out dropdown,
which doesn't exist anywhere in the app today.

## Starting Point

`inventory.astro` currently renders a one-off gradient `<h1>` + a single "Recipe
history" link on a dark `bg-cosmic` background, then mounts `InventoryPanel` — a
412-line component styled entirely in `border-white/20 bg-white/10` glassmorphism.
Auth gating for `/inventory` is already correct and untouched by this change. No
shared nav exists anywhere; `Topbar.astro` is logged-out-only and `dashboard.astro`
has its own inline "Welcome, {email}" text and sign-out form.

## Desired End State

Logging in and visiting `/inventory` shows a light-themed page: a nav bar (logo,
underlined "Moja spiżarnia" tab, "Historia przepisów" link, working email
sign-out dropdown) above a two-column layout — a "Produkty" card (inline add-row,
restyled product rows with new pill colors and a disabled pencil / working trash icon)
beside a "Ustawienia przepisu" card (Technique/Method/Time selects + green "Generate"
button). All existing add/delete/generate/approve behavior is unchanged.

## Key Decisions Made

| Decision                  | Choice                                                                                             | Why (1 sentence)                                                                                                           | Source |
| ------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| Shared nav scope          | Extract `AppNav.astro`, wire into `inventory.astro` only                                           | Avoids a half-restyled `recipes.astro` (light nav on a still-dark body) while avoiding a 3rd from-scratch nav build later  | Plan   |
| Pencil/edit icon          | Render disabled/non-functional, matching Figma visually                                            | No backing `updateProduct`/PATCH exists; showing it inert matches Figma without implying working functionality             | Plan   |
| Email dropdown            | Functional, with a working "Sign out" action                                                       | Nav becomes a real production nav bar immediately rather than a static mockup                                              | Plan   |
| Status pill colors        | New `--color-brand-danger*`/`-warn*` tokens in `global.css`                                        | Follows the `--color-brand-input-border` precedent of token-izing new Figma hexes rather than hardcoding raw hex in markup | Plan   |
| Testing approach          | Manual verification only (typecheck/lint/build gates)                                              | Matches the policy both prior Figma-driven changes used; small, low-risk UI surface                                        | Plan   |
| Priority if time is short | Everything in scope is must-have                                                                   | Small, well-scoped restyle with most unknowns already resolved by research — ship it complete                              | Plan   |
| Sign-out plumbing         | Radix `DropdownMenu` sourced from the `"radix-ui"` package, `fetch` + client redirect (not a form) | Matches `alert-dialog.tsx`'s existing sourcing pattern; a native form doesn't compose cleanly inside a Radix menu item     | Plan   |

## Scope

**In scope:**

- `inventory.astro` page shell restyle + new `AppNav.astro`/`UserMenu` nav
- `InventoryPanel` full visual restyle (structure/copy/colors), no behavior changes
- Two new brand-token color pairs for status pills

**Out of scope:**

- `recipes.astro` (Desktop-4 recipe history) restyle — future change
- `dashboard.astro` — untouched, keeps its own inline sign-out form
- Product edit/update functionality (pencil icon is visual-only)
- New shadcn primitives, i18n/translation, dark mode, automated test coverage

## Architecture / Approach

Three phases, each independently shippable: (1) static nav shell + new tokens, (2) the
one new interactive piece — a Radix-powered sign-out dropdown — (3) the full
`InventoryPanel` restyle. `AppNav.astro` is a plain Astro component (no hydration);
`UserMenu.tsx` is the one small React island it mounts for the dropdown.

## Phases at a Glance

| Phase                           | What it delivers                                             | Key risk                                                                                                |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1. Design tokens + AppNav shell | New pill tokens; static nav bar wired into `inventory.astro` | Container proportions must approximate Figma without hardcoding its 1600px canvas                       |
| 2. UserMenu sign-out dropdown   | Functional Radix dropdown with working sign-out              | Native form pattern doesn't compose inside a Radix menu item — needs fetch + redirect instead           |
| 3. Restyle InventoryPanel       | Full visual match: two-column cards, pills, selects, button  | Figma's `"example@mail.com"` select-box text is placeholder noise, not literal copy — don't hardcode it |

**Prerequisites:** None — no new dependencies, no schema changes, `radix-ui` package
already installed.
**Estimated effort:** ~1 session across 3 phases (small, single-page visual restyle).

## Open Risks & Assumptions

- The Figma frame's right-side "avatar" reuses the chef-hat glyph with an ink stroke
  (not green) — implemented literally as designed, not "fixed" to match the logo.
- No automated regression coverage is added for the new sign-out dropdown (matches
  precedent, but is a first for interactive nav code in this codebase).

## Success Criteria (Summary)

- `/inventory` visually matches the Figma frame's two-column pantry/recipe-settings
  layout, colors, and copy.
- Nav tabs, sign-out dropdown, and all pre-existing product/recipe flows work
  end-to-end with no regressions.
- `typecheck`/`lint`/`build` all pass; no new console errors.
