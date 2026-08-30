# Sign-up/Sign-in UX Update Implementation Plan

## Overview

Replace the dark "cosmic" glassmorphism theme on the three auth pages (`signup.astro`, `signin.astro`, `confirm-email.astro`) with the light, brand-toned card design from the Figma file, reusing the `brand-*`/`font-*` design tokens and raw-Tailwind pattern already established by the recent home-page redesign (`Welcome.astro`, `Topbar.astro`).

## Current State Analysis

All three auth pages share an identical, duplicated shell: a `bg-cosmic` dark gradient background, a `max-w-sm` glassmorphic card (`rounded-2xl border border-white/10 bg-white/10 ... backdrop-blur-xl`), and a gradient-text heading (`from-blue-200 to-purple-200`). `SignUpForm.tsx` and `SignInForm.tsx` submit as native `<form method="POST">` to `src/pages/api/auth/{signup,signin}.ts`, which read `FormData` directly — there is no zod schema on these routes. `FormField.tsx` renders a left icon (Mail/Lock) inside every input and is styled entirely for the dark theme (`bg-white/10`, `text-white`, `placeholder-white/40`). `SubmitButton.tsx` wraps the shadcn `Button` but hardcodes purple styling on top of it. `PasswordToggle.tsx` and `ServerError.tsx` are likewise styled for the dark theme.

