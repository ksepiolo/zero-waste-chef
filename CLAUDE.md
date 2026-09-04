# CLAUDE.md

## Hard rules

- `src/lib/supabase.ts` — `createClient()` returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are missing; all callers must null-check. Uses `@supabase/ssr` with cookie-based sessions; env vars come from `astro:env/server` (declared in `astro.config.mjs` `env.schema`).
- API routes must export `const prerender = false`.
- Always enable RLS on new tables. Add separate policies for SELECT, INSERT, UPDATE, DELETE — one per role (authenticated, anon). No catch-all USING (true).

## Commands

@package.json

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

README.md — what the project is, how to run it, data model, routes, CI/CD. This file owns the conventions.

### Rendering mode

Full server-side rendering (`output: "server"` in `astro.config.mjs`). All pages are server-rendered by default.

### Auth flow

- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Tailwind class merging**: use `cn()` from `@/lib/utils` (clsx + tailwind-merge). Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`.
- **React**: Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.
- File naming must use kebab-case with dot-separated type suffixes. Always name files as feature.handler.ts, feature.service.ts, feature.controller.ts — never featureHandler.ts or featureService.ts.

### Environment

- For node.js version see @.nvmrc
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` — copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev (gitignored)

## Mutation testing

Repo uses Stryker for selective mutation testing on risk-critical modules.
Run it only for code covered by the current change or a risk from test-plan.md,
prefer narrowed scope with --mutate "path/to/file.ts:start-end", and do not chase
100% mutation score. Survived mutants should be reviewed one by one: add an
assertion only when the mutant represents a user-visible or business-relevant bug.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
