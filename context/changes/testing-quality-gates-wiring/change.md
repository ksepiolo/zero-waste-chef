---
change_id: testing-quality-gates-wiring
title: Wire typecheck and unit/integration tests into the CI quality gate
status: implementing
created: 2026-08-30
updated: 2026-08-30
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Quality-gates wiring".
Risks covered: cross-cutting (locks the floor for every risk in §2 — this phase doesn't add new risk-specific tests, it wires the CI gate).
Test types planned: gates.
Risk response intent: Wire typecheck (astro check) and unit+integration (vitest) into the existing single `ci` job in .github/workflows/ci.yml so both go from locally-run-but-ungated to required, per §5 Quality Gates table — the gate that currently stands between merge and auto-deploy-on-push is lint+build only.
After creating the folder, follow the downstream continuation rule.
