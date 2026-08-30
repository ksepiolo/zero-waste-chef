# Home Page UI Update Implementation Plan

## Overview

Rebuild the public home page (`src/pages/index.astro` + `src/components/Welcome.astro` +
`src/components/Topbar.astro`) to match the approved Figma design ("Zero waste" file,
`HijlsMP1h4eCPUbUIjBoPI`, frame "Desktop - 1"), replacing the current generic "10x Astro
Starter" cosmic-purple placeholder with Zero Waste Chef branding.

## Current State Analysis

- `src/pages/index.astro:1-9` renders `<Layout><Welcome /></Layout>` unconditionally, for
  both anonymous and authenticated visitors — `/` is not in `PROTECTED_ROUTES`
  (`src/middleware.ts:4`).
- `src/components/Welcome.astro` is a generic cosmic/starfield hero with "10x Astro
  Starter" copy, purple gradient CTAs, and three feature cards — none of it matches the
  product.
- `src/components/Topbar.astro` is used **only** by `Welcome.astro` (verified — no other
  page imports it), so it can be freely redesigned. It currently branches on
  `Astro.locals.user` to show either an authenticated bar (email + Dashboard + Sign out)
  or an anonymous bar (Sign in + Sign up), both styled for the cosmic theme.
- `src/layouts/Layout.astro` wraps every page, sets the default `<title>` to
  `"10x Astro Starter"`, and has no font `<link>` tags today.
- `src/styles/global.css` defines a full shadcn/ui-style token set (`--primary`,
  `--secondary`, `--muted`, etc. as grayscale `oklch()` values) consumed by
  `src/components/ui/button.tsx` and other shared UI. No brand color or custom font is
  defined anywhere in the project.
- No i18n system exists in the project — all existing UI copy (auth forms, dashboard) is
  hardcoded per-page, so hardcoding the Polish copy from Figma directly follows the
  established pattern.
