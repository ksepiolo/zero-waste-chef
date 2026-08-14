<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recipe Generation UX

- **Plan**: `context/changes/recipe-generation-ux/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations
- **Commits reviewed**: `5427eb6` (p1), `df72f4f` (p2), `2c5c344` (p3), `0e651e9` (docs)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

Plan adherence is unusually clean: every one of the 8 planned changes across the three
phases verified as MATCH, including both new Phase 1 guardrails, the sort-before-slice
fix, and the byte-identity property of `buildSystemPrompt`. Re-verified independently:
`npm run typecheck` (0 errors), `npm run lint`, `npm run build` all pass, and
`buildSystemPrompt({any, any, any})` reproduces the pre-change `SYSTEM_PROMPT` character
for character when imported from plain node — criterion 2.4 holds. No "What We're NOT
Doing" boundary was crossed; the diff touches only the 6 planned source files plus three
doc files.

## Findings

### F1 — Variety rule tells the model to change the main ingredients, contradicting the at-risk floor

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/recipe-prompt.ts:46`
- **Detail**: The approved Variety deviation strikes pinned dimensions from the "change the
  cooking method, the dish format…" list. When *both* technique and method are pinned,
  `axes.length === 1` and the fallback pushes `"the main ingredients"`, rendering:
  *"your answer must be a clearly different dish — change the flavour profile and the main
  ingredients."* On the same request the user turn says *"At-risk ingredients … the recipe
  must use at least one of these"* (`recipe.service.ts:88`). With a single at-risk product
  these are flatly contradictory, and this is exactly the "two conflicting instructions"
  failure the deviation was written to eliminate. The failure mode is not cosmetic: if the
  model follows Variety it drops the at-risk item, the new assertion at
  `recipe.service.ts:161-166` throws, and the user gets a 500 toast. Reachable in normal
  use — "Generate Different Recipe" sends `excludeTitles` with whatever params are set, so
  any pinned-technique + pinned-method regenerate hits it.
- **Fix**: Replace the `"the main ingredients"` fallback with an axis that does not compete
  with the at-risk requirement — e.g. `"how the same ingredients are prepared"` — or append
  a clause preserving the floor (`"…while still using an at-risk ingredient"`).
  - Strength: Keeps the deviation's intent (give the model *some* axis to vary) while
    removing the only branch that collides with the PRD's Primary success criterion.
    All-`"any"` is untouched, so criterion 2.4 still holds byte-identically.
  - Tradeoff: With both dimensions pinned the model has genuinely little room left; a
    weaker variety axis may return near-duplicate dishes on regenerate. That is the better
    failure than a 500.
  - Confidence: HIGH — the contradiction is visible in the rendered string; only the
    frequency of the model actually following it is unmeasured.
  - Blind spot: Not observed live — criteria 2.12 and 3.7, which would surface it, are both
    unchecked (see F2).
- **Decision**: FIXED — fallback axis changed to `"how the same ingredients are prepared"`
  (`recipe-prompt.ts:47`), comment updated. All-`"any"` branch untouched.

