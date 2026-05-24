---
project: zero-waste-chef
researched_at: 2026-05-24
recommended_platform: Cloudflare Pages + Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 (SSR, output: "server")
  runtime: Cloudflare Workers (workerd) via @astrojs/cloudflare v13.5.0
  database: Supabase (external PostgreSQL + auth)
  ai: OpenRouter (external API)
---

## Recommendation

**Deploy on Cloudflare Pages + Workers.**

The project is already bootstrapped for this platform — `@astrojs/cloudflare` v13.5.0 and `wrangler` v4.90.0 are installed in `package.json`, and the adapter is configured in `astro.config.mjs`. No adapter swap is needed, which eliminates the primary onboarding risk common to all other platforms. Cloudflare scores 5/5 across all five agent-friendly criteria, provides the most comprehensive MCP integration (15+ GA servers), and the free tier supports 100k requests/day — well above the expected MVP load for a small solo project. The cross-check surfaced three material risks (CPU time model, workerd vs. Node.js runtime gap, write-only secrets), all of which have documented mitigations and are absorbed into the risk register.

## Platform Comparison

### Full Scoring Matrix

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | **Score** |
|---|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Pass | **5 / 5** |
| **Netlify** | Pass | Pass | Pass | Pass | Pass | **5 / 5** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | **4.5 / 5** |
| **Railway** | Pass | Partial | Pass | Pass | Partial | **3.5 / 5** |
| **Fly.io** | Partial | Partial | Partial | Pass | Partial | **2.5 / 5** |
| **Render** | Partial | Partial | Pass | Partial | Partial | **2.5 / 5** |

**Scoring notes by criterion:**

- **CLI-first**: Fly.io lacks a dedicated rollback command (must re-deploy prior image by tag); Render has no CLI rollback (dashboard or REST API only). All others have full deploy + rollback + log streaming via CLI.
- **Managed/Serverless**: Railway and Fly.io run containers — more managed than raw VMs but still require thinking about machine resources and build configuration. Render's free tier spins down after 15 minutes; Starter plan ($7/month) required for always-on.
- **Agent docs**: Fly.io has no `llms.txt` (docs on GitHub as markdown, still agent-fetchable but less ergonomic). All others publish `llms.txt` and/or `llms-full.txt`.
- **Stable deploy API**: Render's rollback requires the dashboard or REST API call, not the CLI — partial because the agent's rollback path requires extra steps.
- **MCP/Integration**: Vercel MCP is beta (as of 2026-02-12). Fly.io MCP is early/experimental (blog post May 2025, no GA announcement). Railway MCP is explicitly "work in progress" in their docs. Render MCP cannot trigger deploys or modify scaling. Cloudflare (15+ GA servers) and Netlify (GA `@netlify/mcp`) are the strongest.

**Soft weights applied (interview answers):**
- Cost vs. DX: no preference → no reweighting
- Familiarity: none → no tie-breaking applied
- Geographic reach: single region → no edge-native bonus
- Co-location: external services → no co-location bonus

**Tiebreaker: Cloudflare vs. Netlify (both 5/5):** The project already has `@astrojs/cloudflare` v13.5.0 and `wrangler` v4.90.0 installed. Switching to Netlify requires removing the Cloudflare adapter, installing `@astrojs/netlify`, and reconfiguring `astro.config.mjs`. Additionally, Netlify's middleware runs in Deno-based Edge Functions (not Node.js), which means the project's `src/middleware.ts` requires audit for Node.js-specific API usage. These costs are non-trivial for a 3-week MVP timeline.

### Shortlisted Platforms

#### 1. Cloudflare Pages + Workers (Recommended)

The project is already wired for Cloudflare — zero adapter friction. Wrangler v4 covers the full operational loop: `wrangler pages deploy` (deploy), `wrangler rollback` (instant revert to prior version), `wrangler tail` (live log streaming with filtering). The free tier gives 100k requests/day with no credit card required and commercial use allowed. Cloudflare's MCP ecosystem is the most mature of any platform researched (15+ GA remote servers), and docs are available as `llms.txt`, per-product scoped files, and markdown for any page. The primary trade-off is the `workerd` runtime: it is not Node.js, and any dependency that relies on Node built-ins requires the `nodejs_compat` flag — a foot-gun if missed.

