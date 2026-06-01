# CLAUDE.md

## Hard rules
- `src/lib/supabase.ts` — `createClient()` returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are missing; all callers must null-check. Uses `@supabase/ssr` with cookie-based sessions; env vars come from `astro:env/server` (declared in `astro.config.mjs` `env.schema`).
- API routes must export `const prerender = false`.
- Always enable RLS on new tables. Add separate policies for SELECT, INSERT, UPDATE, DELETE — one per role (authenticated, anon). No catch-all USING (true).

## Commands

@package.json

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

README.md — canonical architecture and conventions reference.

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

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
