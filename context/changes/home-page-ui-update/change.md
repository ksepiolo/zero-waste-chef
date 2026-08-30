---
change_id: home-page-ui-update
title: Home page ui update
status: planned
created: 2026-08-30
updated: 2026-08-30
archived_at: null
---

## Notes

Dostosować stronę główną do designu z Figmy: https://www.figma.com/design/HijlsMP1h4eCPUbUIjBoPI/Zero-waste

Scope pinned to Figma frame **"Desktop - 1"** (node `#1:2`) only — the file's other three
frames (sign-up form, pantry/recipe-settings, recipe history) map to different existing
routes (`auth/signup.astro`, `dashboard.astro`/`inventory.astro`, `recipes.astro`) and are
each a separate future change, not part of this one.

Hero photo already pulled from Figma (node `1:193`) to `public/images/home-hero.png`.

See `plan-brief.md` for the key decisions made during planning (font loading, brand
token scope, logged-in-user redirect to `/dashboard`, no new E2E test).