#### 2. Netlify

Tied with Cloudflare on the scoring matrix but loses the tiebreaker due to adapter friction and Deno-based middleware. The platform is genuinely strong: `netlify deploy` is draft-by-default (safer for agents), `netlify rollback` is instant, and `netlify logs` (released 2026-05-01) provides real-time streaming. The official `@netlify/mcp` package is production-positioned and listed in Anthropic's MCP directory. The free tier switched to credit-based pricing in September 2025 — 300 credits/month is tight when each production deploy costs 15 credits (~13 production deploys exhaust the free tier). The Personal plan at $9/month is the realistic minimum for an active solo dev. The main technical gotcha: the project's `src/middleware.ts` runs as a Netlify Edge Function (Deno runtime, not Node.js), which breaks any Node-specific code in middleware.

#### 3. Vercel

Solid platform with full Astro 6 SSR support via `@astrojs/vercel` (GA, maintained by Astro core team). The `vercel` CLI covers deploy, rollback (to prior deployment), and log streaming. Docs are available via `llms.txt` and `llms-full.txt`. The Hobby plan (free) covers the expected MVP load (1M function invocations/month), but restricts commercial use — a solo course project likely qualifies as non-commercial, but the line is ambiguous. The Vercel MCP is in beta (as of 2026-02-12), so structured agent tooling is less mature than Cloudflare. Requires adapter swap from `@astrojs/cloudflare` to `@astrojs/vercel`.

## Anti-Bias Cross-Check: Cloudflare Pages + Workers

### Devil's Advocate — Weaknesses

1. **10ms CPU time limit on the free tier will silently terminate AI-heavy requests.** Cloudflare's free tier grants 10ms of CPU time per invocation — not wall clock time, but actual CPU cycles. A recipe generation flow that parses an OpenRouter JSON response and runs business logic can exceed this budget and return a generic "Worker exceeded CPU time limit" error with no useful stack trace. Discovery is painful: the Cloudflare dashboard shows HTTP 200 in the request log, and the error only appears in `wrangler tail` output. The fix is the $5/month Workers paid plan, but the failure mode will not surface until production traffic hits it.

2. **`workerd` is not Node.js — transitive dependencies that rely on Node built-ins break silently in production.** `@supabase/ssr` uses `node:crypto` for PKCE session signing. Without the `nodejs_compat` flag explicitly set in `wrangler.jsonc`, the app works in local dev (real Node.js runtime) and fails in production (`workerd`). The bootstrapper may have scaffolded the config correctly, but any future dependency or tutorial-copied code that introduces a Node built-in dependency will reintroduce this failure.

3. **`Astro.locals.runtime` was removed in `@astrojs/cloudflare` v13 — every pre-2025 tutorial shows the wrong pattern.** The new env access pattern (`import { env } from "cloudflare:workers"`) is correct, but the old pattern is the most-indexed result for "Cloudflare Astro environment variables." Mixing patterns produces a runtime error visible only in production, not in `astro dev`.

4. **`wrangler pages deploy` and `wrangler deploy` are completely different commands for different products.** The bootstrapped project is Pages-based; `wrangler deploy` targets Workers scripts and will not deploy the Pages project. An agent or developer who finds `wrangler deploy` examples online and uses them will see confusing failures.

5. **Daily request limit resets at midnight UTC with no burst allowance.** At a demo, cohort submission deadline, or unexpected traffic spike, exceeding 100k requests/day on the free tier serves Cloudflare's generic 1015 rate-limit page to all users until midnight UTC. There is no grace period and no way to temporarily unlock capacity without upgrading to the paid plan.

### Pre-Mortem — How This Could Fail

