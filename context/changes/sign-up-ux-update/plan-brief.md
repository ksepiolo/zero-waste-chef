# Sign-up/Sign-in UX Update — Plan Brief

> Full plan: `context/changes/sign-up-ux-update/plan.md`

## What & Why

Restyle `signup.astro`, `signin.astro`, and `confirm-email.astro` from the current dark "cosmic" glassmorphism theme to the light, brand-toned card design shown in the Figma file (`HijlsMP1h4eCPUbUIjBoPI`), bringing the auth flow visually in line with the home page's recent redesign.

## Starting Point

All three auth pages share a duplicated dark shell (`bg-cosmic` background, glassmorphic `bg-white/10` card, gradient-text heading) and a custom `FormField` component styled entirely for that dark theme, with left icons in every input. The brand tokens the Figma design needs (`brand-green`, `brand-ink`, `font-display`, etc.) already exist in `src/styles/global.css`, added for the home-page redesign and already used by `Welcome.astro`/`Topbar.astro`.

## Desired End State

A visitor sees a plain white page with a logo-only header and a centered, bordered white card for sign-up, sign-in, and the email-confirmation step — consistent in color, type, and spacing with the rest of the redesigned marketing surface. Form submission mechanics (POST to the existing API routes) are unchanged.

## Key Decisions Made

| Decision                  | Choice                                                              | Why (1 sentence)                                                                              | Source          |
| ------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| confirm-email.astro scope | Restyle it too                                                      | Leaving it dark would create a jarring page in the middle of an otherwise light-themed flow   | Plan (asked)    |
| Shell architecture        | Inline markup per page, no `AuthLayout.astro`                       | Matches the existing per-page composition pattern; minimal file churn                         | Plan (asked)    |
| Input icons               | Drop left Mail/Lock icons                                           | Figma inputs show no icon — pixel-accurate match                                              | Plan (asked)    |
| Header                    | Logo-only, no nav buttons                                           | Figma auth screens omit nav buttons; showing "Sign in" while on the sign-in page is redundant | Plan (asked)    |
| Sign-in copy              | Adapted contextually ("Welcome back") rather than mirroring sign-up | No Figma frame exists for sign-in; the sign-up tagline targets new users                      | Plan (asked)    |
| Page background           | Plain white                                                         | Matches Figma exactly and the home page's outer background                                    | Plan (asked)    |
| Card style                | Border only, no shadow                                              | Matches Figma and existing card treatment elsewhere in the app                                | Plan (asked)    |
| Testing                   | Manual verification only                                            | No existing UI-level test coverage of these forms; purely visual/structural change            | Plan (asked)    |
| Component library         | Raw Tailwind + `brand-*` tokens, no shadcn Input/Label/Card         | Follows the precedent set by the home-page redesign                                           | Plan (research) |
| Button icons              | Also dropped (not just input icons)                                 | Figma's buttons are text-only                                                                 | Plan (research) |

## Scope

**In scope:**

- `signup.astro`, `signin.astro`, `confirm-email.astro` full visual restyle
- `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError` restyled to light theme
- One new design token (`--color-brand-input-border`) for the Figma input border color

**Out of scope:**

- shadcn `Input`/`Label`/`Card`/`Form` primitives
- Shared `AuthLayout.astro`
- API routes, Supabase auth logic, zod validation
- "Forgot password" flow
- New automated UI test coverage
- Mobile-specific Figma-driven breakpoints
- Dark-mode (`.dark`) support on these pages

## Architecture / Approach

Restyle the shared form primitives first (Phase 1), since both forms depend on them, then rewrite each page top-down (Phases 2-4): sign-up first (the only page with a direct Figma frame), sign-in adapted from it, then confirm-email reskinned for consistency. All shell markup is written inline per page, matching the codebase's existing composition style.

## Phases at a Glance

| Phase                 | What it delivers                                                                    | Key risk                                                             |
| --------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Shared primitives  | Light-themed `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError`, no icons | Error-state contrast on white background needs checking manually     |
| 2. Sign-up page       | `/auth/signup` matching the Figma frame                                             | None significant — direct Figma reference                            |
| 3. Sign-in page       | `/auth/signin` as a consistent, adapted sibling                                     | Invented copy ("Welcome back") has no Figma source to verify against |
| 4. Confirm-email page | `/auth/confirm-email` reskinned to match                                            | None significant — smallest surface area                             |

**Prerequisites:** None — no new dependencies or infra.
**Estimated effort:** ~1 session across 4 phases; mostly Tailwind class changes plus a handful of small prop removals.

## Open Risks & Assumptions

- Sign-in and confirm-email copy is authored, not traced from Figma (no frame exists for either) — worth a quick gut-check against the rendered page before calling it done.
- The new `--color-brand-input-border` (#b9b6b6) is a one-off token derived from Figma; if a future design pass introduces a broader "input" token system, this may need reconciling.

## Success Criteria (Summary)

- All three auth pages visually read as light, brand-consistent siblings of the redesigned home page
- Sign-up matches the Figma frame; sign-in and confirm-email read as coherent adaptations
- All existing form behavior (validation, submission, error display, password toggle) works unchanged