Separately, `src/styles/global.css:112-123` already defines the brand tokens the Figma design uses — `--color-brand-green` (#35ba6d), `--color-brand-ink`, `--color-brand-muted`, `--color-brand-muted-2`, `--color-brand-surface`, `--color-brand-border`, plus `--font-display` (Playfair Display), `--font-body` (Inter), `--font-logo` (Montserrat) — added for the home-page redesign (PR #24) and already consumed by `Welcome.astro` and `Topbar.astro` via raw Tailwind (no shadcn `Card`/`Input`/`Label` primitives were introduced for that work).

## Desired End State

`signup.astro`, `signin.astro`, and `confirm-email.astro` render a plain white page with a logo-only header and a centered, bordered white card (`rounded-[20px]`, `border-brand-border`, no shadow) matching the Figma sign-up frame's visual language. Inputs have no left icons, use `h-11 rounded-lg` with the Figma input border color, and the primary button is brand-green. Sign-in and confirm-email carry contextually-adapted copy rather than a literal trace of the sign-up frame (Figma has no dedicated frame for either). Form submission behavior (`method="POST"`, `action`, `name="email"`/`name="password"`) is unchanged, so the existing API routes keep working without modification.

Verify by running each page in the browser and comparing against the Figma sign-up frame (node `1:195` in file `HijlsMP1h4eCPUbUIjBoPI`) for signup.astro, and confirming signin/confirm-email read as visually consistent siblings.

### Key Discoveries:

- Every color in the Figma file already exists as a token in `src/styles/global.css:112-123` — no new brand palette work needed, only a new input-border token (Figma's `#B9B6B6` doesn't match any existing token).
- `Topbar.astro:5-30` is the reference implementation for the logo mark (chef-hat SVG + tri-weight "ZeroWasteChef" wordmark) — reuse this markup, not the nav buttons.
- Figma's sign-up button (node `1:204`/`1:205`) and header buttons contain no icon, text only — so `SubmitButton`'s `icon` prop usage should be dropped from both forms for visual accuracy, not just the input icons.
- `tests/auth.setup.ts` drives `/api/auth/signin` directly via `request.post`, not the UI — there is no existing UI-level test coverage of these forms to preserve or break.
- `next-themes` is wired only into the shadcn `sonner` toast component; there is no app-wide dark-mode toggle, so `.dark` token variants are out of scope here (same as `Welcome.astro`/`Topbar.astro`).

## What We're NOT Doing

- Not introducing shadcn `Input`/`Label`/`Card`/`Form` primitives — following the raw-Tailwind + `brand-*` token precedent set by the home-page redesign.
- Not extracting a shared `AuthLayout.astro` — the shell markup stays inline per page, matching the existing (pre-redesign) structure.
- Not changing the API routes, Supabase auth calls, or adding zod validation.
- Not adding a "forgot password" flow — not present in the Figma design.
- Not adding automated UI test coverage (Playwright/unit) for the redesigned forms — this is a visual/structural restyle with no behavior change, and no existing UI test targets these forms today.
- Not designing distinct mobile-specific breakpoints — Figma provides only a desktop (1600px) frame; the card uses standard fluid/responsive Tailwind sizing.
- Not supporting `.dark` mode variants on these pages.

## Implementation Approach

Restyle the shared form primitives first (they're consumed by both `SignUpForm` and `SignInForm`), then rewrite each page + its form component, then reskin `confirm-email.astro` onto the same shell for visual consistency across the full auth flow. Each page's shell markup (logo header + card wrapper) is written inline per page rather than through a shared layout component, per the established `Welcome.astro`-style convention of composing pages directly.

## Phase 1: Shared form primitives

### Overview

Restyle the components common to both forms — `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError` — from the dark glassmorphic theme to the light brand theme, and drop the input icons per the Figma design.

### Changes Required:

#### 1. Global styles — new input border token

**File**: `src/styles/global.css`

**Intent**: Add a brand token for the input border color shown in Figma (`#B9B6B6`), which doesn't match any existing `brand-*` or shadcn token, following the same literal-hex convention as the other `--color-brand-*` entries at lines 112-117.

**Contract**: Add `--color-brand-input-border: #b9b6b6;` inside the `@theme inline` block (`src/styles/global.css:112-117`), alongside the other brand color tokens. This makes `border-brand-input-border` available as a Tailwind utility.

#### 2. Form field — drop icon, restyle to light theme

**File**: `src/components/auth/FormField.tsx`

**Intent**: Match the Figma input styling (no left icon, white background, `#B9B6B6`-bordered, `h-11`/`rounded-lg`) and drop the now-unused `icon` prop and its rendering, since Figma's inputs carry no icon.

**Contract**: Remove the `icon: ReactNode` prop from `FormFieldProps` and the icon `<span>` wrapper (lines 18, 32, 41). Change `inputBase` (line 5-6) to a light-theme equivalent: white background, `border-brand-input-border`, `h-11 rounded-lg px-3` (no `pl-10` now that there's no icon), `text-brand-ink`, `placeholder:text-brand-muted-2`, with an error-state border/ring variant using a red tone appropriate for a light background (the current error styling at line 53 is tuned for a dark background). Update the `<label>` classes (line 37) from `text-blue-100/80` to `text-brand-ink text-sm`, and the error message classes (line 59) from `text-red-300` to a light-theme-legible red.

#### 3. Password toggle — recolor for light theme

**File**: `src/components/auth/PasswordToggle.tsx`

**Intent**: Recolor the eye/eye-off toggle icon for visibility on a white input background.

**Contract**: Replace the `text-white/40 hover:text-white/70` classes (line 13) with a light-theme equivalent (e.g. `text-brand-muted-2 hover:text-brand-ink`). No structural change.

#### 4. Submit button — brand-green, drop icon

**File**: `src/components/auth/SubmitButton.tsx`

**Intent**: Match the Figma button styling (solid brand-green, `h-11`, no leading icon — Figma's "Sign up" button is text-only) and remove the now-unused `icon` prop.

**Contract**: Remove the `icon: ReactNode` prop from `SubmitButtonProps` and its rendering (lines 7, 26-29 — button content becomes just `{children}` in both the pending and idle branches). Replace the hardcoded `bg-purple-600 ... hover:bg-purple-500` (line 18) with `bg-brand-green hover:bg-brand-green/90`, and add `h-11 rounded-lg` to match the Topbar/Welcome button sizing. Update callers (`SignUpForm.tsx`, `SignInForm.tsx`, Phases 2-3) to stop passing `icon`.

#### 5. Server error — light-theme banner

**File**: `src/components/auth/ServerError.tsx`

**Intent**: Restyle the error banner to read clearly on a white card background.

**Contract**: Replace `border-red-500/30 bg-red-900/30 text-red-300` (line 11) with a light-theme error banner (e.g. `border-red-200 bg-red-50 text-red-700`). No structural change.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `FormField` renders with no left icon, white background, correct border color, and legible error state
- `PasswordToggle` icon is visible and toggles password visibility on a white input
- `SubmitButton` renders brand-green, full-width, with working pending/spinner state
- `ServerError` banner is legible on white background when an error is present

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Sign-up page

### Overview

Rewrite `signup.astro` and `SignUpForm.tsx` to use the restyled primitives inside the new Figma-matched shell.

### Changes Required:

#### 1. Sign-up page shell

**File**: `src/pages/auth/signup.astro`

**Intent**: Replace the dark cosmic shell with a plain white page, a logo-only header (no nav buttons, linking to `/`), and a bordered white card matching the Figma sign-up frame's heading, subheading, and footer link.

**Contract**: Replace the outer wrapper (`bg-cosmic flex min-h-screen items-center justify-center p-4`, line 9) with a `bg-white` page containing the logo header (reusing the chef-hat SVG + wordmark markup from `Topbar.astro:6-30`, without the nav-button block at lines 32-45) above a centered card. Card wrapper changes from `rounded-2xl border border-white/10 bg-white/10 ... backdrop-blur-xl` to `rounded-[20px] border border-brand-border bg-white` (no shadow, no blur). Heading changes from the gradient-text `<h1>` (lines 11-14) to `font-display text-brand-ink text-[32px]` reading "Create free account", with a `text-sm text-brand-muted` subheading matching the Figma copy ("Wpisz to, co masz pod ręką — nawet jeśli to tylko kilka przypadkowych składników."). Footer link (line 18) changes from `text-purple-300` to `text-brand-green font-medium`.

#### 2. Sign-up form

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Stop passing the now-removed `icon` props to `FormField` and `SubmitButton`; keep field structure, validation, and submission behavior unchanged.

**Contract**: Remove `icon={<Mail ... />}` / `icon={<Lock ... />}` from the three `FormField` calls (lines 78, 93, 116) and `icon={<UserPlus ... />}` from `SubmitButton` (line 129), along with the now-unused `Mail`, `Lock`, `UserPlus` imports (line 2). Update the password hint text color (line 59, `text-blue-100/50`) to a light-theme equivalent (`text-brand-muted`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `/auth/signup` visually matches the Figma sign-up frame: logo-only header, white page, bordered card, heading/subheading/button/footer copy and colors
- Submitting valid email/password/confirm-password redirects to `/auth/confirm-email`
- Client-side validation errors (invalid email, short password, mismatched confirmation) render legibly on the new light theme
- Server-side error (e.g. duplicate email) renders via the restyled `ServerError` banner
- Password and confirm-password visibility toggles work

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Sign-in page (adapted)

### Overview

Rewrite `signin.astro` and `SignInForm.tsx` onto the same shell and primitives, with copy adapted for a returning user rather than mirroring the sign-up frame verbatim (Figma has no dedicated sign-in frame).

### Changes Required:

#### 1. Sign-in page shell

**File**: `src/pages/auth/signin.astro`

**Intent**: Apply the same shell as sign-up (logo-only header, bordered white card) with copy appropriate to signing in: a "Welcome back" heading rather than the sign-up tagline, and a footer pointing to sign-up.

**Contract**: Same structural change as `signup.astro` Phase 2.1 — `bg-white` page, logo header from `Topbar.astro`, card `rounded-[20px] border border-brand-border bg-white`. Heading becomes `font-display text-brand-ink text-[32px]` reading "Welcome back"; subheading is a short contextual line (e.g. "Sign in to your Zero Waste Chef account") rather than the ingredients tagline, since that copy targets new users. Footer link (line 18) changes from `text-purple-300` to `text-brand-green font-medium`, text "Don't have an account? Sign up".

#### 2. Sign-in form

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Stop passing the now-removed `icon` props; keep field structure, validation, and submission behavior unchanged.

**Contract**: Remove `icon={<Mail ... />}` / `icon={<Lock ... />}` from the two `FormField` calls (lines 55, 69) and `icon={<LogIn ... />}` from `SubmitButton` (line 82), along with the now-unused `Mail`, `Lock`, `LogIn` imports (line 2).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `/auth/signin` reads as a visually consistent sibling of `/auth/signup` (same shell, colors, spacing) with sign-in-appropriate copy
- Submitting valid credentials redirects to `/dashboard`
- Client-side validation errors render legibly
- Server-side error (e.g. wrong password) renders via the restyled `ServerError` banner
- Password visibility toggle works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Confirm-email page

### Overview

Reskin `confirm-email.astro` onto the same shell/card treatment so the full auth flow reads as visually consistent, preserving its existing dev/prod branching logic.

### Changes Required:

#### 1. Confirm-email page shell

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Apply the same white-page/logo-header/bordered-card shell as signup/signin, restyling the existing emoji + heading + description + link for the light theme without changing the `isAutoConfirmed` branching logic.

**Contract**: Same shell change as Phase 2.1/3.1. Card content keeps its existing structure (emoji, heading, description, link) but heading changes from the gradient-text `<h1>` (line 27) to `font-display text-brand-ink text-[32px]`, description (line 30, `text-blue-100/80`) to `text-brand-muted`, and link (line 31, `text-purple-300`) to `text-brand-green font-medium`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `/auth/confirm-email` reads as a visually consistent sibling of the redesigned signup/signin pages
- Both dev-mode ("Registration successful") and prod-mode ("Check your email") copy variants render correctly restyled
- Link back to `/auth/signin` works

**Implementation Note**: After completing this phase and all automated verification passes, this is the final phase — confirm the full auth flow (signup → confirm-email → signin) reads as visually consistent end to end.

---

## Testing Strategy

### Unit Tests:

- None added — no existing unit tests target these components, and this is a visual/structural restyle with no logic change (per scope decision).

### Integration Tests:

- None added — `tests/auth.setup.ts` continues to exercise `/api/auth/signin` directly and is unaffected by these changes.

### Manual Testing Steps:

1. Run `npm run dev`, visit `/auth/signup`, compare against the Figma sign-up frame (node `1:195`).
2. Submit the sign-up form with invalid/valid data; confirm validation and error states render legibly.
3. Visit `/auth/signin`, confirm it reads as a consistent sibling with adapted copy; submit with valid/invalid credentials.
4. Visit `/auth/confirm-email` in both dev and prod mode (toggle `import.meta.env.DEV` behavior or check both content branches) and confirm consistent styling.
5. Click through the full flow: signup → confirm-email → signin, confirming footer/back links work.
6. Resize the browser to a narrow viewport and confirm the card remains usable (no Figma mobile frame exists, so this is a basic responsiveness check, not a pixel match).

## Performance Considerations

None — this is a CSS/markup-only change with no new dependencies, data fetching, or client-side logic changes.

## Migration Notes

Not applicable — no data model or schema changes.

## References

- Figma file: `HijlsMP1h4eCPUbUIjBoPI` ("Zero waste"), sign-up frame node `1:195`
- Precedent implementation: `src/components/Welcome.astro`, `src/components/Topbar.astro`
- Design tokens: `src/styles/global.css:112-123`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared form primitives

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 831c176
- [x] 1.2 Linting passes: `npm run lint` — 831c176

#### Manual

- [x] 1.3 FormField renders with no left icon, white background, correct border color, and legible error state — 831c176
- [x] 1.4 PasswordToggle icon is visible and toggles password visibility on a white input — 831c176
- [x] 1.5 SubmitButton renders brand-green, full-width, with working pending/spinner state — 831c176
- [x] 1.6 ServerError banner is legible on white background when an error is present — 831c176

### Phase 2: Sign-up page

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 3ee6f98
- [x] 2.2 Linting passes: `npm run lint` — 3ee6f98

#### Manual

- [x] 2.3 /auth/signup visually matches the Figma sign-up frame — 3ee6f98
- [x] 2.4 Submitting valid email/password/confirm-password redirects to /auth/confirm-email — 3ee6f98
- [x] 2.5 Client-side validation errors render legibly on the new light theme — 3ee6f98
- [x] 2.6 Server-side error renders via the restyled ServerError banner — 3ee6f98
- [x] 2.7 Password and confirm-password visibility toggles work — 3ee6f98

### Phase 3: Sign-in page (adapted)

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`

#### Manual

- [x] 3.3 /auth/signin reads as a visually consistent sibling of /auth/signup with sign-in-appropriate copy
- [x] 3.4 Submitting valid credentials redirects to /dashboard
- [x] 3.5 Client-side validation errors render legibly
- [x] 3.6 Server-side error renders via the restyled ServerError banner
- [x] 3.7 Password visibility toggle works

### Phase 4: Confirm-email page

#### Automated

- [ ] 4.1 Type checking passes: `npm run typecheck`
- [ ] 4.2 Linting passes: `npm run lint`

#### Manual

- [ ] 4.3 /auth/confirm-email reads as a visually consistent sibling of the redesigned signup/signin pages
- [ ] 4.4 Both dev-mode and prod-mode copy variants render correctly restyled
- [ ] 4.5 Link back to /auth/signin works
