# Cloudflare Integration & Deployment Plan — zero-waste-chef

## Context

This is the **Plan Mode deploy** step of the 10xDevs Module 1 / Lesson 5 infra chain. The platform decision is already made in `context/foundation/infrastructure.md`: **Cloudflare**. This plan covers the first production deployment and the integration glue around it (Supabase auth, CI/CD).

**Key correction surfaced during research:** `infrastructure.md` was written against the **Cloudflare Pages** model (`wrangler pages deploy`, `wrangler pages project create`). That is outdated. The project uses `@astrojs/cloudflare` **v13.5.0** on **Astro 6**, and [v13 removed Pages support entirely](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) — the adapter now deploys to **Cloudflare Workers (Static Assets)** via `wrangler deploy`. The existing `wrangler.jsonc` already matches the Workers model exactly (`main: "@astrojs/cloudflare/entrypoints/server"` + `assets` binding). So we deploy as **Workers**, and we correct the doc.

**Codebase readiness (verified):**
- `wrangler.jsonc` already has `compatibility_flags: ["nodejs_compat"]`, `compatibility_date: 2026-05-08`, the correct `main` entrypoint, the `ASSETS` binding, and `observability.enabled: true`. No changes needed to deploy.
- Zero Node built-in imports, zero `Astro.locals.runtime` usage, zero `process.env` — the code is workerd-safe. Supabase uses `@supabase/ssr` reading env via `astro:env/server` (`src/lib/supabase.ts`).
- **No OpenRouter/AI code exists yet** — only auth + Supabase. The doc's high-risk "10ms CPU on AI recipe generation" does not yet apply; Supabase calls are network I/O, not CPU. → Deploy on **Free tier** now; revisit Paid before the AI endpoint ships.

**Decisions locked with the user:** deploy as Workers; correct `infrastructure.md`; Free tier; manual first deploy **plus** GitHub Actions auto-deploy on push; reuse the existing Supabase project.

> **Branch note:** user said "push to master," but this repo's production branch is `main` (current HEAD; the existing CI's `master` trigger never fires here). Plan wires auto-deploy to `main` and fixes the stale trigger. Flag if `master` is actually intended.

## Deployment target

