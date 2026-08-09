---
change_id: recipe-generation-loop
title: Recipe generation loop
status: implemented
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

### Phase 3 deviations from plan

- **Generate button styling**: plan specified `className="mt-4 w-full"`. Added a
  blue→purple gradient so the CTA reads as primary against the dark cosmic panel
  background, matching the dashboard's existing accent.
- **Modal scroll**: wrapped ingredients + instructions in `max-h-[50vh] overflow-y-auto`
  so a long recipe cannot push the footer buttons off-screen.
- **Regeneration variety (user-requested, extends Phase 2 files)**: "Generate Different
  Recipe" returned the same dish, because the request was byte-identical and the few-shot
  anchored on spinach + garlic (common staples, so the model handed the example dish back).
  Fixes: (1) few-shot rebuilt on canned chickpeas + lemon so it anchors format not content;
  (2) system prompt gained a Variety rule requiring a different cooking method, dish format
  and flavour profile; (3) hook tracks `seenTitles` and posts them as `excludeTitles`, which
  `generate.ts` forwards to the service; (4) temperature 0.4 → 0.9 on regenerations only.
  Verified: sauté pan → baked pasta → omelette across three sequential calls.
  `seenTitles` is session-scoped — a page reload clears it. Persisting suggestion history
  server-side would cross into "recipe history", listed under What We're NOT Doing.
