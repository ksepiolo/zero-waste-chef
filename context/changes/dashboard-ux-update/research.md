---
date: 2026-08-30T19:15:00+02:00
researcher: Kasia Sepiolo
git_commit: a818fc200a4fbb94fb198c09b7981f243ab25962
branch: feature/dashboard-ux-update
repository: zero-waste-chef
topic: "Redesign inventory.astro as pantry/recipe-settings view per Figma"
tags: [research, codebase, inventory, recipe-generation, ui-redesign, figma, brand-tokens]
status: complete
last_updated: 2026-08-30
last_updated_by: Kasia Sepiolo
---

# Research: Redesign inventory.astro as pantry/recipe-settings view per Figma

**Date**: 2026-08-30T19:15:00+02:00
**Researcher**: Kasia Sepiolo
**Git Commit**: a818fc200a4fbb94fb198c09b7981f243ab25962
**Branch**: feature/dashboard-ux-update
**Repository**: zero-waste-chef

## Research Question

Adjust `inventory.astro` to a pantry/recipe-settings view per the Figma design at
`https://www.figma.com/design/HijlsMP1h4eCPUbUIjBoPI/Zero-waste`. `inventory.astro`
should remain visible only after user log-in. Scope agreed with the user: include the
`/recipes` generation flow (to see whether the Figma "Recipe settings" panel duplicates
or absorbs it), at comprehensive depth.

## Summary

The Figma file "Zero waste" (`fileKey=HijlsMP1h4eCPUbUIjBoPI`) has exactly 4 top-level
frames, already fully claimed by prior/current changes:

| Frame           | Node ID     | Content                                                                    | Status                                           |
| --------------- | ----------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| Desktop - 1     | `1:2`       | Logged-out home page                                                       | Shipped — `context/changes/home-page-ui-update/` |
| Desktop - 2     | `1:195`     | Sign-up page                                                               | Shipped — `context/changes/sign-up-ux-update/`   |
| **Desktop - 3** | **`1:240`** | **"Moja spiżarnia" (My pantry) — products + recipe-settings, two columns** | **Target of this change**                        |
| Desktop - 4     | `4:98`      | "Historia przepisów" (Recipe history)                                      | Not in scope of this change (see Open Questions) |

**The good news: this is almost entirely a visual redesign, not new functionality.**
Every piece of content in the Desktop-3 frame already exists and works in the live app:

- Product list with add/delete, all wired end-to-end (`src/components/inventory/inventory-panel.tsx`).
- "Expired" / "At risk" status pills, already correctly derived and mutually exclusive
  (`classifyExpiry` in `src/lib/services/product.service.ts:42-49`).
- The exact "Recipe settings" panel — Technique / Method / Time preference selects plus a
  "Generate" button — already ships inline in the same component
  (`inventory-panel.tsx:256-334`), built by `context/changes/recipe-generation-ux/`
  (status `impl_reviewed`). The `/recipes` page (`src/pages/recipes.astro`) is **history
  only** — it never had a generation form, despite the URL name.
- Auth gating already exists and already satisfies "should be visible after user log in":
  `src/middleware.ts:4,18-22` lists `/inventory` in `PROTECTED_ROUTES` and redirects to
  `/auth/signin` when `context.locals.user` is null.

**What's actually missing is styling and shared chrome:**

1. `inventory.astro`/`inventory-panel.tsx` are still on the old dark "cosmic"
   glassmorphism theme (`bg-cosmic`, white/purple gradient text, `border-white/20
bg-white/10` controls) — none of the brand-token work from the two prior Figma
   passes has touched this page.
2. There is no shared top nav anywhere in the app (`Layout.astro` renders no header at
   all). The Figma frame's nav bar — logo, two tabs ("Moja spiżarnia" / "Historia
   przepisów", active one underlined), user-email dropdown — has no home yet.
   `inventory.astro`'s current header is a one-off `<h1>` + single link, unrelated to
   `recipes.astro`'s own one-off `<h1>`, and unrelated to `Topbar.astro` (which is
   logged-out-only) or `dashboard.astro`'s inline "Welcome, {email}" text.
3. No shadcn `Card`/`Input`/`Select`/`Badge`/`DropdownMenu`/`Tabs` components exist —
   two prior Figma changes each deliberately chose raw Tailwind + `brand-*` tokens over
   installing new shadcn primitives, and called this out explicitly as a followed
   convention both times.