- `dashboard.astro` is itself still a placeholder page using the old cosmic theme — it is
  the existing redirect target for authenticated users elsewhere in the app (see
  `Topbar.astro`'s current "Dashboard" link) and is not part of this change's scope.

### Key Discoveries:

- Figma frame "Desktop - 1" (node `#1:2`) is the only frame in scope — the other three
  frames in the file (sign-up form, pantry/recipe-settings, recipe history) map to
  different existing routes and are explicitly out of scope for this change.
- The hero photo has been downloaded from Figma (node `1:193`) to
  `public/images/home-hero.png` (1407×938, ~2.2MB) — needs to go through
  `astro:assets`' `<Image>` so it's optimized/resized at build time rather than served as
  a 2.2MB PNG.
- Figma text styles used: logo wordmark is Montserrat 800/500/200 (see Phase 2), the hero
  headline is Playfair Display SemiBold 52px/1.2/-0.02em, body copy is Inter Medium
  16px/1.6/-0.01em, buttons are Inter SemiBold 14–16px.
- Brand colors: green accent `#35BA6D`, ink text `#2F3231`, muted text `#757E7B`,
  secondary muted `#A1ADA9`, light surface `#F8FAFB`, hairline border `#E7E7E7`, white
  `#FFFFFF`.
- Tailwind v4's `@theme` block generates a `font-<name>` utility for any `--font-<name>`
  variable (confirmed against current Tailwind docs) — the same pattern `global.css`
  already uses for `--color-*` → `bg-*`/`text-*` utilities.

## Desired End State

A logged-out visitor to `/` sees a Zero Waste Chef–branded page: a topbar with the
chef-hat logo/wordmark and "Sign in" / "Create free account" actions, and a full-width
rounded hero card with a fridge/food photo background, a gradient overlay, the Playfair
Display headline "Przepisy dopasowane do twojej lodówki", supporting body copy, and a
green "Get started" button linking to sign-up. An authenticated visitor hitting `/` is
redirected straight to `/dashboard` and never sees this marketing page.

Verification: `npm run typecheck` and `npm run lint` pass; visiting `/` in a browser
while logged out matches the Figma frame (fonts, colors, copy, image, CTA behavior,
responsive down to mobile width); visiting `/` while logged in redirects to `/dashboard`.

## What We're NOT Doing

- Not touching `Desktop - 2/3/4` frames (sign-up form, pantry/recipe-settings UI, recipe
  history UI) — those belong to `auth/signup.astro`, `inventory.astro`/`dashboard.astro`,
  and `recipes.astro` respectively, each a separate future change.
- Not repainting the shared shadcn `--primary`/`--secondary`/etc. tokens or the shared
  `Button` component — new brand tokens are added alongside them, isolated, so
  signin/signup/dashboard/inventory/recipes pages are visually unaffected by this change.
- Not replacing the favicon (still the generic starter icon) — no favicon asset exists in
  the Figma export for this frame.
- Not adding a Playwright E2E test for this page — verification is manual for this
  change (explicit decision; typecheck/lint remain the automated gate).
- Not building the authenticated-user topbar variant seen in `Desktop - 3/4` (pantry nav,
  avatar dropdown) — `/` now redirects authenticated users away before Topbar ever
  renders for them, so there is no authenticated state left to design here.

## Implementation Approach

Three phases, each independently shippable:

1. **Foundation** — plumbing that everything else depends on: font loading, brand color
   tokens, the auth redirect, and the page title. No visible UI change yet beyond the
   `<title>`.
2. **Topbar redesign** — rebuild `Topbar.astro` as an anonymous-only component (the
   Phase 1 redirect makes the authenticated branch dead code, so it's removed rather than
   restyled).
3. **Hero rewrite** — rebuild `Welcome.astro`'s content to match the Figma hero card,
   using the Phase 1 tokens/fonts and the downloaded photo.

## Critical Implementation Details

**Font loading is global, not page-scoped.** `Layout.astro` has no head-injection slot
today and adding one just for this change would be net-new complexity for a single
consumer. The `<link>` tags go directly in `Layout.astro`'s `<head>`, so every page pays
the font-loading cost, not just `/`. This mirrors the already-agreed decision to make the
brand _color_ tokens global/reusable rather than page-scoped — treat font tokens the same
way. If this becomes a measurable perf concern later, scoping to a per-page slot is a
follow-up, not a blocker here.

**Chef-hat icon has no existing static-SVG source in this codebase.** Every current
`lucide-react` usage (`src/components/auth/*`, `sonner.tsx`, etc.) is inside a `.tsx`
React island; `Topbar.astro` is a plain Astro component with no client interactivity, so
pulling in `lucide-react` + React just to render one static icon would be a new pattern
for this codebase. Instead, inline the icon as raw SVG (same approach `Welcome.astro`
already uses today for its feature-card icons), sourced verbatim from
`lucide-react`'s `chef-hat.mjs` so it stays pixel-identical to the Figma icon:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/>
  <path d="M6 17h12"/>
</svg>
```

---

## Phase 1: Foundation (fonts, brand tokens, redirect, title)

### Overview

Lay the groundwork Phases 2–3 build on: load the three Figma fonts, register isolated
brand color/font tokens in Tailwind's theme, redirect authenticated visitors away from
`/`, and set the page `<title>`.

### Changes Required:

#### 1. Font loading

**File**: `src/layouts/Layout.astro`

**Intent**: Load Playfair Display (headline), Inter (body/UI), and Montserrat (logo
wordmark) from Google Fonts for every page, with `display=swap` to avoid blocking render.

**Contract**: Add `<link rel="preconnect" href="https://fonts.googleapis.com">`,
`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`, and a single
`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">` covering:
Playfair Display weight 600; Inter weights 200, 400, 500, 600; Montserrat weights 200,
500, 800. Place inside the existing `<head>`, after the `<meta viewport>` tag.

#### 2. Brand tokens

**File**: `src/styles/global.css`

**Intent**: Register brand colors and font families as new Tailwind v4 theme variables,
additive to (never replacing) the existing shadcn `--primary`/`--secondary`/etc. tokens,
so `bg-brand-green`, `text-brand-ink`, `font-display`, `font-logo`, etc. become available
utility classes without touching any existing token consumer.

**Contract**: Inside the existing `@theme inline { ... }` block, add:

- `--color-brand-green: #35BA6D`
- `--color-brand-ink: #2F3231`
- `--color-brand-muted: #757E7B`
- `--color-brand-muted-2: #A1ADA9`
- `--color-brand-surface: #F8FAFB`
- `--color-brand-border: #E7E7E7`
- `--font-display: "Playfair Display", serif`
- `--font-sans: "Inter", sans-serif`
- `--font-logo: "Montserrat", sans-serif`

(Tailwind v4 generates `bg-brand-green`/`text-brand-ink`/etc. from `--color-brand-*`, and
`font-display`/`font-sans`/`font-logo` from `--font-*`, following the same convention the
file already uses for `--color-primary` → `bg-primary`.)

#### 3. Redirect authenticated visitors

**File**: `src/pages/index.astro`

**Intent**: Authenticated visitors should never see the marketing hero — send them
straight to `/dashboard`, matching the Figma frame's logged-out-only scope and removing
the need to design an authenticated home-page state.

**Contract**: Read `Astro.locals.user` (populated by `src/middleware.ts` for every
request); if truthy, `return Astro.redirect("/dashboard")` before rendering `<Layout>`.
Pass a `title` prop to `<Layout>` (see next item).

#### 4. Page title

**File**: `src/pages/index.astro`

**Intent**: Replace the generic starter title for this route.

**Contract**: `<Layout title="Zero Waste Chef — Przepisy dopasowane do twojej lodówki">`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Visiting `/` while logged out shows the new fonts applied somewhere on the page (dev
  tools computed style shows Playfair Display / Inter / Montserrat loaded, not a
  fallback)
- Visiting `/` while logged in redirects to `/dashboard`
- Browser tab title reads "Zero Waste Chef — Przepisy dopasowane do twojej lodówki"
- No other page's visual appearance changed (spot-check `/auth/signin`,
  `/auth/signup`, `/dashboard`)

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 2: Topbar redesign

