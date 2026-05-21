---
bootstrapped_at: 2026-05-21T20:39:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: zero-waste-chef
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: zero-waste-chef
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Zero Waste Chef is a solo web-app with a 3-week after-hours timeline (hard deadline 2026-06-07) requiring email+password auth, a PostgreSQL product inventory, and AI-driven recipe generation. The 10x Astro Starter is the recommended default for (web-app, js) and clears all four agent-friendly gates: Astro 6 handles SSR and API routes; Supabase ships PostgreSQL + auth with Row Level Security out of the box, directly satisfying the PRD's strict data-isolation guardrail; Cloudflare Pages/Workers provides edge deployment on a generous free tier that fits the solo + after-hours profile. Auth and AI feature flags are set (AI integration is an Anthropic/OpenAI SDK install + Astro API route — no starter swap needed). CI runs on GitHub Actions with auto-deploy-on-merge.

## Pre-scaffold verification

| Signal      | Value                                                                    | Severity | Notes                                           |
| ----------- | ------------------------------------------------------------------------ | -------- | ----------------------------------------------- |
| npm package | not run                                                                  | —        | cmd_template starts with `git clone`; npm check skipped |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17T10:33:39Z     | fresh    | from card.docs_url via GitHub API               |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (clone starter repo without keeping its git history)
**Exit code**: 0
**Files moved**: ~34,536 (including node_modules)
**Conflicts (.scaffold siblings)**: `CLAUDE.md` (existing cwd file preserved; scaffold copy at `CLAUDE.md.scaffold`)
**.gitignore handling**: append-merged (cwd lines kept in order; scaffold lines de-duped and appended with `# from 10x-astro-starter` separator)
**.git deletion**: upstream `.git/` deleted before move-up (starter history not imported)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 (both direct findings are moderate)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** `5.6.3–5.8.0` — Advisory GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization" — CWE-770, CVSS 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H). Transitive (via `@astrojs/cloudflare`). Fix available (`npm audit fix`).

#### MODERATE findings

- **@astrojs/check** `>=0.9.3` — isDirect: true — via `@astrojs/language-server` → `volar-service-yaml` → `yaml`. Fix: downgrade to `@astrojs/check@0.9.2` (semver-major break).
- **@astrojs/language-server** `>=2.14.0` — transitive — via `volar-service-yaml`.
- **@cloudflare/vite-plugin** `<=0.0.0-fff677e35 || 0.0.7–1.37.2` — transitive — via `miniflare`, `wrangler`, `ws`. Fix available.
- **miniflare** `<=0.0.0-fff677e35 || 3.20250204.0–4.20260518.0` — transitive — via `ws`.
- **volar-service-yaml** `<=0.0.70` — transitive — via `yaml-language-server`.
- **wrangler** `<=0.0.0-kickoff-demo || 3.108.0–4.93.0` — isDirect: true — via `miniflare`. Fix available.
- **ws** `8.0.0–8.20.0` — transitive — Advisory GHSA-58qx-3vcg-4xpx — "ws: Uninitialized memory disclosure" — CWE-908, CVSS 4.4. Fix available.
- **yaml** `2.0.0–2.8.2` — transitive — Advisory GHSA-48c2-rrv3-qjmp — "yaml vulnerable to Stack Overflow via deeply nested YAML collections" — CWE-674, CVSS 4.3. Fix available.
- **yaml-language-server** — transitive — via `yaml`.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value              |
| ----------------------- | ------------------ |
| team_size               | solo               |
| deployment_target       | cloudflare-pages   |
| ci_provider             | github-actions     |
| ci_default_flow         | auto-deploy-on-merge |
| bootstrapper_confidence | first-class        |
| path_taken              | standard           |
| quality_override        | false              |
| self_check_answers      | null               |
| has_auth                | true               |
| has_payments            | false              |
| has_realtime            | false              |
| has_ai                  | true               |
| has_background_jobs     | false              |

These fields were read and recorded at bootstrap time. A future M1L4 skill ("Memory Architecture") will act on them when setting up `CLAUDE.md` / `AGENTS.md` and CI/CD scaffolding.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` — the starter ships a populated `CLAUDE.md`; decide whether to merge its content into your existing one.
- Run `npm audit fix` to address the moderate and high findings where fixes are non-breaking.
- Copy `.env.example` to `.env` and fill in `SUPABASE_URL` + `SUPABASE_KEY` to start local dev.
- Run `npm run dev` to confirm the dev server starts cleanly.