## Detailed Findings

### The target Figma frame (Desktop - 3, node `1:240`, "Moja spiżarnia")

Fetched directly via `mcp__figma__get_figma_data` (`fileKey=HijlsMP1h4eCPUbUIjBoPI`,
`nodeId=1:240`, depth 4). Structure, top to bottom:

- **Top nav** (shared with Desktop-4, node `4:98`/`4:99-4:113` — i.e. the same nav
  markup repeats verbatim across both authenticated frames):
  - Chef-hat icon in a rounded surface (`#F8FAFB`) badge + "ZeroWasteChef" tri-weight
    wordmark (node `1:154`/`10:18`), positioned top-left.
  - Two nav items: "Moja spiżarnia" (My pantry) with a 3px green underline
    (`strokes` `#35BA6D`, node `10:24`) marking it active, and "Historia przepisów"
    (Recipe history) as a plain text link (node `10:25`) — this is the tab pair that
    should replace `inventory.astro`'s current single "Recipe history" link and
    `recipes.astro`'s bare `<h1>`.
  - User email + chevron-down on the far right (node `10:26-10:30`), text reads
    `ksepiolo@gmail.com` in the design (placeholder/demo content, not a literal
    requirement) — implies a dropdown affordance, though the Figma data doesn't show
    an open/expanded state.
  - A full-width divider line under the nav (node `10:32`).
- **Page heading**: "Moja spiżarnia" (Playfair Display, 24px) + a one-line subtitle
  (Inter, `#757E7B`) (nodes `1:300`, `1:302`).
- **Left column — "Produkty" (Products)**, bordered rounded card (`20px` radius,
  border `#E7E7E7`):
  - Section title "Produkty" (node `1:312`).
  - Inline "Nowy produkt" (New product) row: a name input (node `13:16`, placeholder
    "Nazwa produktu"), a date input (node `13:23`, placeholder "Data ważności"), and a
    green circular "+" button (node `13:27`) — this maps directly onto the existing add
    form (`inventory-panel.tsx:164-208`), just restyled as inline fields instead of a
    stacked form with a text "Add" button.
  - Product rows (nodes `2:4`, `2:22`, `2:36`, `2:50`), each: name + secondary detail
    text, a colored status pill for some rows ("Expired" — red/`#B14039` on
    `#FBEBEA`, node `2:19`; "At risk" — amber/`#B17939` on `#FBF3EA`, node `2:43`; some
    rows have no pill, i.e. plain/safe products), and pencil + trash icon buttons on
    the right (nodes e.g. `2:5`/`2:10`). **No edit/pencil functionality exists in the
    codebase today** — only add and delete are implemented
    (`src/lib/services/product.service.ts` has no `updateProduct`,
    `src/pages/api/products/[id].ts` only exports `DELETE`). The pencil icon in Figma
    has no backing implementation.
- **Right column — "Ustawienia przepisu" (Recipe settings)**, separate rounded card
  (`#F8FAFB` fill):
  - Section title (node `2:66`).
  - Three labeled dropdown-style fields — "Technique" (node `2:69`), "Method" (node
    `2:76`), "Time preference" (node `2:82`) — each a bordered box with a
    chevron-down icon, i.e. visually a custom select, not a native OS dropdown.
  - Green "Generate" button (node `2:87-2:88`) full-width in the card.

This maps almost 1:1 onto `inventory-panel.tsx`'s existing Technique/Method/Time
selects (`RECIPE_TECHNIQUES`/`RECIPE_METHODS`/`RECIPE_TIMES` from `src/types.ts:62-75`)
and "Generate Recipe" button (`inventory-panel.tsx:321-334`) — the redesign is a
restyle of already-shipped controls into a visually distinct card, not new fields.

Fonts used in the frame: Playfair Display (headings), Inter (body/labels/buttons),
Montserrat (logo wordmark only) — all three are already loaded globally via
`src/layouts/Layout.astro:19-24`'s Google Fonts link and already exposed as Tailwind
utilities (`font-display`, `font-body`, `font-logo`) via `src/styles/global.css:119-124`.

### Current `inventory.astro` / `InventoryPanel` implementation