The team ships Zero Waste Chef on Cloudflare Pages in week one. The first week feels smooth — `astro dev` runs locally, `wrangler pages deploy` works on the first try. Week two: recipe generation starts failing in production for some users. The Cloudflare dashboard shows 200 OK responses, which is confusing. After a day of investigation, `wrangler tail --format json` reveals CPU time exceeded errors — the OpenRouter response parsing and the inventory-diff logic together burn past the 10ms CPU budget. Upgrading to the $5/month paid plan fixes it, but the debugging time wasn't budgeted for a 3-week sprint.

Week four: Supabase auth stops working for a subset of users after an npm update. The new version of `@supabase/ssr` changed how it accesses `node:crypto`. The `nodejs_compat` flag isn't set in `wrangler.jsonc` — the bootstrapper scaffolded the file but the flag requires explicit opt-in. Works in dev. Fails in `workerd`. Another weekend of debugging.

By month two, the developer has accumulated a private mental model of workerd-vs-Node differences that isn't documented anywhere in the project. Returning to the codebase after a week away means re-deriving which patterns work and which don't. Every new dependency requires a cognitive audit: "does this library use Node built-ins?" The platform is genuinely capable and the free tier economics are excellent, but the runtime-mismatch failure pattern is underestimated during planning and will surface repeatedly across the MVP development cycle.

### Unknown Unknowns

