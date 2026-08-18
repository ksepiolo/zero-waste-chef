---
change_id: test-plan-refresh-2026-08-18
title: Refresh test-plan.md for Playwright e2e adoption and generate-approve-removal risk
status: implemented
created: 2026-08-18
updated: 2026-08-18
archived_at: null
---

## Notes

Open a change folder to refresh context/foundation/test-plan.md.

Trigger: Playwright infra (playwright.config.ts, tests/auth.setup.ts, tests/seed.spec.ts,
commit 91934fe) landed after test-plan.md's Phase 2 interview decided to exclude
browser-driven e2e entirely (§4, §7). That decision is now stale, and a new top-3 risk
surfaced from user concern about the generate→approve→removal loop (the PRD north star,
S-02).

Changes needed in context/foundation/test-plan.md:

1. §2 Risk Map: add Risk #8 — "The generate→approve→removal loop's UI wiring diverges
   from its API contract (a control wired to the wrong endpoint, a param lost between
   form and request, or a success state shown despite a failed removal)." Impact: High
   (PRD north star, roadmap.md:24 S-02). Likelihood: Medium (no incident yet; existing
   integration tests call POST/GET directly per §6.3, bypassing the DOM entirely — this
   failure class is currently invisible to the suite). Source: user concern (top e2e
   worry — the generate→approve→removal loop breaking end-to-end; secondary concern
   over auth/data isolation); PRD north-star / roadmap S-02; tests/seed.spec.ts proves
   the e2e layer is adopted for a different flow (inventory add/reload) but not this one.
2. §2 Risk Response Guidance row for #8: what would prove protection = from a real
   browser session, generate a recipe, reach the approval screen, click approve, and
   confirm exactly the listed products are gone from inventory and the recipe now
   appears in history, surviving a real page reload. Must challenge = "the integration
   tests already prove the loop works" (they prove the contract, not the wiring — a
   button pointed at the wrong endpoint or a dropped client param passes every
   integration test and only fails in a real browser). Context /10x-research must
   ground = which components own generate/approve (use-recipe-generation hook,
   inventory/recipe pages), which endpoints they call, how success/failure is rendered,
   whether auth.setup.ts's storageState covers login for this flow. Likely cheapest
   layer = e2e (Playwright) — exists only in the rendered UI, no unit/integration test
   can see DOM wiring. Anti-pattern to avoid = asserting on toast text alone instead of
   actual inventory/history state after approve.
3. §3 Phased Rollout: add a new row — Phase 5, "E2E: generate→approve→removal wiring",
   goal "Prove the UI wiring for generate→approve→removal matches its API contract, from
   a real browser", risks covered "#8", test types "e2e (Playwright)", status
   "not started", change folder "context/changes/testing-generate-approve-e2e/" (this
   folder already exists with a draft change.md — reuse it rather than opening a new one
   when this phase starts). Depends on §3 Phase 2 (approval contract integrity, already
   complete) for the API-layer guarantee this test builds on top of.
4. §4 Stack: flip the e2e row from "none — excluded" to "Playwright ^1.62.1 —
   tests/seed.spec.ts + tests/auth.setup.ts landed 2026-08-18 (commit 91934fe)". Add a
   checked: 2026-08-18 date.
5. §7 What We Deliberately Don't Test: narrow the blanket "no browser-driven e2e" line —
   UI rendering/visual/snapshot testing (no component tests, no snapshots, no visual
   diffing) stays excluded; a small number of risk-tied e2e flows (Risk #8) are now in
   scope. Leave the AI-native/vision exclusions untouched.
6. §8 Freshness Ledger: update "Strategy (§1–§5) last reviewed" to 2026-08-18.

Never add file:line anchors to §2 — evidence only (PRD lines, roadmap lines, user
concern, existing test file names). After creating the folder, follow the downstream
continuation rule: since this is a test-plan.md edit (not a rollout phase), this small
change likely doesn't need the full research→plan→implement chain — a direct edit to
test-plan.md via /10x-plan (lightweight) or even inline, per user preference, is fine.
Confirm with the user before writing.
