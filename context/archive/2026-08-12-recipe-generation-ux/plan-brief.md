# Recipe Generation UX — Plan Brief

> Full plan: `context/changes/recipe-generation-ux/plan.md`

## What & Why

Let the user choose three recipe parameters — cooking **technique**, **method** (dish format), and **available time** — before generating, and have the AI honour them. The key insight from research: these three constraints already exist in the codebase, hardcoded inside `SYSTEM_PROMPT`. This slice does not add constraints, it makes existing ones user-controlled. It also fixes a live **FR-007** violation sitting in the exact lines being rewritten. Closes roadmap slice **S-04**.

## Starting Point

The generate path is four layers deep and every one is parameter-blind: the button (`inventory-panel.tsx:194`), the zero-arg `generate()` hook, an endpoint validating only `excludeTitles`, and a `generateRecipe()` reading a module-level `SYSTEM_PROMPT` constant. That constant pins the technique whitelist (`sauté, boil, roast, bake, simmer, fry, stir-fry`) and a hard 45-minute cap at `recipe.service.ts:13-20`.

Separately, the endpoint passes **only at-risk products** to the model and returns `400 "No at-risk products"` when none exist — contradicting FR-007 ("the AI always receives the full inventory") and §Business Logic ("generation is never blocked by inventory state"). It shipped that way in S-02 by design; the design contradicts the PRD.

## Desired End State

Three dropdowns sit above the Generate button, each defaulting to **Any**. The user picks any combination and gets a recipe honouring those choices while still prioritising at-risk products. The button appears whenever the inventory is non-empty, not only when something is expiring.

## Key Decisions Made

| Decision                | Choice                                                                  | Why (1 sentence)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vocabulary              | Closed enums, all three                                                 | The injection reasoning already written at `generate.ts:11` for `excludeTitles` applies identically to values that land in the prompt on a shared API key.                                                                                                                                                                                                                                                                                                           |
| Values                  | Balanced (8 × 5 × 4)                                                    | Technique mirrors the whitelist already in `SYSTEM_PROMPT`. Method is partly new vocabulary: `soup` and `salad-assembly` echo the Variety rule (`recipe.service.ts:20`), but `stir-fry` and `bake` sit in the technique enum instead, and `one-pot` / `sheet-pan` are new. `stovetop-only` was dropped — it restates a technique rather than a dish format and collides with `bake`/`roast`. Time stops at 45: every value narrows the shipped cap, none relaxes it. |
| Priority under conflict | At-risk wins; params are strong preferences                             | Protects the PRD's Primary success criterion and the roadmap's stated S-04 risk — tight constraints degrade gracefully instead of dropping expiring food.                                                                                                                                                                                                                                                                                                            |
| FR-007 deviation        | Fix both halves in this slice                                           | These are the exact lines the parameter work rewrites; parameters are meaningless to a user who can't generate at all.                                                                                                                                                                                                                                                                                                                                               |
| UI placement            | Inline, above the Generate button                                       | Mirrors the add-product form directly above it; no extra click on the product's core loop.                                                                                                                                                                                                                                                                                                                                                                           |
| `Any` semantics         | Renders the end-of-Phase-1 `messages` array verbatim, 45-min cap intact | Zero behaviour change for users who ignore the controls, making any quality regression attributable to a chosen parameter. The baseline is post-Phase-1, not pre-change `main`, because Phase 1 step A neutralises the few-shot demonstration.                                                                                                                                                                                                                       |
| Persistence             | Session-only React state                                                | Matches the deliberately session-scoped `seenTitles` precedent; no storage, no migration, no hydration risk.                                                                                                                                                                                                                                                                                                                                                         |
| Params on recipe row    | Not stored                                                              | Avoids a migration and a signature change to the `approve_recipe` RPC that S-02's atomicity guardrail depends on.                                                                                                                                                                                                                                                                                                                                                    |
| Control component       | Native `<select>`, not shadcn                                           | The sibling form in the same file uses raw `<input>` with inline Tailwind; only `button`/`alert-dialog`/`sonner` are installed.                                                                                                                                                                                                                                                                                                                                      |