- **CPU time vs. wall clock is a foreign mental model**: Most developers reason about "max execution time" (wall clock). Cloudflare charges CPU time. An app that spends 2 seconds awaiting an OpenRouter response uses almost no CPU budget during that wait — but the surrounding business logic does. Developers will not know their CPU budget is close to the limit until they hit it in production.
- **`astro dev` and `wrangler dev` diverge for Cloudflare-specific APIs**: `import { env } from "cloudflare:workers"` works in `wrangler dev` but throws in `astro dev`. Tests or seed scripts that import server modules will fail or silently use a different env-access path depending on which dev command launched them.
- **Cloudflare Workers Secrets are write-only via CLI**: `wrangler secret list` shows variable names but not values. Once a Supabase key is set, it cannot be read back to verify — only overwritten. Debugging key rotation or misconfiguration requires setting the value again blind.
- **Cloudflare Pages has two separate deploy paths that can conflict**: The Pages git-push CI (Cloudflare's build infrastructure, triggered on push to main) and `wrangler pages deploy` (direct upload, bypasses CI) can deploy different code if both are active. Disabling automatic git-push deploys in the Cloudflare dashboard is a manual step that must be done intentionally if direct deploys are preferred.
- **User decision**: Proceeded with Cloudflare Pages + Workers — risks absorbed into risk register below.

## Operational Story

- **Preview deploys**: Cloudflare Pages creates a preview URL for every branch and PR automatically (format: `<branch-name>.<project>.pages.dev`). Preview deploys are publicly accessible by default — protect them with Cloudflare Access if the staging environment should be private. Fork PRs from public forks do NOT get preview deploys (Cloudflare Pages limitation for security reasons).
- **Secrets**: Environment variables (including `SUPABASE_URL`, `SUPABASE_KEY`) are set via `wrangler secret put <NAME>` or in the Cloudflare Pages dashboard under Settings → Environment Variables. Secrets cannot be read back once set — only overwritten. Separate variable sets exist for production and preview environments. For local dev, use `.dev.vars` (already gitignored per project convention).
- **Rollback**: `wrangler rollback [version-id]` reverts to a prior Worker version immediately. For Pages, open the Cloudflare Pages dashboard → project → Deployments → select a prior deployment → "Rollback to this deployment." Time-to-revert is typically under 30 seconds. Database migrations do NOT roll back automatically — a code rollback after a schema migration requires a separate migration rollback in Supabase.
- **Approval**: Agent may perform unattended: `wrangler pages deploy`, `wrangler secret put`, `wrangler tail`, `wrangler rollback`. Human-only actions: deleting the Pages project, rotating the Supabase service role key, changing billing tier, modifying DNS / custom domain configuration, and Cloudflare Access policy changes.
- **Logs**: `wrangler tail <worker-name> --format json` streams live invocation logs with request metadata. Filter by status: `--status error`. For Pages-specific build logs: Cloudflare dashboard → project → Deployments → build details (no CLI equivalent for build logs as of 2026-05-24). Cloudflare MCP observability server exposes structured log queries for agent use.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| CPU time exceeded on free tier during AI recipe generation | Devil's advocate | High | High | Upgrade to Workers Paid ($5/month) before first production deploy. Verify with `wrangler tail --status error` after deploying recipe generation route. |
| `nodejs_compat` flag missing causes Supabase/crypto failures in workerd | Devil's advocate | High | High | Confirm `compatibility_flags = ["nodejs_compat"]` is in `wrangler.jsonc` before first deploy. Test `wrangler dev` (not `astro dev`) against real Supabase calls. |
| `Astro.locals.runtime` removed in v13 — old tutorial patterns break silently | Devil's advocate | Medium | Medium | Audit `src/middleware.ts` and any Cloudflare env access for `Astro.locals.runtime` usage. Replace with `import { env } from "cloudflare:workers"` per v13 docs. |
| Wrong wrangler command used (`wrangler deploy` instead of `wrangler pages deploy`) | Devil's advocate | Medium | Low | Document the correct deploy command in README. CI/CD should use `wrangler pages deploy` explicitly. |
| Daily 100k request free-tier limit causes 1015 errors during demo/spike | Devil's advocate | Low | High | Pre-emptively upgrade to Workers Paid ($5/month) before any public demo or submission deadline. |
| `astro dev` vs `wrangler dev` env-access divergence causes test/seed failures | Unknown unknowns | Medium | Low | Use `wrangler dev` for any test involving Cloudflare-specific APIs. Document in CLAUDE.md. |
| Write-only secrets make key rotation debugging opaque | Unknown unknowns | Low | Medium | Keep a private (not-in-repo) record of which secret values are set. Use `wrangler secret list` to audit names; re-set if values are suspected incorrect. |
| Pages git-push CI and `wrangler pages deploy` both active — conflicting deploys | Unknown unknowns | Low | Medium | Choose one deploy path: either disable Cloudflare Pages auto-deploy in dashboard and use `wrangler pages deploy` exclusively, or disable direct uploads and use git-push only. |
| Astro 6 hybrid-site SSR+prerender middleware bug (#15237) | Research finding | Low | Medium | Project is full SSR (no prerendered routes) so this bug does not apply. If prerendered routes are added, test middleware behavior against that route before shipping. |
| `wrangler deploy --x-versions` (gradual rollout) is in open beta | Research finding | Low | Low | Do not use `--x-versions` for production deploys until GA is announced. Use standard `wrangler pages deploy` + manual rollback instead. |

## Getting Started

The project is already bootstrapped for Cloudflare — these steps connect it to a live Pages project.

1. **Authenticate wrangler** (one-time):
   ```bash
   npx wrangler login
   ```
   This opens a browser for OAuth with your Cloudflare account. Credentials are stored in `~/.config/.wrangler/`.

2. **Create the Pages project** (one-time):
   ```bash
   npx wrangler pages project create zero-waste-chef
   ```
   Pick a production branch name (typically `main`). This registers the project in your Cloudflare account.

3. **Set production secrets**:
   ```bash
   npx wrangler secret put SUPABASE_URL --env production
   npx wrangler secret put SUPABASE_KEY --env production
   ```
   Set preview secrets separately if you have a Supabase staging project:
   ```bash
   npx wrangler secret put SUPABASE_URL --env preview
   npx wrangler secret put SUPABASE_KEY --env preview
   ```

4. **Verify `nodejs_compat` is in `wrangler.jsonc`** before first deploy:
   ```json
   { "compatibility_flags": ["nodejs_compat"] }
   ```
   Without this, `@supabase/ssr` will fail in `workerd` at runtime.

5. **Deploy to production**:
   ```bash
   npm run build
   npx wrangler pages deploy dist/ --project-name zero-waste-chef --branch main
   ```
   The command outputs the deployment URL. Verify recipe generation works against production secrets before announcing the URL.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions auto-deploy-on-merge from tech-stack.md is covered separately)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare D1, R2, KV, or Queues — the project uses Supabase and OpenRouter exclusively
