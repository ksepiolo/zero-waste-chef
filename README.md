# Zero Waste Chef

Track what's in your fridge, see what's about to expire, and turn it into a recipe
before it goes in the bin.

The product closes a two-step gap: users know food is being wasted but can't see
_which_ items are at risk, and even when they can, they have no fast path from
"this needs using up" to "here's what to cook." Zero Waste Chef tracks products
with expiry dates, flags anything expiring within 3 days, and generates AI recipes
that prioritise those items. Approving a recipe removes the consumed products from
the inventory in one transaction.

**Who it's for:** a single adult running their own fridge and pantry — living alone
or the designated household cook. They shop regularly but inconsistently, so fridge
contents drift and expiry dates get unpredictable. They feel the cost of the waste
but have no low-friction way to act on it before it's too late. They reach for this
when they open the fridge and think "what needs using up today?"

Built as a solo MVP on the [10x Astro Starter](https://github.com/przeprogramowani/10x-astro-starter).
UI copy is Polish; code, docs and commits are English.

---

## The core loop

1. **Inventory** (`/inventory`) — add a product (name + expiry date), see the list
   sorted by expiry with at-risk and expired items called out, delete manually.
2. **Generate** (`POST /api/recipes/generate`) — the user asks for a recipe,
   optionally constrained by technique / method / time. The server sends the
   inventory (at-risk first, expired excluded) to the LLM and returns a recipe
   proposal. Nothing is persisted yet.
3. **Approve** (`POST /api/recipes/approve`) — the approval screen is a contract:
   what it shows is what gets deleted. Approval saves the recipe and removes the
   used products atomically.
4. **History** (`/recipes`) — the list of approved recipes with the products each
   one consumed.

Two invariants the whole design defends:

- **Data isolation** — a user never sees another user's products or recipes.
  Enforced in the database via RLS, not in application code.
- **Inventory consistency** — approval never deletes more than the screen showed;
  a product that changed underneath the approval is reported back, not silently
  swallowed.

## Tech stack

| Layer     | Choice                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| Framework | [Astro](https://astro.build/) 6, SSR (`output: "server"`)                       |
| UI        | React 19 islands + [Tailwind](https://tailwindcss.com/) 4 + shadcn/ui           |
| Language  | TypeScript 5, [zod](https://zod.dev/) 4 for input validation                    |
| Backend   | [Supabase](https://supabase.com/) — Postgres + Auth (`@supabase/ssr`)           |
| AI        | [OpenRouter](https://openrouter.ai/) → `google/gemini-2.5-flash-lite`           |
| Runtime   | [Cloudflare Workers](https://workers.cloudflare.com/) via `@astrojs/cloudflare` |
| Tests     | Vitest (unit + integration), Playwright (e2e), Stryker (mutation)               |

Rationale and the platform comparison that produced it: `context/foundation/tech-stack.md`
and `context/foundation/infrastructure.md`.

## Local development

**Prerequisites:** Node.js per [`.nvmrc`](.nvmrc), npm, and Docker (~7 GB RAM) for
the local Supabase stack.

```bash
npm install
cp .env.example .env          # Node dev server
cp .dev.vars.example .dev.vars # Cloudflare workerd local dev
npx supabase start            # first run downloads images
npx supabase db reset         # applies migrations + seeds a test user
npm run dev
```

`npx supabase start` prints the local credentials — paste them into both `.env`
and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

Local Studio runs at `http://localhost:54323`. The seeded account is
`test@example.com` / `Test1234!`, pre-confirmed so no email round-trip is needed.
`supabase/seed.sql` refuses to run against anything but the local stack — it
checks for the fixed local JWT secret, because this repo is linked to a hosted
project and `db reset --linked` would otherwise plant the account in production.

Recipe generation needs `OPENROUTER_API_KEY` (see `.dev.vars.example`). Without
it the app still runs; generation returns an error. Without Supabase vars the app
runs with auth disabled and shows a config banner.

### Environment variables

| Variable             | Required | Notes                                                                         |
| -------------------- | -------- | ----------------------------------------------------------------------------- |
| `SUPABASE_URL`       | yes      | Project URL (local CLI output, or dashboard → Settings → API)                 |
| `SUPABASE_KEY`       | yes      | `anon` public key                                                             |
| `OPENROUTER_API_KEY` | yes\*    | \*Only for recipe generation                                                  |
| `OPENROUTER_URL`     | no       | Defaults to the real endpoint; overridden in `.env.e2e` to hit the local stub |

All four are declared server-only in `astro.config.mjs` and are never exposed to
the client.

### Using a hosted Supabase project

Point `SUPABASE_URL` / `SUPABASE_KEY` at the hosted project instead. Note that
Supabase requires email confirmation before sign-in by default — turn it off under
**Authentication → Email → Confirm email** if you want to skip the round-trip in
a dev project.

## Data model

Two tables, both owned by `auth.users(id)` with `ON DELETE CASCADE`, both with RLS
enabled: authenticated users get own-row access, `anon` is explicitly denied on
every operation.

- **`products`** — `name`, `expiry_date`, indexed on `(user_id, expiry_date ASC)`.
  That index serves both the default list ordering and the at-risk filter
  (`expiry_date <= CURRENT_DATE + INTERVAL '3 days'`). At-risk / expired are
  computed, not stored.
- **`recipes`** — `title`, `instructions`, and `consumed_products` (JSONB snapshot
  of `{name, expiry_date}` entries), indexed on `(user_id, created_at DESC)`.

Approval runs through the `public.approve_recipe(...)` Postgres function
(`SECURITY INVOKER`, so RLS still applies) — it inserts the recipe and deletes the
used products in one transaction, and reports back which ids it actually deleted so
the caller can detect a product that disappeared underneath the approval screen.

Migrations live in `supabase/migrations/`.

## Routes

| Route                         | Auth | Purpose                                                 |
| ----------------------------- | ---- | ------------------------------------------------------- |
| `/`                           | —    | Landing page; redirects signed-in users to `/inventory` |
| `/auth/signin` `/auth/signup` | —    | Email/password forms                                    |
| `/auth/confirm-email`         | —    | Post-signup "check your inbox"                          |
| `/inventory`                  | ✔    | Product list + add/delete + generate entry point        |
| `/recipes`                    | ✔    | Approved recipe history                                 |
| `/dashboard`                  | ✔    | Legacy route, redirects to `/inventory`                 |

| API                                      | Purpose                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| `GET/POST /api/products`                 | List / create products                                |
| `PATCH/DELETE /api/products/:id`         | Update / delete one product                           |
| `POST /api/recipes/generate`             | Generate a recipe proposal (no writes)                |
| `POST /api/recipes/approve`              | Persist recipe + delete used products (transactional) |
| `GET /api/recipes`                       | Paged recipe history                                  |
| `POST /api/auth/{signin,signup,signout}` | Session management                                    |

Protected pages are listed in `PROTECTED_ROUTES` in `src/middleware.ts`; anything
matching redirects to `/auth/signin` when signed out.

## Recipe generation

`src/lib/services/recipe.service.ts` owns the LLM call. Notable constraints, all
learned the hard way and documented in-file:

- Model is pinned to `google/gemini-2.5-flash-lite` — the cheapest OpenRouter model
  with confirmed structured-output support. Swapping it without verifying structured
  output reintroduces `unusable_model_response` failures.
- 30 s generation timeout, at most 25 products in the prompt (at-risk first).
- Expired products are excluded from the prompt and reported separately to the UI,
  so the user sees why an item was skipped.
- Only a `ServiceError` — built from a fixed table of statuses and vetted copy — can
  set an HTTP status and reach a user-facing toast. Anything else becomes a logged
  500 with a generic message; model prose is never shown to the user.

## Testing

| Command             | Scope                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run test:unit` | Vitest, integration tests excluded — no external deps, runs in CI            |
| `npm test`          | Everything, including `*.integration.test.ts` (needs local Supabase running) |
| `npm run test:e2e`  | Playwright across chromium/firefox/webkit via `scripts/test-e2e.sh`          |

`scripts/test-e2e.sh` exists because the e2e flow needs orchestration Playwright's
config can't express: it starts local Supabase, frees port 4321, boots
`npm run dev:e2e` (which loads `.env.e2e` and disables the Astro dev toolbar, whose
fixed overlay intercepts automated clicks), and runs the browser projects
**sequentially** — `tests/generate-approve.spec.ts` binds a fixed stub OpenRouter
port (4399) resolved once at server startup, so parallel projects would collide.

Playwright signs in once (`tests/auth.setup.ts`) and reuses the storage state.
Mutation testing is Stryker, run selectively; `docs/mutation/` holds the reports.

The strategy behind all of this — risk register, what each layer is allowed to
cover, and what deliberately isn't tested — is `context/foundation/test-plan.md`.

## CI/CD

- **`ci.yml`** — on push/PR to `main`: lint → typecheck → unit tests → build for the
  app, plus a parallel job for `packages/code-reviewer` (its own lockfile and configs;
  its test step is non-blocking by decision). On push to `main`, a `deploy` job ships
  to Cloudflare Workers via `wrangler-action`.
- **`ai-code-review.yml`** — AI review on PRs, backed by `packages/code-reviewer`.
- **`playwright.yml`** — **disabled** (2026-09-03). It only ran post-deploy against
  production, so it gated nothing, and the stub-OpenRouter spec can't work there.
  The header comment in the file spells out the two-job shape needed before
  re-enabling. Until then e2e is a local command and no PR is gated by it.

Production runs at `https://zero-waste-chef.ksepiolo.workers.dev`.

Required GitHub secrets: `SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`.

### Manual deploy

```bash
npm run build
npx wrangler deploy
```

Worker config is `wrangler.jsonc` (`nodejs_compat`, static assets from `dist/`,
observability on). Set runtime secrets with `npx wrangler secret put SUPABASE_URL`
(and likewise for `SUPABASE_KEY`, `OPENROUTER_API_KEY`) — the Workers dashboard
stores them write-only.

## Repository layout

```
src/            Astro app — see CLAUDE.md for the conventions that govern it
supabase/       config, migrations, local-only seed
tests/          Playwright specs; playwright.config.ts at the root
scripts/        test-e2e.sh — the local e2e orchestration described above
packages/
  code-reviewer/  standalone npm project (own lockfile); powers the AI review workflow
context/
  foundation/   prd.md, roadmap.md, tech-stack.md, infrastructure.md,
                test-plan.md, lessons.md — the durable "why" of the project
  changes/      in-flight work, one folder per change
  archive/      completed changes, kept for their decision records
  deployment/   deploy plan and follow-up issues
docs/mutation/  Stryker reports
```

`CLAUDE.md` holds the working agreements for this codebase — hard rules, naming
conventions, and where new code goes. It is the reference for _how to write_ code
here; this file is the reference for _what the project is and how to run it_.
When a decision needs its reasoning, look for the change folder under
`context/archive/`.

## License

MIT
