# Recipe History UX Update Implementation Plan

## Overview

Restyle `/recipes` from its dark "cosmic" theme into the light, brand-token "Historia przepisów" view specified by Figma frame `Desktop - 4` — the last of the Figma file's four top-level frames still unclaimed by any change. This follows the same restyle pattern `dashboard-ux-update` used for `/inventory`: reuse the shared `AppNav`, swap to brand tokens, no changes to the data layer.

## Current State Analysis

- `src/pages/recipes.astro` renders a one-off dark gradient `<h1>` on `bg-cosmic`, then mounts `RecipeHistoryPanel` — a 190-line glassmorphism (`border-white/20 bg-white/10`) accordion list with click-to-expand rows and Prev/Next pagination. It does not use `AppNav`.
- `src/components/AppNav.astro` (built by `dashboard-ux-update`) already renders both nav links ("Moja spiżarnia" → `/inventory`, "Historia przepisów" → `/recipes`) and mounts `UserMenu`, but hardcodes the green underline on "Moja spiżarnia" regardless of which page it's rendered on — today it's only ever called from `inventory.astro`, so this has never surfaced as a bug.
- `src/lib/services/recipe.service.ts`'s `listRecipes` (paged, `user_id`-filtered, `RECIPES_PAGE_SIZE = 20`) and the `GET /api/recipes?page=N` endpoint are correct and unaffected — this is a visual-only change.
- `/recipes` is already in `PROTECTED_ROUTES` in `src/middleware.ts`.
- All Figma frame colors already exist as tokens in `src/styles/global.css` (`--color-brand-green/-ink/-muted/-surface/-border`, plus the `-danger`/`-warn` pair added for `dashboard-ux-update`) — no new tokens are needed.
- Tailwind v4 (`@import "tailwindcss"` in `global.css`) ships `line-clamp-*` utilities in core; no plugin needed.
- `radix-ui` is already a dependency, used directly (not via a `src/components/ui/` shadcn wrapper) in `src/components/nav/user-menu.tsx` for the sign-out dropdown — this is the precedent to follow for the new detail Dialog, per the house rule against installing new shadcn primitives.

## Desired End State

A signed-in user visits `/recipes` and sees the same light-themed nav bar as `/inventory`, now correctly underlining "Historia przepisów" instead of "Moja spiżarnia". Below it, their approved recipes render newest-first as a responsive card grid (2 columns on desktop, 1 on narrow viewports), each card showing the title, date, and a truncated ingredients preview fading to white at the bottom. Clicking any card opens a dialog with the full recipe — ingredients, numbered steps, and the products it used. Prev/Next paging (20 per page) sits below the grid. Users with no recipes yet, or whose recipes failed to load, see restyled (light-theme) versions of the existing distinct messages for each case.

Verification: visit `/recipes` while signed in with several approved recipes spanning more than one page; confirm the grid, truncation/fade, dialog, pagination, and nav underline all match the above, and that `/inventory`'s nav underline still points at "Moja spiżarnia".

### Key Discoveries:

- Figma's own mock has two copy/state artifacts that must **not** be carried over literally, per user decision during planning: the nav underline stays on "Moja spiżarnia" in the `Desktop - 4` frame (a duplicated-frame artifact — `AppNav` must instead be page-aware), and the subtitle text is verbatim identical to the pantry page's ("Wpisz to, co masz pod ręką…", about adding inventory items) — this change writes new, history-appropriate subtitle copy instead.
- Figma's card grid shows no pagination control, no expand chevron, and no detail-view affordance at all — only a fixed-height card with a bottom gradient fade implying overflow. The interaction model (click-to-open dialog, kept Prev/Next pagination) is this plan's own decision, not derived from the design file.
- `recipe-history-panel.tsx:140` already contains the `instructions.split("\n")` logic needed to turn the TEXT column back into steps, and the `consumed_products.length > 0` guard for the "Used" section — both are preserved verbatim in the rewrite, just re-skinned.

## What We're NOT Doing

- No changes to `recipe.service.ts`, the `GET /api/recipes` endpoint, `RECIPES_PAGE_SIZE`, or the RLS/route-protection setup — all already correct.
- No delete recipe, "cook again", search/filter, or a separate `/recipes/:id` detail route (still non-goals per the original `recipe-history` PRD scope; the new dialog satisfies "view in full" without a route).
- No changes to `dashboard.astro` — it isn't one of the four Figma frames and keeps its own old-style "Recipe history" link untouched.
- No automated test coverage added for the new Dialog or `AppNav`'s active-tab prop (manual verification only, matching the explicit precedent set by all three prior Figma-driven changes, including `dashboard-ux-update`'s similarly-new sign-out dropdown).
- No new shadcn `src/components/ui/` primitive — the Dialog is feature-scoped raw `radix-ui`, matching `UserMenu`'s existing pattern.

## Implementation Approach

