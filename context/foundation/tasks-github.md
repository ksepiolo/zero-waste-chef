---
project: "Zero Waste Chef"
repo: "ksepiolo/zero-waste-chef"
created: 2026-05-27
source: context/foundation/roadmap.md
---

# GitHub Issues — Zero Waste Chef

Mirrors the backlog created from `roadmap.md`. All issues live at `https://github.com/ksepiolo/zero-waste-chef/issues`.

## Labels

| Label | Color | Purpose |
|---|---|---|
| `type:foundation` | `#0075ca` | Horizontal enabler slice (F-*) |
| `type:slice` | `#e4e669` | Vertical user-facing slice (S-*) |
| `type:question` | `#cc317c` | Open question to resolve during implementation |
| `status:ready` | `#0e8a16` | Ready to implement |
| `status:proposed` | `#d93f0b` | Waiting on prerequisites |

## Issues

| # | Roadmap ID | Title | Labels | Prerequisites |
|---|---|---|---|---|
| [#1](https://github.com/ksepiolo/zero-waste-chef/issues/1) | F-01 | Supabase: products + recipes schema with RLS | `type:foundation` `status:ready` | — |
| [#2](https://github.com/ksepiolo/zero-waste-chef/issues/2) | S-01 | Inventory: add / view (at-risk flag) / delete products | `type:slice` `status:proposed` | #1 |
| [#3](https://github.com/ksepiolo/zero-waste-chef/issues/3) | S-02 | Recipe loop: generate → approve → remove products (AI) | `type:slice` `status:proposed` | #1, #2 |
| [#4](https://github.com/ksepiolo/zero-waste-chef/issues/4) | S-03 | Recipe history: list of approved recipes | `type:slice` `status:proposed` | #3 |
| [#5](https://github.com/ksepiolo/zero-waste-chef/issues/5) | — | [Question] OpenRouter model and prompt phrasing for recipe generation | `type:question` | #3 |
| [#6](https://github.com/ksepiolo/zero-waste-chef/issues/6) | — | [Question] What to display in the recipe history list | `type:question` | #4 |