### Overview

Rebuild `Topbar.astro` to match the Figma topbar: chef-hat logo + "ZeroWasteChef"
wordmark on the left, "Sign in" (outline) and "Create free account" (filled green)
buttons on the right. The authenticated branch is removed — Phase 1's redirect means this
component only ever renders for anonymous visitors now.

### Changes Required:

#### 1. Topbar component

**File**: `src/components/Topbar.astro`

**Intent**: Replace the `user`-branching cosmic-themed bar with a single anonymous-only
bar matching Figma: circular light-gray badge containing the chef-hat SVG (see Critical
Implementation Details above), wordmark text "Zero" (Montserrat ExtraBold 800) + "Waste"
(Montserrat Medium 500) + "Chef" (Montserrat ExtraLight 200) at 22px with -0.02em
tracking, then on the far side an outline "Sign in" button (`href="/auth/signin"`,
`border-brand-green text-brand-green`) and a filled "Create free account" button
(`href="/auth/signup"`, `bg-brand-green text-white`), both `rounded-lg`, Inter SemiBold
14px, `44px` tall with `16px` horizontal padding.

**Contract**: Drop the `const { user } = Astro.locals` destructure and the
conditional — the component takes no props and renders one fixed markup tree. Remove the
now-unused `user` import path.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Topbar visually matches the Figma frame: logo left, two CTA buttons right, correct
  colors/fonts/spacing
- "Sign in" navigates to `/auth/signin`; "Create free account" navigates to
  `/auth/signup`
- Topbar remains legible and doesn't overflow/wrap awkwardly at mobile widths (~375px)

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 3: Hero section rewrite

### Overview

Replace `Welcome.astro`'s cosmic hero and feature cards with the Figma hero card: full
width rounded photo card with gradient overlay, Playfair Display headline, Inter body
copy, and a green "Get started" CTA.

### Changes Required:

#### 1. Hero content

**File**: `src/components/Welcome.astro`

**Intent**: Remove the starfield/cosmic background, gradient-text headline, and three
feature cards entirely. Render `<Topbar />` followed by a single hero card: a rounded
(`rounded-2xl`/20px) container with `public/images/home-hero.png` as a `cover`-fit
background (via `astro:assets`' `<Image>` component for build-time optimization), an
overlay approximating Figma's left-to-right white gradient
(`linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.52) 100%)`) so the
dark headline text stays legible over the photo, and inside it: an `h1` reading "Przepisy
dopasowane do twojej lodówki" (`font-display`, `text-brand-ink`, responsive down from
52px), a `p` with the supporting copy (`font-sans`, `text-brand-ink`, Inter Medium 16px),
and a "Get started" button (`bg-brand-green text-white rounded-lg`, Inter SemiBold,
`href="/auth/signup"`).