- **Worker name:** `zero-waste-chef` (from `wrangler.jsonc`)
- **URL:** `https://zero-waste-chef.<account-subdomain>.workers.dev` (custom domain out of scope for MVP)
- **Deploy command:** `npx wrangler deploy` — **NOT** `wrangler pages deploy`
- **Runtime secrets:** `SUPABASE_URL`, `SUPABASE_KEY` set via `wrangler secret put` (persist across deploys; runtime-only, not needed at build because they're `optional` in `astro:env`)

---

## Prerequisites — toolchain, Wrangler CLI auth & Supabase credentials

Complete these before Phase 0. They are one-time-per-machine setup, not part of the repeatable deploy loop.

### P.1 Local toolchain
- [ ] Node `22.14.0` active — `nvm use` (version pinned in `.nvmrc`)
- [ ] `npm ci` — installs `wrangler@^4.90.0` (and the Supabase CLI) as local devDeps. Invoke everything via `npx wrangler …` / `npx supabase …`; **no global install required**.

### P.2 Wrangler CLI authentication (Cloudflare)
- [ ] **Have a Cloudflare account.** If you don't, sign up free at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) (email + password, verify the email — **no credit card** required for the Free plan). The **Free** Workers plan is what this deploy targets; 100k requests/day, commercial use allowed.
- [ ] **Note your Account ID** — Cloudflare dashboard → **Workers & Pages** (or any zone's Overview); the Account ID is shown in the right sidebar / URL. You'll need it for `CLOUDFLARE_ACCOUNT_ID` in Phase 5's CI deploy and to disambiguate if you belong to multiple accounts.
- [ ] `npx wrangler login` — opens a browser for OAuth; credentials are stored in `~/.config/.wrangler/` (per-machine, never in the repo)
- [ ] `npx wrangler whoami` — confirm the logged-in email **and** the account you'll deploy into; note the **Account ID** if you belong to more than one account
- [ ] **CI / headless alternative:** instead of interactive login, export `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID` if multi-account). This is exactly what Phase 5's GitHub Action consumes — create the **scoped** token described in Phase 1.

**Edge-case support:**
- *Multiple Cloudflare accounts* → wrangler prompts you to pick; set `CLOUDFLARE_ACCOUNT_ID` in your shell to remove the ambiguity for scripted runs.
- *Corporate proxy / no browser available* → skip OAuth and use the `CLOUDFLARE_API_TOKEN` token flow.
- *"Not logged in" in a fresh shell* → re-run `wrangler login`; auth does not travel with the repo.

### P.3 Supabase credentials (reusing the existing project)
- [ ] In the Supabase dashboard → **Project Settings → API**, copy:
  - **Project URL** → use as `SUPABASE_URL`
  - **anon / public** key (the **publishable** key in Supabase's newer key UI) → use as `SUPABASE_KEY`
- [ ] **Confirm you are using the anon/publishable key, NOT the `service_role` / secret key.** `@supabase/ssr` cookie sessions require the public key; the `service_role` key bypasses RLS and must never reach the edge/client.
- [ ] Dashboard → **Authentication → Providers → Email** is enabled; decide whether email confirmation is required (this drives the Phase 3/Phase 4 confirmation steps).
- [ ] (If using the Supabase CLI for migrations later) `npx supabase login` with a personal access token, then `npx supabase link --project-ref <ref>` — not needed for this deploy, listed for completeness.

### P.4 Local env files (verify — they already exist)
- [ ] `.dev.vars` (gitignored) — read by `wrangler dev` and Astro 6's `astro dev`/`preview` on **workerd**. Holds `SUPABASE_URL` + `SUPABASE_KEY` for local runs.
- [ ] `.env` (gitignored) — dotenv fallback for Node-based tooling.
- [ ] `.env.example` (checked in) — placeholders only; never commit real keys.

> **Local vs production secrets:** `.dev.vars` values are for **local** dev only. **Production** reads Worker secrets set via `wrangler secret put` in Phase 2 — stored separately on Cloudflare, never sourced from `.dev.vars`. Setting one does not set the other.

---

## Phase 0 — Pre-flight (read-only, local)

- [ ] `npm run lint` — clean
- [ ] `npm run build` — produces `dist/` with no errors
- [ ] `npm run preview` (Astro 6 runs this on **workerd**, a true prod replica) — smoke-test the site loads locally
- [ ] Re-confirm `wrangler.jsonc` still has `nodejs_compat` and the `main` entrypoint (guard against accidental edits)

## Phase 1 — Manual gates (human-only)

- [ ] **User runs** `! npx wrangler login` (browser OAuth; creds land in `~/.config/.wrangler/`)
- [ ] Confirm the Cloudflare account is on the **Free** plan (no billing change)
- [ ] **For CI/CD (Phase 5):** create a **scoped** Cloudflare API token — `Account › Workers Scripts › Edit` for this account only, **no DNS, no billing, no unrelated Workers Secrets** (per CLAUDE.md production-access boundary). Capture the **Account ID** too.
- [ ] Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to **GitHub repo secrets** (Settings → Secrets and variables → Actions). Tokens live in CI secrets, never in the repo.

## Phase 2 — First manual deploy + secrets

- [ ] `npm run build`
- [ ] `npx wrangler deploy` → creates the `zero-waste-chef` Worker, prints the `*.workers.dev` URL. **Record the URL** — Phase 3 needs it.
- [ ] `npx wrangler secret put SUPABASE_URL` (paste value from local `.dev.vars`)
- [ ] `npx wrangler secret put SUPABASE_KEY` (paste value from local `.dev.vars`)
- [ ] `npx wrangler secret list` → confirm both names present (values are write-only / not readable back — per doc's "write-only secrets" note)
- [ ] No redeploy required — secrets apply to the running Worker immediately.

**Edge-case support:**
- If `wrangler secret put` is run *before* the first `deploy`, wrangler prompts to create the Worker — that's why we **deploy first**.
- If the deploy errors with a `workers.dev` subdomain message, enable the subdomain once in the dashboard (Workers & Pages → your subdomain).
- Do **not** add named `[env.production]` blocks to `wrangler.jsonc` — known adapter bugs ([#14540](https://github.com/withastro/astro/issues/14540), [#16031](https://github.com/withastro/astro/issues/16031)) break `astro:env`/wrangler env-var resolution under named environments. Keep a single environment.

## Phase 3 — Supabase external-integration config (manual, dashboard)

The deployed URL must be registered with Supabase or **email confirmation links will redirect to `localhost`** and break signup.

- [ ] Supabase dashboard → **Authentication → URL Configuration → Site URL** = `https://zero-waste-chef.<account>.workers.dev`
- [ ] Add the same URL (and `…/auth/signin`) to the **Redirect URLs** allow-list
- [ ] If email confirmation is enabled, confirm the email link now redirects to production, not localhost
- [ ] (Optional, recommended) Verify the key in use is the **anon/publishable** key (it's safe in `@supabase/ssr` cookie sessions), not the service-role key

**Edge-case support:** the current `src/pages/auth/confirm-email.astro` is static and shows "check your email" in production (the `import.meta.env.DEV` auto-confirm branch is dev-only). There is **no** server `/auth/callback` route — that's fine for Supabase's default hosted-link verification flow, which only needs the Site URL configured above. If a PKCE/code-exchange flow is added later, a callback route becomes necessary.

## Phase 4 — Verification (golden path + edge cases)

Run `npx wrangler tail zero-waste-chef --format json` in one terminal while exercising the app:

- [ ] Deployed URL loads (home page renders)
- [ ] **Sign up** a throwaway user → lands on `/auth/confirm-email` ("check your email")
- [ ] Click the email confirmation link → redirected back to the **production** site (validates Phase 3)
- [ ] **Sign in** with the confirmed user → redirected to `/`
- [ ] Visit `/dashboard` **while signed out** → redirected to `/auth/signin` (middleware `PROTECTED_ROUTES`)
- [ ] **Sign out** → redirected to `/`
- [ ] In `wrangler tail`: no errors, **no "CPU time exceeded"**, and the "Supabase is not configured" path never fires (confirms secrets are wired)
- [ ] Note **rollback** for the record: `npx wrangler rollback` (or `wrangler versions list` + `wrangler versions deploy`) reverts instantly; DB migrations do **not** auto-roll-back.

## Phase 5 — CI/CD auto-deploy on push to `main`

Edit `.github/workflows/ci.yml`:

- [ ] Fix the trigger: `master` → `main` (push + PR)
- [ ] Add a **deploy job** that runs **only on push to `main`** (not on PRs), depends on the existing build/lint job, using [`cloudflare/wrangler-action@v3`](https://github.com/cloudflare/wrangler-action) with `command: deploy`, authenticated by `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` from GitHub secrets.
- [ ] Keep the existing build env (`SUPABASE_URL`/`SUPABASE_KEY` from GitHub secrets) for the build step; the **deploy** step needs only the Cloudflare token (runtime Supabase secrets already live on the Worker from Phase 2 and persist across deploys).
- [ ] Push a trivial change to `main` → confirm the Action deploys and the new version is live
- [ ] Confirm secrets persisted (app still authenticates — no re-`secret put` needed)

**Edge-case support:** guard the deploy step so PR builds from forks can't deploy (`if: github.event_name == 'push' && github.ref == 'refs/heads/main'`). This also avoids the doc's "two deploy paths conflict" risk — CLI manual deploy and CI both call `wrangler deploy` against the same Worker (no Pages git-CI in play), so they're consistent, but we keep `main` as the single source of truth.

## Phase 6 — Doc & artifact updates

- [ ] **`context/foundation/infrastructure.md`** — correct the Pages→Workers errors:
  - "Getting Started": replace `wrangler pages project create` / `wrangler pages deploy dist/` with `wrangler deploy`; drop the `--env production` from `wrangler secret put` (single-env setup); note Pages removed in `@astrojs/cloudflare` v13.
  - Risk register: update the `wrangler deploy` vs `wrangler pages deploy` row (the *correct* command here is `wrangler deploy`), and soften the "`astro dev` vs `wrangler dev` divergence" row — Astro 6 runs `astro dev`/`preview` on workerd via the Cloudflare Vite plugin, largely closing that gap.
- [ ] (Optional) add `.dev.vars.example` documenting `SUPABASE_URL` / `SUPABASE_KEY` for onboarding (the doc references it but it doesn't exist)

---

## Files touched

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Fix `master`→`main` trigger; add gated `wrangler-action` deploy job |
| `context/foundation/infrastructure.md` | Correct Pages→Workers commands + risk rows |
| `.dev.vars.example` | New (optional) — onboarding template |
| `wrangler.jsonc`, `astro.config.mjs`, `src/**` | **No changes** — already workerd-ready |

## What's explicitly NOT in scope

- Workers Paid upgrade (deferred until the OpenRouter recipe endpoint exists; re-verify CPU via `wrangler tail` then)
- OpenRouter/AI integration (no code yet)
- Custom domain / DNS, multi-region, named wrangler environments
- Dockerfiles, DB migration automation

## Verification summary (how we know it worked)

End-to-end auth flow passes against the live `*.workers.dev` URL (signup → email link → signin → protected route → signout), `wrangler tail` shows no errors or CPU warnings, and a push to `main` auto-deploys a new version while Supabase secrets persist.