- `src/pages/inventory.astro:1-37` — server-fetches `initialProducts` via
  `listProducts(supabase, user.id)` (silently falls back to `[]` on error, lines 11-16),
  wraps in `<Layout title="My Inventory">`, renders its own header (gradient `<h1>` +
  single "Recipe history" link, lines 23-33) then
  `<InventoryPanel initialProducts={...} client:load />` (line 34).
- `src/components/inventory/inventory-panel.tsx` (412 lines) owns essentially all
  interactive behavior:
  - **Add product** form (lines 164-208): `name` + `expiry_date` inputs, POSTs to
    `POST /api/products`, re-sorts local state by `expiry_date` on success.
  - **Product list** (lines 210-250): name, "At risk"/"Expired" pills (lines 223-231,
    inline Tailwind `bg-amber-100 text-amber-800` / `bg-red-100 text-red-800`,
    mutually exclusive by construction — no precedence logic needed), delete button
    with confirmation `AlertDialog` (lines 339-358).
  - **Recipe settings** (lines 252-336, only rendered when `products.length > 0`):
    three native `<select>` elements for technique/method/time bound to `params`
    state (`DEFAULT_RECIPE_PARAMS` from `src/types.ts:87`), disabled while
    generating/approving, a hint line ("These guide the AI — it aims for them, but
    does not always hit them"), and a "Generate Recipe" button.
  - **Recipe review dialog** (lines 360-409): shows generated title/ingredients/
    instructions, which products will be consumed, "Generate Different Recipe" /
    "Approve" actions.
  - No `edit`/`update` path exists for products anywhere in this component or its
    backing service/API.
- `src/components/hooks/use-recipe-generation.ts` (122 lines) — the only hook in
  `src/components/hooks/`; owns `generate`/`approve`/`reset` against
  `POST /api/recipes/generate` and `POST /api/recipes/approve`; `params` is passed in
  by the caller (inventory-panel owns the selection state), not owned by the hook.
- `src/lib/services/product.service.ts` (107 lines) — `listProducts`, `createProduct`,
  `deleteProduct`, all chaining `.eq("user_id", userId)` per the repo's data-isolation
  rule (`context/foundation/lessons.md:5-10`); `classifyExpiry` (lines 42-49) is the
  single derivation point for `is_at_risk`/`is_expired`, deliberately reading `Date`
  once so the two flags can never disagree.
- `src/pages/api/products/index.ts` — `GET`/`POST`, zod-validated
  (`createProductSchema`, expiry date must be today-or-later).
- `src/pages/api/products/[id].ts` — `DELETE` only; maps the service's `"not found"`
  to 404.
- `src/types.ts` — `Product`, `NewProduct`, `ProductWithRisk` (booleans, not an enum),
  plus all recipe-generation types (`RecipeParams`, `DEFAULT_RECIPE_PARAMS`,
  `RECIPE_TECHNIQUES`/`METHODS`/`TIMES` enums).

### Recipe generation & history (the `/recipes` side)

- `src/pages/recipes.astro` — **history only**. Server-fetches page 1 via
  `listRecipes()`, renders `<RecipeHistoryPanel initialPage loadError client:load />`.
  No Technique/Method/Time fields here and never were — confirmed against
  `context/changes/recipe-generation-ux/plan.md`, which deliberately targeted
  `inventory-panel.tsx`, not `recipes.astro`, for the parameter controls.
- `src/components/recipes/recipe-history-panel.tsx` (191 lines) — collapsible list,
  each entry shows title, UTC-pinned formatted date, and on expand: ingredients,
  steps, and a "Used" section of consumed product names; client-side pagination via
  `GET /api/recipes?page=`. This already matches the shape of the Figma "Desktop - 4"
  history frame (title, date, ingredients per card) — not restyled by this change per
  the agreed scope, but worth knowing it exists and already renders the right content.
- `src/lib/services/recipe.service.ts` — `generateRecipe` (model
  `google/gemini-2.5-flash-lite` via OpenRouter, strict JSON-schema response,
  at-risk-first prompt ordering, `MAX_PROMPT_PRODUCTS=25`), `listRecipes` (paged),
  `approveRecipe` (Postgres RPC `approve_recipe`, atomic insert+delete).
- `src/lib/services/recipe-prompt.ts` — `buildSystemPrompt(params)` templates the
  technique/method/time rules into the LLM system prompt; deliberately has no
  `astro:env` import so it stays unit-testable outside an Astro build.
- `src/pages/api/recipes/generate.ts`, `approve.ts`, `index.ts` — all
  `prerender = false`, zod-validated, matching the repo convention.
- **Known open issue** (from `context/changes/recipe-generation-ux/reviews/impl-review.md`,
  verdict NEEDS ATTENTION): with both technique and method pinned, the "Generate
  Different Recipe" variety-fallback rule can contradict the at-risk-floor rule,
  risking a 500. Not this change's problem to fix, but worth knowing the panel being
  restyled has a pre-existing, tracked correctness gap.

### Auth gating — already satisfies "visible after log-in"

- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/inventory", "/recipes"]`.
- `src/middleware.ts:18-22` — any request whose path starts with a protected route is
  redirected to `/auth/signin` when `context.locals.user` is null, **before** the page
  renders. `inventory.astro` itself also defensively checks `Astro.locals.user`
  before fetching products (`inventory.astro:11`), but the middleware is what actually
  enforces the "must be logged in" requirement — no page-level change is needed for
  this part of the ask.

### Shared UI / design-system inventory

- `src/layouts/Layout.astro` (58 lines) — loads fonts, renders `<Toaster>` +
  config-error banners + `<slot />`. **No nav/header of any kind.** Auth state is
  never referenced here.
- `src/components/Topbar.astro` (46 lines) — chef-hat icon + "ZeroWasteChef" wordmark
  - Sign in / Create account links, styled entirely with `brand-*` tokens. Used only
    by `Welcome.astro` (logged-out landing page). This is the established, twice-reused
    reference implementation for the logo/wordmark (reused again by
    `sign-up-ux-update`) — the natural base to extend into the authenticated nav bar
    the Figma frame calls for, adding the two nav tabs and user-email dropdown it
    currently lacks.
- `src/components/ui/` — only 4 files: `button.tsx` (shadcn, variants
  default/destructive/outline/secondary/ghost/link), `alert-dialog.tsx` (shadcn,
  Radix-based), `sonner.tsx` (Toaster wrapper), `LibBadge.astro` (unrelated
  starter-kit debug pill, blue/purple, not a status-badge system). **No** `Card`,
  `Input`, `Select`, `Badge`, `DropdownMenu`, `Tabs`, or `Label` exist under any name.
  `components.json` confirms shadcn is configured (`style: "new-york"`, `baseColor:
"neutral"`, `iconLibrary: "lucide"`), so `npx shadcn@latest add [name]` remains
  available if a component is deliberately added — but two prior Figma changes both
  chose not to, citing "raw Tailwind + brand tokens, consistent with sibling forms in
  the same file" as the explicit rationale.
- `src/styles/global.css` — shadcn OKLCH tokens (`--background`, `--primary`, etc.,
  lines 6-73) mapped via `@theme inline` (lines 75-110), **plus** an additive
  `brand-*` block (lines 112-124: `--color-brand-green #35ba6d`, `-ink #2f3231`,
  `-muted #757e7b`, `-muted-2 #a1ada9`, `-surface #f8fafb`, `-border #e7e7e7`,
  `-input-border #b9b6b6`, plus `--font-display`/`--font-body`/`--font-logo`). A
  separate `bg-cosmic` utility (lines 127-129, dark gradient) is the theme currently
  used by `inventory.astro`, `recipes.astro`, and `dashboard.astro` — visually the
  opposite of the light Figma design. No `tailwind.config.*` file; config is CSS-first
  via `@theme inline` + `@tailwindcss/vite`.
- Status pills today are inline `<span>` markup in `inventory-panel.tsx:223-231`
  using raw Tailwind `amber-100`/`red-100`, not yet expressed as `brand-*` tokens or a
  shared `Badge` component — a decision point for this change (see Architecture
  Insights).

## Code References

- `src/pages/inventory.astro:1-37` — page shell, product fetch, current header
- `src/components/inventory/inventory-panel.tsx:1-412` — all inventory + recipe-settings UI
- `src/components/hooks/use-recipe-generation.ts:1-122` — generate/approve/reset hook
- `src/lib/services/product.service.ts:1-107` — product CRUD + `classifyExpiry`
- `src/pages/api/products/index.ts` / `src/pages/api/products/[id].ts` — product API (no PATCH/edit)
- `src/types.ts` — `Product`, `ProductWithRisk`, `RecipeParams`, `DEFAULT_RECIPE_PARAMS`, recipe enums
- `src/pages/recipes.astro`, `src/components/recipes/recipe-history-panel.tsx` — recipe history (out of scope this change)
- `src/lib/services/recipe.service.ts`, `src/lib/services/recipe-prompt.ts` — generation logic
- `src/pages/api/recipes/generate.ts`, `approve.ts`, `index.ts` — recipe API
- `src/middleware.ts:4,18-22` — auth gating, already covers `/inventory`
- `src/layouts/Layout.astro:1-58` — shared shell, fonts, no nav
- `src/components/Topbar.astro:1-46` — reusable logo/wordmark reference implementation
- `src/styles/global.css:6-129` — shadcn tokens, `brand-*` tokens, fonts, `bg-cosmic`
- `src/components/ui/button.tsx`, `alert-dialog.tsx`, `sonner.tsx`, `LibBadge.astro` — full `ui/` inventory
- `components.json` — shadcn config (`new-york`, `neutral`, lucide icons)

## Architecture Insights

- **Figma frame ↔ change-folder mapping is 1:1 and already established as a
  convention.** `home-page-ui-update` and `sign-up-ux-update` each pinned themselves
  to exactly one frame and explicitly deferred the others. This change should do the
  same: own Desktop-3 (`1:240`) only, and treat Desktop-4 (`4:98`, recipe history)
  as a distinct future change even though it shares the same nav bar.
- **Shared nav is genuinely new ground.** No prior change built a persistent
  authenticated nav bar — `Topbar.astro` is logged-out-only, `dashboard.astro` has
  ad hoc "Welcome, {email}" text with its own sign-out form
  (`dashboard.astro:14,31-38`). Since the Figma nav (logo + 2 tabs + email dropdown)
  appears identically on both Desktop-3 and Desktop-4, and per convention #4 below
  ("no shared layout component unless there's a second consumer") — this change _is_
  the second consumer once it needs the same nav shape as the eventual history-page
  restyle, which is a reasonable trigger to extract a small shared nav component this
  time, rather than inlining it a third time later. Worth a call in planning.
- **Established, repeated conventions from the two prior Figma-driven changes**
  (`home-page-ui-update`, `sign-up-ux-update`), both explicitly stated as followed
  precedent in their own plans:
  1. Reuse existing `brand-*`/`font-*` tokens; add new one-off `--color-brand-*`
     tokens only for genuinely new Figma hexes not already covered (precedent:
     `--color-brand-input-border` was added this way for the sign-up frame). The
     Figma pantry frame introduces "Expired" pill colors `#B14039`/`#FBEBEA` and
     "At risk" `#B17939`/`#FBF3EA` that don't match any existing `brand-*` token or
     Tailwind's stock `amber-100`/`red-100` — a token decision for this change.
  2. Reuse `Topbar.astro`'s logo markup verbatim rather than re-deriving it.
  3. Do not install new shadcn primitives (`Input`/`Select`/`Card`/`Badge`/
     `DropdownMenu`/`Tabs`) — stay on raw Tailwind + `brand-*` tokens, matching
     sibling markup in the same file. Both prior changes state this explicitly as
     "following the precedent set by the home-page redesign."
  4. No shared layout/component extraction unless there's a second consumer.
  5. No dark-mode (`.dark`) variants anywhere in brand-styled pages.
  6. Manual verification only for pure visual/structural Figma-matching changes —
     gated on `typecheck`/`lint`/`build`, no new Playwright/E2E coverage.
  7. Icons: inline raw SVG copied from the `lucide-react` source (not a
     `lucide-react` + React-island import) for static, non-interactive icons in
     `.astro` files — see `Topbar.astro`'s inline chef-hat `<svg>`.
- **Data-isolation rule** (`context/foundation/lessons.md:5-10`) is already satisfied
  by every product service function touched here (`listProducts`, `createProduct`,
  `deleteProduct` all chain or set `user_id`) — no risk introduced by a pure
  restyle, but any new query this change adds (e.g. if it introduces product editing
  to match the Figma pencil icon) must follow the same pattern.
- **`ProductWithRisk` has no status enum** — only two independent booleans. A design
  that wants a single "status" concept (e.g. a `<Badge status="expired">`) will need
  to derive that mapping at the presentation layer; the underlying data model should
  not change for this restyle.

## Historical Context (from prior changes)

- `context/changes/home-page-ui-update/plan.md` — established the brand-token/font
  system, the Figma-frame-per-change scoping discipline, and the inline-SVG icon
  convention; explicitly earmarked the pantry/recipe-settings frame (Desktop-3/4) as
  a future change.
- `context/changes/sign-up-ux-update/plan.md` — confirmed token reuse (only one new
  token added for a genuinely new hex), reused `Topbar.astro`'s logo mark, confirmed
  the "no new shadcn primitives" stance, no shared layout component extracted, no
  dark-mode, manual-verification-only testing policy.
- `context/changes/expired-product-handling/plan.md` + `reviews/impl-review.md` —
  shipped the live "Expired"/"At risk" pill implementation being restyled by this
  change; confirms `classifyExpiry` mutual exclusivity and the `excluded_expired` /
  `onExpiredExcluded` toast mechanism that should be preserved or re-homed visually.
- `context/changes/recipe-generation-ux/plan.md` + `reviews/impl-review.md` —
  shipped the Technique/Method/Time preference selects and "Generate" button being
  restyled by this change, deliberately placed in `inventory-panel.tsx` rather than
  `recipes.astro`; documents the "Time preference"/"~15 min" copy decision and hint
  line; flags an open, unfixed correctness gap (pinned technique+method variety
  fallback vs. at-risk floor) not in scope here.
- `context/foundation/roadmap.md` — S-01 (`inventory-management`), S-02
  (`recipe-generation-loop`), S-03 (`recipe-history`) are `done`; S-04
  (`recipe-generation-ux`) is `in-progress` per the roadmap file though its own
  change folder shows `impl_reviewed` — this looks like the same staleness pattern
  already known from `[[project_roadmap_vs_testplan_tracks]]`-style drift, not
  something this change needs to reconcile.
- Archive (`context/archive/`) has no additional Figma/design-driven changes —
  `2026-05-31-inventory-management`, `2026-05-31-data-schema`,
  `2026-06-05-recipe-generation-loop`, `2026-08-11-recipe-history`,
  `2026-08-18-testing-generate-approve-e2e` are all schema/logic/test-rollout work.

## Related Research

None found — this is the first `research.md` for this change, and no other
`context/changes/**/research.md` exists yet that overlaps this topic (the four prior
UI/feature changes referenced above went straight from `change.md` to
`plan-brief.md`/`plan.md` without a research phase).

## Open Questions

1. **Desktop-4 (recipe history) restyle** — out of scope per this change's stated
   intent (`inventory.astro` only), but it shares the exact same nav bar as
   Desktop-3. If a shared nav component is extracted now, should `recipes.astro` be
   updated to consume it in this same change (touching a file outside the stated
   scope), or left on its current bare `<h1>` until a follow-up change restyles
   Desktop-4? Recommend deciding explicitly in planning rather than leaving it
   implicit.
2. **Pencil/edit icon on product rows** — present in the Figma design but backed by
   no implementation anywhere (no `updateProduct` service function, no `PATCH`
   route). Recommend planning explicitly scope this out (render no edit affordance,
   or add a visually-present-but-disabled control) rather than silently omitting
   Figma content.
3. **User-email dropdown behavior** — Figma shows a chevron-down next to the email
   but no open/expanded state in the file. `dashboard.astro` has an inline sign-out
   `<form>`; is the dropdown meant to hold sign-out (and if so, should
   `dashboard.astro` also switch to it), or is it presentational-only for this pass?
4. **Status-pill color tokens** — the Figma "Expired"/"At risk" hex pairs don't match
   any existing `brand-*` token or stock Tailwind `red-100`/`amber-100`. Recommend
   planning decide once whether to add `--color-brand-danger*`/`--color-brand-warn*`
   tokens (consistent with the `--color-brand-input-border` precedent) or keep raw
   Tailwind utility classes tuned to the new hexes.
