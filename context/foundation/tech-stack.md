---
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
---

## Why this stack

Zero Waste Chef is a solo web-app with a 3-week after-hours timeline (hard
deadline 2026-06-07) requiring email+password auth, a PostgreSQL product
inventory, and AI-driven recipe generation. The 10x Astro Starter is the
recommended default for (web-app, js) and clears all four agent-friendly
gates: Astro 6 handles SSR and API routes; Supabase ships PostgreSQL + auth
with Row Level Security out of the box, directly satisfying the PRD's strict
data-isolation guardrail; Cloudflare Pages/Workers provides edge deployment
on a generous free tier that fits the solo + after-hours profile. Auth and AI
feature flags are set (AI integration is an Anthropic/OpenAI SDK install +
Astro API route — no starter swap needed). CI runs on GitHub Actions with
auto-deploy-on-merge.
