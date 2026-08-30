# Recipe History UX Update — Plan Brief

> Full plan: `context/changes/recipe-history-ux-update/plan.md`

## What & Why

Restyle `/recipes` from its dark "cosmic" glassmorphism theme into the light "Historia przepisów" card-grid view specified by Figma frame `Desktop - 4` — the last of the design file's four frames still unclaimed by any change. All content already works (paged, RLS-protected recipe reads) — this is a visual and interaction restyle, following the same pattern `dashboard-ux-update` used for `/inventory`.

## Starting Point

`recipes.astro` renders a dark gradient `<h1>` on `bg-cosmic`, then mounts `RecipeHistoryPanel` — a glassmorphism accordion list with click-to-expand rows and Prev/Next pagination. It doesn't use the shared `AppNav` component that `dashboard-ux-update` built for `/inventory`. The data layer (`listRecipes`, `GET /api/recipes`, route protection) is already correct and untouched by this change. `AppNav` itself has a latent bug: it hardcodes the active-tab underline on "Moja spiżarnia" regardless of page, invisible until now because it was only ever mounted on `/inventory`.

## Desired End State

A signed-in user visits `/recipes` and sees the same light nav bar as `/inventory`, correctly underlining "Historia przepisów". Their approved recipes render newest-first as a responsive card grid, each card previewing title/date/truncated ingredients with a bottom fade; clicking a card opens a dialog with the full recipe (ingredients, steps, used products). Prev/Next paging sits below the grid, restyled to brand tokens.

## Key Decisions Made

| Decision             | Choice                                                                          | Why (1 sentence)                                                                                                                                                                  | Source |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Full-recipe access   | Click-to-open dialog (raw `radix-ui`, feature-scoped like `UserMenu`)           | Figma's fixed-height truncated card has no visible expand affordance, but users must still be able to read the full recipe                                                        | Plan   |
| Truncation technique | CSS `line-clamp` + bottom gradient fade                                         | Matches Figma's visual treatment cleanly with a built-in Tailwind v4 utility, no new dependency                                                                                   | Plan   |
| Pagination           | Keep Prev/Next below the grid, restyled                                         | Figma shows no pagination control at all; reusing the existing paged API/service avoids any data-layer risk                                                                       | Plan   |
| Nav active tab       | Make `AppNav` page-aware via a `current` prop                                   | Figma's underline-stuck-on-"Moja spiżarnia" is a duplicated-frame artifact, not an intended design; a real nav must reflect the current page                                      | Plan   |
| Subtitle copy        | Write new history-appropriate copy, not Figma's mismatched pantry-page sentence | The Figma text is a copy-paste artifact ("Wpisz to, co masz pod ręką…" is about adding inventory items) that doesn't fit a history page                                           | Plan   |
| Empty/error states   | Restyle existing copy and logic as-is                                           | Preserves the deliberate loadError-vs-empty distinction already documented in the code, with zero behavior risk                                                                   | Plan   |
| Responsive grid      | 2 columns desktop, 1 column on narrow viewports                                 | Matches the responsive pattern already used elsewhere in the app; Figma is desktop-only and doesn't specify mobile                                                                | Plan   |
| Testing              | Manual verification only (typecheck/lint/build)                                 | Matches the explicit precedent from all three prior Figma-driven changes, including a prior similarly-new interactive piece (the sign-out dropdown) that also shipped manual-only | Plan   |

## Scope

**In scope:**

- `AppNav.astro` gains a `current` prop; both call sites (`inventory.astro`, `recipes.astro`) updated
- `recipes.astro` page shell restyle (light theme, `AppNav`, corrected heading/subtitle)
- Full `RecipeHistoryPanel` rewrite: card grid, truncation + fade, detail dialog, restyled pagination/empty/error states

**Out of scope:**

- Any change to `recipe.service.ts`, `GET /api/recipes`, or RLS/route protection
- `dashboard.astro` (not one of the four Figma frames)
- Delete/cook-again/search/filter, a separate `/recipes/:id` route, new shadcn `src/components/ui/` primitives, automated test coverage for the new interactive pieces

## Architecture / Approach

```
recipes.astro (SSR, unchanged data flow)
      │ AppNav current="recipes"
      ▼
RecipeHistoryPanel (client:load)
      │ grid of cards, each a Dialog.Trigger
      ▼
click → Dialog.Content (full recipe)      Prev/Next → GET /api/recipes?page=N (unchanged)
```

`AppNav.astro` becomes parameterized by `current`; the Dialog is feature-scoped raw `radix-ui`, mirroring `UserMenu`'s existing pattern rather than adding a new shadcn wrapper.

## Phases at a Glance

| Phase                            | What it delivers                                               | Key risk                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1. AppNav page-aware active tab  | `current` prop + both call sites updated                       | Must not regress `/inventory`'s existing correct appearance                                                                   |
| 2. `recipes.astro` shell restyle | Light theme, `AppNav`, corrected heading/subtitle              | None significant — pure shell swap, data flow untouched                                                                       |
| 3. `RecipeHistoryPanel` rewrite  | Card grid, truncation/fade, detail dialog, restyled pagination | Preserving the existing pagination state logic (in-flight guard, page clamping) exactly while changing all surrounding markup |

**Prerequisites:** None — no new dependencies (`radix-ui` and Tailwind v4's `line-clamp` are already available), no schema changes.
**Estimated effort:** ~1 session across 3 phases (single-page visual + interaction restyle).

## Open Risks & Assumptions

- The click-to-open dialog and page-aware nav are genuinely new interactive behavior (not pure restyling) shipping without automated test coverage — consistent with precedent, but worth flagging as this repo's growing untested-interactive-surface area.
- Card-grid pagination behavior (page turn closing any open dialog, empty-page-after-shrink edge case) is inherited unchanged from the existing panel logic and should still be manually re-verified once wrapped in new markup.

## Success Criteria (Summary)

- `/recipes` visually matches the Figma frame's card-grid layout, colors, and copy (except the two deliberately-corrected artifacts).
- The nav underline correctly reflects the current page on both `/inventory` and `/recipes`.
- Every approved recipe remains fully readable (via the new dialog) and pagination, empty-state, and error-state behavior all work with no regressions from the prior implementation.