**Contract**: Exact body copy: "Wpisz to, co masz pod ręką — nawet jeśli to tylko kilka
przypadkowych składników. Dostaniesz konkretne propozycje dań, które przygotujesz od
razu." Keep the page responsive (stack/scale down for narrow viewports) following the
breakpoint pattern the file already used (`sm:`/`lg:` variants) rather than the fixed
1600px Figma canvas.

#### 2. Page wrapper background

**File**: `src/components/Welcome.astro`

**Intent**: Replace the outer `bg-cosmic` wrapper with the light surface background from
Figma.

**Contract**: Outer container uses `bg-brand-surface` (or `bg-white`, matching the
Figma frame's `#FFFFFF` page background) instead of `bg-cosmic`; drop the now-unused
cosmic orb/star-field decorative divs.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build` (confirms `astro:assets` image processing works)

#### Manual Verification:

- `/` (logged out) visually matches the Figma "Desktop - 1" frame: hero photo, gradient
  overlay, headline, body copy, and CTA all present and correctly styled
- "Get started" navigates to `/auth/signup`
- Page is usable (no overflow, readable text, tappable CTA) at mobile width (~375px),
  tablet (~768px), and desktop (~1440px+)
- Hero image loads reasonably fast (optimized, not the raw 2.2MB PNG — check Network tab)

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None planned — this change has no business logic, only presentational markup.

### Integration Tests:

- None planned (see "What We're NOT Doing" — E2E coverage was explicitly declined for
  this change).

### Manual Testing Steps:

1. Start the dev server (`npm run dev`), visit `/` in a logged-out session; compare
   side-by-side against the Figma "Desktop - 1" frame.
2. Sign in, visit `/` again; confirm immediate redirect to `/dashboard`.
3. Resize the browser through mobile/tablet/desktop widths; confirm no overflow or
   unreadable text.
4. Click "Sign in", "Create free account" (topbar), and "Get started" (hero); confirm
   each lands on the correct route.
5. Spot-check `/auth/signin`, `/auth/signup`, and `/dashboard` to confirm their
   appearance is unchanged.

## Performance Considerations

The hero photo is a 2.2MB PNG as downloaded from Figma — Phase 3 must route it through
`astro:assets`' `<Image>` (or equivalent build-time optimization) rather than serving it
as a static `public/` asset directly, or the hero will ship a multi-megabyte image to
every visitor.

## Migration Notes

Not applicable — no data model or persisted state changes.

## References

- Figma file: "Zero waste" (`HijlsMP1h4eCPUbUIjBoPI`), frame "Desktop - 1" (node `#1:2`)
- Downloaded hero photo: `public/images/home-hero.png` (source Figma node `1:193`)
- Existing icon pattern: `src/components/Welcome.astro` (inline SVG feature-card icons,
  pre-rewrite)
- Existing token pattern: `src/styles/global.css` `@theme inline` block

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles.

### Phase 1: Foundation (fonts, brand tokens, redirect, title)

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — ce79d2f
- [x] 1.2 Linting passes: `npm run lint` — ce79d2f

#### Manual

- [x] 1.3 Fonts applied and loaded on `/` (logged out) — ce79d2f
- [x] 1.4 Logged-in visit to `/` redirects to `/dashboard` — ce79d2f
- [x] 1.5 Browser tab title updated — ce79d2f
- [x] 1.6 No visual regression on `/auth/signin`, `/auth/signup`, `/dashboard` — ce79d2f

### Phase 2: Topbar redesign

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 3b601e7
- [x] 2.2 Linting passes: `npm run lint` — 3b601e7

#### Manual

- [x] 2.3 Topbar matches Figma (logo, wordmark, CTA buttons, colors, fonts) — 3b601e7
- [x] 2.4 "Sign in" and "Create free account" navigate correctly — 3b601e7
- [x] 2.5 Topbar doesn't overflow/wrap at mobile width — 3b601e7

### Phase 3: Hero section rewrite

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build succeeds: `npm run build`

#### Manual

- [x] 3.4 Hero visually matches Figma frame
- [x] 3.5 "Get started" navigates to `/auth/signup`
- [x] 3.6 Responsive at mobile/tablet/desktop widths
- [x] 3.7 Hero image is optimized, not served as raw 2.2MB PNG