Three phases, each independently shippable and verifiable: (1) make `AppNav` page-aware so both pages get a correct active tab, (2) restyle the `recipes.astro` shell to the light theme with `AppNav` mounted, (3) fully rewrite `RecipeHistoryPanel` from an accordion list to the card grid with truncation, dialog, and restyled pagination/empty/error states.

## Phase 1: AppNav page-aware active tab

### Overview

`AppNav.astro` currently hardcodes "Moja spiżarnia" as the always-active tab. Add a `current` prop so the green underline (and corresponding muted/ink text weight) follows whichever page is actually being viewed, and update the one existing call site.

### Changes Required:

#### 1. AppNav component

**File**: `src/components/AppNav.astro`

**Intent**: Accept which tab is active and render the underline/ink-vs-muted styling on that tab instead of always on "Moja spiżarnia".

**Contract**: Add `current: "inventory" | "recipes"` to `Props`. Each of the two `<a>` tags in the `<nav>` block picks its class set (the active set currently hardcoded on the "Moja spiżarnia" link: `border-brand-green text-brand-ink border-b-[3px] pb-4 text-sm font-semibold`; the inactive set currently hardcoded on "Historia przepisów": `text-brand-muted hover:text-brand-ink pb-4 text-sm font-semibold`) based on whether `current` matches that link's route.

#### 2. Inventory page call site

**File**: `src/pages/inventory.astro`

**Intent**: Pass the new required prop so `/inventory` keeps its current (correct) active-tab appearance.

**Contract**: `<AppNav email={...} current="inventory" />`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `/inventory` still shows the green underline on "Moja spiżarnia" with no visual change from before.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: recipes.astro page shell restyle

### Overview

Rewrite the page shell to match `inventory.astro`'s light-theme structure: `Layout` + `AppNav` (now passing `current="recipes"`) + a Figma-matched heading block, keeping the existing SSR data-loading logic (`listRecipes` call, `loadError` flag) completely untouched.

### Changes Required:

#### 1. Recipes page

**File**: `src/pages/recipes.astro`

**Intent**: Replace the dark `bg-cosmic` shell and gradient `<h1>` with the light shell pattern from `inventory.astro`, mount `AppNav`, and correct the heading copy.

**Contract**: Keep the existing frontmatter (`createClient`, `Astro.locals.user`, `listRecipes(supabase, ..., 1)`, `try/catch` → `loadError`) unchanged. Replace the template: `<div class="min-h-screen bg-white p-6 sm:p-10">` wrapping a `max-w-[1000px]` (or a wider container if the 2-column grid needs it — see Phase 3) centered column containing `<AppNav email={...} current="recipes" />`, then an `<h1 class="font-display text-brand-ink text-2xl">Historia przepisów</h1>` with a `<p class="font-body text-brand-muted mt-1 text-sm">` subtitle reading exactly: "Wszystkie przepisy, które udało się ugotować z Twojej spiżarni." — deliberately not the Figma mock's mismatched pantry-page sentence. Mount `<RecipeHistoryPanel initialPage={initialPage} loadError={loadError} client:load />` unchanged below it.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- `/recipes` shows the light theme, correct nav underline on "Historia przepisów", and the new heading/subtitle — even though the panel below still looks like the old dark accordion until Phase 3 lands.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: RecipeHistoryPanel rewrite — card grid, truncation, detail dialog, pagination

### Overview

Replace the accordion list with the Figma-matched card grid: fixed-height cards with `line-clamp`-truncated ingredients and a bottom gradient fade, click-to-open dialog for the full recipe, and brand-token-styled Prev/Next pagination. All existing state logic (`pageData`/`page`/`isLoading`/`inFlight`/`goToPage`/`totalPages`/`showPagination`) is preserved as-is — only the rendered markup and the expand mechanism change.

### Changes Required:

#### 1. Recipe history panel

**File**: `src/components/recipes/recipe-history-panel.tsx`

**Intent**: Swap the `<ul>` accordion list for a responsive card grid; swap each `RecipeEntry`'s click-to-expand `<div>` for a card that opens a dialog on click; restyle the loading/empty/error text and the Prev/Next controls to brand tokens.

**Contract**:

- Root list container becomes `<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">` (replacing `<ul class="space-y-2">`); each `<RecipeEntry>` becomes a `<div>` grid item (or keep `<li>` inside a `<ul>` with `display: contents`/grid on the `<ul>` itself — implementer's choice, no semantic requirement here since these aren't a strict list of links).
- `loadError` message: replace `text-red-300` with `text-brand-danger`.
- Empty-page messages (`page === 1` / else branch): replace `text-white/50` with `text-brand-muted`.
- Each card: fixed height (`h-[264px]`) white card (`bg-white border border-brand-border rounded-[20px]`), `overflow-hidden`, `relative` positioning for the fade. Inside: title (`font-display text-brand-ink text-xl`), date (`font-body text-brand-muted text-sm`, reuse `formatDate` unchanged), "Ingredients" label (`font-body text-brand-muted text-sm font-medium uppercase` or matching Figma's non-uppercase medium weight — match Figma literally: no uppercase transform, just `font-medium`), and the ingredient list rendered as plain text (not a bulleted `<ul>`, to match Figma's plain preview lines) with `line-clamp-5 text-brand-ink text-base`.
- Bottom fade: an absolutely-positioned `<div class="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-[20px] bg-gradient-to-t from-white via-white/80 to-transparent">` overlaying the truncated ingredient text, matching Figma's `layer #4:229`/`#4:233`/`#4:236` fade rectangles.
- The whole card is the dialog trigger: wrap the card's content in `<Dialog.Trigger asChild><button type="button" class="h-full w-full text-left">…</button></Dialog.Trigger>` so it's keyboard-operable, mirroring the existing accordion button's a11y pattern.
- Dialog: import `Dialog as DialogPrimitive` from `"radix-ui"` (same import style as `DropdownMenu` in `user-menu.tsx`), one `<DialogPrimitive.Root>` per card holding its own open state, `Portal` → `Overlay` (`fixed inset-0 bg-black/40`) → `Content` (`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-brand-border bg-white p-6`) containing `Title` (recipe title, `font-display text-brand-ink text-xl`), the formatted date, then the existing Ingredients/Steps/Used sections verbatim from the current `RecipeEntry` body (same `steps = recipe.instructions.split("\n")...` line, same `consumed_products.length > 0` guard), each list item styled with brand tokens instead of `text-white/80`.
- Pagination controls: replace the two `<Button>` (from `@/components/ui/button`) elements with raw `<button>` elements styled `border-brand-border text-brand-ink hover:bg-brand-surface aria-disabled:pointer-events-none aria-disabled:opacity-50 rounded-lg border bg-white px-4 py-2 text-sm font-medium` (drop the `Button` import), keeping the exact same `aria-disabled`/`onClick` logic. Page indicator text becomes `text-brand-muted`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With several approved recipes, `/recipes` shows a 2-column card grid on desktop and 1 column on a narrow viewport, each card's ingredient preview clipped with a visible bottom fade.
- Clicking a card opens a dialog showing its full ingredients, numbered steps, and (when non-empty) used products; closing (overlay click or Escape) returns to the grid.
- With 21+ approved recipes, Prev/Next page through the full history correctly, matching the pre-existing pagination behavior (page clamping, in-flight guard, toast on network/API failure).
- Empty history and a forced load failure each show their own distinct, correctly-styled message.
- No new console errors; no regression in the `RecipeHistoryPanel` unit test suite if one exists (`npm test -- recipe-history-panel` or equivalent — check for an existing test file first).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Manual Testing Steps:

1. Sign in, visit `/inventory`, confirm the nav underline is still on "Moja spiżarnia" (Phase 1 regression check).
2. Visit `/recipes`, confirm the nav underline is on "Historia przepisów" and the page shell/heading/subtitle match the plan (Phase 2).
3. With 0 approved recipes, confirm the empty-state message renders correctly in the new light theme.
4. With 3–5 approved recipes (varying ingredient-list lengths), confirm card truncation, the bottom fade, and dialog open/close for at least one short and one long recipe.
5. Seed or approve 21+ recipes, confirm Prev/Next paging works and the dialog closes correctly when paging away from an open card.
6. Force a load failure (e.g. temporarily break the Supabase client) and confirm the distinct error message renders, styled correctly.
7. Resize the viewport to a phone width and confirm the grid collapses to 1 column without cramping.

## Migration Notes

None — no schema or data changes.

## References

- Prior implementation: `context/archive/2026-08-11-recipe-history/plan-brief.md`
- Precedent restyle: `context/changes/dashboard-ux-update/plan.md`, `context/changes/dashboard-ux-update/plan-brief.md`
- Figma frame: `Desktop - 4` (node `4:98`) in file `HijlsMP1h4eCPUbUIjBoPI`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: AppNav page-aware active tab

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — de1a067
- [x] 1.2 Linting passes: `npm run lint` — de1a067
- [x] 1.3 Build succeeds: `npm run build` — de1a067

#### Manual

- [x] 1.4 `/inventory` still shows the green underline on "Moja spiżarnia" with no visual change from before — de1a067

### Phase 2: recipes.astro page shell restyle

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Build succeeds: `npm run build`

#### Manual

- [x] 2.4 `/recipes` shows the light theme, correct nav underline on "Historia przepisów", and the new heading/subtitle

### Phase 3: RecipeHistoryPanel rewrite — card grid, truncation, detail dialog, pagination

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build succeeds: `npm run build`

#### Manual

- [ ] 3.4 2-column desktop / 1-column narrow-viewport grid renders with clipped ingredient preview and visible bottom fade
- [ ] 3.5 Clicking a card opens a dialog with full ingredients/steps/used-products; closes via overlay click or Escape
- [ ] 3.6 Prev/Next pagination works correctly with 21+ recipes, matching prior behavior
- [ ] 3.7 Empty-state and load-error messages each render distinctly and correctly styled
