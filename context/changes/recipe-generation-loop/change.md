---
change_id: recipe-generation-loop
title: Recipe generation loop
status: implementing
created: 2026-06-05
updated: 2026-08-09
research_status: complete
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 2 deviations from plan

- **Model**: plan specified `google/gemini-2.0-flash-001` (paid). Switched to
  `google/gemma-4-26b-a4b-it:free` at the user's request. Probed all 5 OpenRouter free
  models advertising `structured_outputs`; all returned schema-conformant JSON with correct
  UUID passthrough. Gemma-4 was fastest (10.3s vs 31–44s) and Google-family, so the
  Gemini-oriented prompt tuning (`propertyOrdering`, few-shot) still applies. Free tier is
  rate-limited — fall back to the paid Gemini model if quota bites.
- **Latency**: first real end-to-end generate took **27s**, above the plan's 5–15s estimate.
  Free-tier queueing. Phase 3's spinner UX matters more than assumed.
- **RPC typing**: used `.overrideTypes<string>()` instead of the plan's `.returns<string>()`
  — the latter is deprecated in the installed `supabase-js`. Same resulting type.
- **Seed fix (out of plan scope)**: `supabase/seed.sql` produced a test user that could not
  authenticate — `aud`/`instance_id` unset ("Invalid login credentials"), and NULL token
  columns ("Database error querying schema"). Fixed so `npx supabase db reset` yields a
  working `test@example.com` / `Test1234!` login.
