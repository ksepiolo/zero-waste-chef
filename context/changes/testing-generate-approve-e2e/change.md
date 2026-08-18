---
change_id: testing-generate-approve-e2e
title: Refresh test-plan to add e2e coverage for the generate→approve→removal loop
status: implemented
created: 2026-08-18
updated: 2026-08-18
archived_at: null
---

## Notes

Risk #8 — The generate→approve→removal loop's UI wiring diverges from its
API contract (a control wired to the wrong endpoint, a param lost between
form and request, or a success state shown despite a failed removal) — a
failure class integration testsall POST/GET
directly (§6.3), bypassing the DOM entirely.
Impact: High (this is the PRD north star" S-02).
Likelihood: Medium (no incident yet — proactive request, not a postmortem;
zero e2e coverage of this flow has a seed test).
Source: interview Q1 ("generate→approve→removal loop breaks end-to-end" —
top e2e worry); interview Q3 (u over auth and data
isolation); PRD north-star / roadmap S-02; existing tests/seed.spec.ts shows
the e2e layer is already adopteflected in the plan.