### F2 — Every runtime success criterion is unverified, and the Phase 1 and 2 manual gates were bypassed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/recipe-generation-ux/plan.md:368-433`
- **Detail**: 12 of 38 criteria are checked (32%). Everything checked is static —
  typecheck/lint/build, the 401 case, and the node-script byte-identity check. Every
  criterion that requires a running server or a live model call is unchecked: 1.4, 1.5,
  2.5–2.8 (curl) and 20 of 21 manual items. Both phase gates say *"pause here for manual
  confirmation from the human that the manual testing was successful before proceeding"*,
  yet `df72f4f` and `2c5c344` landed with Phase 1's manual block still at 1/6.
  The unverified set is not incidental — it is precisely the behaviour this change
  introduces: 1.7 and 1.8 exercise the two guardrails added in Phase 1 (at-risk inclusion,
  sort-before-slice), 1.4 is the FR-007 fix that motivated the whole slice, and 2.12 is the
  pairing the plan itself named as most likely to trip the new throw. Static analysis
  cannot reach any of them. Note also that 1.12 is checked while 1.11 ("recipe quality
  unchanged") is not — 1.12 is a narrower claim about the same manual quality pass, so the
  record is internally inconsistent.
- **Fix**: Run the curl block from § Testing Strategy against a local dev server with a
  session cookie (1.4, 1.5, 2.5–2.8), then the six manual scenarios, and check the boxes
  with evidence before this change is archived.
  - Strength: These are the only criteria that can detect a model-behaviour regression;
    the plan's whole phase-separation design exists so a regression is attributable, and
    that design is currently unused.
  - Tradeoff: Roughly an hour of manual work including seeding a 26-product inventory for
    1.8; each generation costs ~27s on the free tier.
  - Confidence: HIGH — the checkbox state and the commit order are both directly readable.
  - Blind spot: The human may have done some of this testing without recording it; if so
    the fix is just to check the boxes.
- **Decision**: SKIPPED — runtime criteria stay unverified by choice.

### F3 — Product names go into a now multi-section prompt unescaped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/recipe.service.ts:81`
- **Detail**: `render` interpolates `p.name` with no escaping. Names are validated only as
  `z.string().min(1).max(255)` (`src/pages/api/products/index.ts:9`), so newlines and the
  literal `(id: …)` delimiter all pass. Interpolation itself is pre-existing, but this
  change made the user turn **newline-delimited and multi-section** (`recipe.service.ts:87-94`)
  — a name containing `\n` can now forge an "Other available ingredients:" header and
  demote the at-risk framing the feature rests on. Blast radius is self-limited:
  `listProducts` is `user_id`-scoped, the ID cross-check rejects out-of-list IDs, and
  `approve_recipe` filters on `auth.uid()` — so a user can only garble their own
  generation. That is what keeps this a warning rather than a security defect.
- **Fix**: Strip line breaks and cap length inside `render`:
  `p.name.replace(/[\r\n]+/g, " ").slice(0, 60)`.
- **Decision**: FIXED — `sanitizeName` added and applied in `render` (`recipe.service.ts:81-85`).

### F4 — `recipe-prompt.ts` does not follow the dot-suffix file-naming rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/services/recipe-prompt.ts`
- **Detail**: CLAUDE.md: *"File naming must use kebab-case with dot-separated type suffixes.
  Always name files as feature.handler.ts, feature.service.ts, feature.controller.ts."*
  Both siblings in the directory are `product.service.ts` and `recipe.service.ts`; the new
  file joins feature and role with a hyphen and carries no suffix. This originates in the
  plan (`plan.md:196` names the path), so it is a plan flaw carried faithfully into code
  rather than implementation drift.
- **Fix**: Rename to `recipe.prompt.ts` and update the two importers
  (`recipe.service.ts:6`, plus the scratch verification script if it is kept).
- **Decision**: SKIPPED — filename kept as planned.

### F5 — Approve can now permanently delete non-at-risk products, with unchanged disclosure

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/inventory/inventory-panel.tsx:338-351`
- **Detail**: Before this change `generate.ts` passed only `products.filter(p => p.is_at_risk)`,
  so `validIds` was built from that subset and `approve_recipe`'s
  `DELETE FROM products WHERE id = ANY(p_used_product_ids)` was structurally incapable of
  removing a fresh product. With the full inventory in `validIds`, approving can now
  irreversibly delete products weeks from expiry. This follows from FR-007 and is disclosed
  — the plan explicitly reworded the `used_product_ids` description so FR-008's list would
  not under-report — but the affordance did not scale with the blast radius: the "will
  remove from inventory" line sits in a muted `AlertDialogDescription` below a
  `max-h-[50vh] overflow-y-auto` recipe box (often below the fold), and Approve is a
  default-variant `<Button>` beside "Generate Different Recipe". `approve_recipe` has no
  undo path. Out of this plan's scope ("No changes to the approve path"), recorded as
  follow-up rather than drift.
- **Fix**: Follow-up slice — move the removal list above the scrollable recipe block and
  give Approve destructive styling.
- **Decision**: SKIPPED — accepted as-is; no follow-up recorded.

### F6 — `params` is optional in `generateRecipe` where the plan made it an argument

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/services/recipe.service.ts:68`
- **Detail**: `params: RecipeParams = DEFAULT_RECIPE_PARAMS`. The plan said `generateRecipe`
  "gains a `params` argument" without specifying a default. Harmless today — the single
  caller always passes it — but a future caller can omit params and silently generate with
  all-`"any"` instead of failing to compile. `DEFAULT_RECIPE_PARAMS` itself (`types.ts:65`)
  is a sensible unplanned addition; the endpoint's zod `.default("any")` already covers the
  backward-compatibility case the service default would otherwise serve.
- **Fix**: Drop the default so the parameter is required.
- **Decision**: SKIPPED — default kept.

### F7 — UI label maps live in `src/types.ts`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/types.ts:68-92`
- **Detail**: CLAUDE.md scopes this file to *"Shared types (entities, DTOs)"*, and it was
  previously type-only — every importer used `import type`. It now exports runtime values,
  including display copy (`"≤15 min"`, `"Boil / simmer"`), and is pulled into the client
  bundle by the value import at `inventory-panel.tsx:3-11`. The enum consts have a real
  justification: `generate.ts:17-19` reuses them as the zod source of truth. The three
  `*_LABELS` maps do not — they are view-layer concerns. The plan asked for this
  ("keep the label mapping alongside the enum"), so it is a plan decision, not drift.
- **Fix**: Keep the enums and types in `types.ts`; move the three `*_LABELS` maps next to
  the component that renders them.
- **Decision**: FIXED — the three `*_LABELS` maps moved to `inventory-panel.tsx`; `types.ts`
  keeps the enums, types, and `DEFAULT_RECIPE_PARAMS`.

### F8 — Model-response parse failures leak raw Zod issues into the user's toast

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/recipe.service.ts:150`
- **Detail**: `GeneratedRecipeSchema.parse(JSON.parse(content))` uses `parse`, not
  `safeParse`. A malformed model payload throws a `SyntaxError` or `ZodError`; both are
  `instanceof Error`, so `generate.ts:65` puts the full serialized issue array into the
  response body, `use-recipe-generation.ts:34` rethrows it, and `inventory-panel.tsx:57`
  renders it as a red toast. Pre-existing, but this change adds a second throw path with
  internal wording ("Model ignored all at-risk products — inventory guardrail violated")
  that reaches the user the same way. The plan explicitly accepted that one
  (`plan.md:118`: "the throw surfaces as a 500 toast and the user retries"), so this is a
  note on the shared surface, not a deviation.
- **Fix**: Use `safeParse`, log the raw content server-side as line 139 already does for
  OpenRouter failures, and throw a controlled user-facing message.
- **Decision**: SKIPPED — error surface left as-is.

## Success criteria verification (this review)

| Criterion | Result |
|---|---|
| 1.1 / 2.1 / 3.1 `npm run typecheck` | PASS — 42 files, 0 errors, 0 warnings |
| 1.2 / 2.2 / 3.2 `npm run lint` | PASS — no violations |
| 1.3 / 2.3 / 3.3 `npm run build` | PASS — server built, complete |
| 2.4 all-`"any"` byte identity | PASS — reproduces `dce174a` `SYSTEM_PROMPT` exactly |
| 1.4, 1.5, 2.5–2.8 (curl) | NOT RUN — needs a dev server and a session cookie |
| 1.7–1.11, 2.9–2.13, 3.4–3.13 (manual) | NOT RUN — see F2 |
| 1.12 (checked) | No diff-level evidence; inherently a human judgement |

## Triage (2026-08-14)

| Finding | Decision |
|---|---|
| F1 — Variety vs. at-risk floor | FIXED |
| F2 — runtime criteria unverified | SKIPPED |
| F3 — unescaped product names | FIXED |
| F4 — file naming | SKIPPED |
| F5 — approve blast radius | SKIPPED |
| F6 — optional `params` | SKIPPED |
| F7 — label maps in `types.ts` | FIXED |
| F8 — raw Zod issues in toast | SKIPPED |

Post-fix verification: `npm run typecheck` (42 files, 0 errors), `npm run lint` (clean), and
criterion 2.4 re-run — all-`"any"` still reproduces the `dce174a` `SYSTEM_PROMPT` byte for
byte, since the F1 edit touches only the both-pinned branch.

F2 remains open by decision: no runtime or manual criterion has been exercised, so the
guardrails added in Phase 1 and the parameter behaviour in Phase 3 are still unverified
against a live model.
