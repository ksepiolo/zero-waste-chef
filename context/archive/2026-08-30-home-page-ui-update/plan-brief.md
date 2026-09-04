# Home Page UI Update — Plan Brief

> Full plan: `context/changes/home-page-ui-update/plan.md`

## What & Why

Replace the current placeholder home page — a generic purple "10x Astro Starter" cosmic
theme left over from scaffolding — with the Zero Waste Chef–branded landing page approved
in Figma ("Zero waste" file, frame "Desktop - 1"): a chef-hat-branded topbar and a hero
card pitching "Przepisy dopasowane do twojej lodówki" (recipes matched to your fridge).

## Starting Point

`src/pages/index.astro` renders `Welcome.astro` unconditionally for every visitor
(logged in or not — `/` isn't a protected route). `Welcome.astro` and `Topbar.astro` both
carry the starter's cosmic-purple theme and unrelated copy. No brand colors or custom
fonts exist anywhere in the codebase yet; `global.css` only has a grayscale shadcn/ui
token set.

## Desired End State

A logged-out visitor to `/` sees the Figma-matching page: topbar with logo + "Sign in" /
"Create free account", and a rounded hero card (fridge photo background, gradient
overlay, headline, body copy, green "Get started" CTA → sign-up). A logged-in visitor
hitting `/` is redirected straight to `/dashboard` instead.

## Key Decisions Made

| Decision                    | Choice                                                                  | Why (1 sentence)                                                                        | Source |
| --------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| Font loading                | Google Fonts `<link>` in `Layout.astro` head                            | Simplest, zero new deps, standard Astro pattern                                         | Plan   |
| Brand color scope           | New isolated `--color-brand-*` tokens, `--primary` untouched            | Reusable later without risking signin/signup/dashboard styling today                    | Plan   |
| Hero image                  | Downloaded real photo from Figma (`public/images/home-hero.png`)        | Pixel-accurate to the approved design                                                   | Plan   |
| Logged-in user on `/`       | Redirect to `/dashboard`                                                | Keeps the hero page a pure, exact match to the Figma frame — no invented state          | Plan   |
| Responsive behavior         | Adapt with existing `sm:`/`lg:` breakpoint pattern                      | Figma is a fixed 1600px desktop canvas; app must still work on mobile                   | Plan   |
| CTA destinations            | Sign in → `/auth/signin`; Get started / Create account → `/auth/signup` | Direct 1:1 mapping to existing auth routes                                              | Plan   |
| Page `<title>`              | Updated to Zero Waste Chef branding; favicon left as-is                 | Closes the most visible tab-branding gap cheaply; no favicon asset in this Figma export | Plan   |
| Automated test coverage     | Manual verification only (no new E2E test)                              | Explicit scope decision — no business logic here, just presentation                     | Plan   |
| Topbar authenticated branch | Removed entirely                                                        | Redirect makes it dead code — Figma has no logged-in state for this frame               | Plan   |

## Scope

**In scope:**

- `src/pages/index.astro`, `src/components/Welcome.astro`, `src/components/Topbar.astro`
- `src/layouts/Layout.astro` (font `<link>` tags), `src/styles/global.css` (brand tokens)
- Redirecting authenticated visitors away from `/`

**Out of scope:**

- The other 3 Figma frames (sign-up form, pantry/recipe-settings, recipe history) — each
  maps to a different existing page and is a separate future change
- Repainting shadcn's global `--primary` token or the shared `Button` component
- Favicon replacement
- New E2E tests

## Architecture / Approach

Three independently-shippable phases: (1) foundation plumbing — fonts, brand tokens, the
auth redirect, page title; (2) topbar rebuild; (3) hero content rebuild using the
foundation's tokens and the downloaded photo (routed through `astro:assets` for
optimization, since the raw export is a 2.2MB PNG).

## Phases at a Glance

| Phase                   | What it delivers                                             | Key risk                                               |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| 1. Foundation           | Fonts, brand tokens, `/` → `/dashboard` redirect, page title | Global font loading adds a small cost to every page    |
| 2. Topbar redesign      | Brand-matching logo + CTA topbar, anonymous-only             | Icon has no existing static-SVG source in the codebase |
| 3. Hero section rewrite | Full hero card matching Figma, responsive, optimized image   | 2.2MB source image must be optimized, not served raw   |

**Prerequisites:** None — no new dependencies, no data/schema changes.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Font loading is added globally in `Layout.astro` (every page pays the cost), matching
  the same "global, isolated" treatment already chosen for brand colors — flagged as a
  deliberate tradeoff, not an oversight.
- Mobile/tablet layout is this plan's own extrapolation from the fixed-width Figma
  desktop canvas — there's no mobile frame to verify against.

## Success Criteria (Summary)

- Logged-out `/` visually matches the Figma "Desktop - 1" frame (fonts, colors, copy,
  image, CTA behavior) and works responsively.
- Logged-in visitors are redirected to `/dashboard` instead of seeing the marketing page.
- `npm run typecheck`, `npm run lint`, and `npm run build` all pass; no other page's
  appearance regresses.