## Scope

**In scope:**

- Three parameter enums + labels in `src/types.ts`
- `SYSTEM_PROMPT` constant → `buildSystemPrompt(params)` template
- Full inventory to the model with at-risk flagged and sorted first
- Removal of the `400 "No at-risk products"` gate and the conditional Generate button
- Zod enum validation on `POST /api/recipes/generate`
- `generate(params)` hook signature + three inline selects

**Out of scope:**

- Server-side verification that the model honoured the parameters
- Storing parameters on the recipe row; any migration or RPC change
- Persistence across reloads; free-text input; conflict pre-detection
- Loosening the equipment rule; any change to the approve path
- A test framework (Module 3 territory)

## Architecture / Approach

```
inventory-panel.tsx  ── useState<RecipeParams> (all "any")
      │ generate(params)
      ▼
use-recipe-generation.ts ── POST { technique, method, time, excludeTitles }
      ▼
api/recipes/generate.ts ── zod enums (.default("any")) + full product list
      ▼
recipe.service.ts ── buildSystemPrompt(params)  +  at-risk-first sort → slice(25)
      ▼
OpenRouter ── existing ID guardrail unchanged
```

Enums are declared once in `src/types.ts` and consumed by the zod schema, the prompt builder, and the select options.

## Phases at a Glance

| Phase                          | What it delivers                                      | Key risk                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. FR-007 alignment            | Full inventory to the model; generation never blocked | `MAX_PROMPT_PRODUCTS = 25` truncating at-risk products out of an unsorted full inventory — silently breaks the PRD's Primary criterion with no error |
| 2. Parameter plumbing (server) | Enums, zod validation, `SYSTEM_PROMPT` → template     | Appending rather than rewriting the technique/time lines, leaving the model two contradictory instructions                                           |
| 3. Parameter controls (UI)     | Three inline selects, `generate(params)`              | The approval modal's "Generate Different Recipe" silently dropping the parameters                                                                    |

**Prerequisites:** F-01 (done). A working `OPENROUTER_API_KEY`. An inventory of 26+ products, with at-risk items added last, to honestly exercise the truncation fix.

**Estimated effort:** ~1–2 sessions across 3 phases. No migration, no new dependency, four files.

The phase order is deliberate: Phase 1 changes _what the model sees_, Phase 2 changes _how the prompt is written_, and `Any/Any/Any` after Phase 2 must render Phase 1's prompt byte-identically. That makes a quality regression attributable to one change rather than two — the tradeoff accepted when folding the FR-007 fix into this slice.

## Open Risks & Assumptions

- **Nothing verifies the model actually honoured a parameter.** The only post-generation guardrail checks product IDs. A recipe labelled "≤15 min" that takes 40 is undetectable server-side, and detecting it would need a second model call.
- **Nonsensical pairings are selectable.** `No-cook` + `Soup` is reachable; the model's response is whatever it is. Manual scenario 4 checks only that the app doesn't crash.
- **The at-risk-wins decision is user-visible as silent override.** Someone picking "≤15 min" may get a 30-minute recipe with no explanation. The plan does not add messaging for this.
- **Free-tier OpenRouter latency was measured at 27s in S-02.** The existing 30s timeout has little headroom; parameters add tokens but not meaningfully.
- **Parallel collision with S-03** (`recipe-history`, `plan_reviewed`): both touch `recipe.service.ts`, but with disjoint additions. Textual merge conflict possible in the import block; semantic conflict not expected.
- **No test runner.** All verification is `typecheck` / `lint` / `build`, curl, and manual browser testing.

## Success Criteria (Summary)

- A user can pick technique, method, and time before generating, and the recipe reflects those choices.
- A user with nothing expiring can still generate a recipe — the FR-007 fix — and a user with at-risk items still gets them used, even under a tight time constraint.
- Leaving all three on "Any" produces exactly the behaviour that exists today.
