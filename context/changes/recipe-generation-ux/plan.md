# Recipe Generation UX Implementation Plan

## Overview

Let the user choose three recipe parameters — cooking **technique**, **method** (dish format), and **available time** — before generating, and have the AI honour them. Along the way, align the generate path with **FR-007**, which it currently violates: today the AI receives only at-risk products and generation is blocked entirely with a `400` when no product is at risk.

This is roadmap slice **S-04**. The framing that matters: the three parameters already exist in the codebase — as hardcoded constants inside `SYSTEM_PROMPT`. This slice does not *add* constraints, it makes existing ones **user-controlled**.

## Current State Analysis

The generate path is four layers deep and each one is currently parameter-blind:

| Layer | File | Current shape |
| --- | --- | --- |
| UI | `src/components/inventory/inventory-panel.tsx:194-209` | Generate button renders only when `products.some(p => p.is_at_risk)`. No parameter UI. |
| Hook | `src/components/hooks/use-recipe-generation.ts:16` | `generate()` takes no arguments; posts only `excludeTitles`. |
| Endpoint | `src/pages/api/recipes/generate.ts:12-14, 42-49` | Zod schema validates `excludeTitles` only. Filters to `atRiskProducts`, returns `400 "No at-risk products"` when the list is empty. |
| Service | `src/lib/services/recipe.service.ts:13-20, 87-96` | `SYSTEM_PROMPT` is a module-level `const` string hardcoding the technique whitelist and a 45-minute cap. `generateRecipe(atRiskProducts, excludeTitles)`. |

Three constraints are already baked into `SYSTEM_PROMPT` (`recipe.service.ts:13-20`):

- **Techniques**: `sauté, boil, roast, bake, simmer, fry, stir-fry` — allowed; `sous-vide, fermentation, dehydrating, smoking, pressure cooking` — forbidden.
- **Equipment**: stovetop, oven, one pot, one pan, knife, cutting board.
- **Time**: total prep + cook must not exceed 45 minutes.

The FR-007 deviation is documented nowhere as deliberate. The archived S-02 plan lists it as a success criterion (`context/archive/2026-06-05-recipe-generation-loop/plan.md:277`: *"returns 400 `{ error: "No at-risk products" }` when no at-risk products exist"*), so it shipped as designed — but the design contradicts the PRD:

> FR-007: *"The AI always receives the full inventory. … When no at-risk products exist, the recipe is generated freely from the full inventory."*
> §Business Logic: *"Recipe generation is never blocked by inventory state — an empty at-risk window is not an error."*

### Key Discoveries

- **`SYSTEM_PROMPT` must become a template, not gain an appendix** (`recipe.service.ts:13-20`). Appending "use sauté" while line 14 still lists all seven techniques as equally allowed produces a contradictory prompt. The technique and time lines have to be *rewritten* per request.
- **`MAX_PROMPT_PRODUCTS = 25` becomes a correctness hazard** (`recipe.service.ts:11, 93`). Today it slices an all-at-risk list, so truncation is harmless. Once the full inventory is passed, an unsorted slice can drop at-risk products entirely — silently breaking the PRD's Primary success criterion. Products must be ordered at-risk-first *before* slicing.
- **The existing guardrail validates IDs, not constraints** (`recipe.service.ts:154-157`). It throws when the model returns an unknown product ID. There is no equivalent check that the recipe respects the time limit or the chosen technique — and none is being added (see What We're NOT Doing).
- **The sibling form in the same component uses native inputs, not shadcn** (`inventory-panel.tsx:119-145`). Raw `<input>` with inline Tailwind classes. `src/components/ui/` contains only `button`, `alert-dialog`, `sonner`.
- **shadcn in this repo imports from the unified `radix-ui` package** (`alert-dialog.tsx:2`), not `@radix-ui/react-*`. Relevant only if a future change adds a shadcn Select; this plan does not.
- **`listProducts` already returns `is_at_risk` per product** (`product.service.ts:22-25`), computed from `AT_RISK_DAYS = 3`. No new at-risk logic is needed anywhere.
- **No test runner exists in this repo.** Verification is `typecheck` / `lint` / `build` plus manual steps and curl.

## Desired End State

On `/inventory`, three dropdowns sit above the Generate button, each defaulting to **Any**. The user picks any combination, clicks Generate, and receives a recipe that honours those choices while still prioritising at-risk products. The button is present whenever there is at least one product in the inventory, regardless of at-risk status.

Verified by: generating with an inventory containing **zero** at-risk products (previously impossible), and generating with `Time = ≤15 min` against an inventory whose at-risk item is a root vegetable — confirming the recipe still includes the at-risk item even though it strains the time budget.

## What We're NOT Doing

- **No server-side verification that the model honoured the parameters.** There is no reliable way to check "is this recipe really under 15 minutes" without a second model call. Post-generation checks stay limited to the two ID-level guardrails at `recipe.service.ts:154-157`: unknown IDs (existing) and at-risk inclusion (added in Phase 1). The at-risk floor is deliberately *not* treated as one of the parameters — it is the PRD's Primary success criterion, so it is enforced, not suggested.
- **No storage of parameters on the recipe row.** No migration, no change to the `approve_recipe` RPC, no new columns. Parameters are generation-time only.
- **No persistence of choices across reloads.** No localStorage, no user-preferences table.
- **No free-text parameter input.** Closed enums only — the injection reasoning already written at `generate.ts:11` applies.
- **No conflict pre-detection** (e.g. warning that `No-cook` + `Soup` is nonsensical). Nonsensical pairings are selectable; the model handles them or produces something odd.
- **No loosening of the equipment rule.** Stovetop, oven, one pot, one pan stays fixed — it is not one of the three parameters.
- **No loosening of the 45-minute cap.** The time parameter only narrows it. Values above 45 are out of scope for this slice.
- **No changes to the approve path.** `POST /api/recipes/approve`, `approveRecipe()`, and the atomicity guardrail are untouched.
- **No shared-navigation or Topbar refactor.**
- **No test framework.** Module 3 territory.

## Implementation Approach

**Separate the behaviour changes in time so a quality regression is attributable.** Phase 1 changes *what the model sees*, in two ordered steps (below). Phase 2 changes *how the prompt is written* (template instead of constant) with `Any` on all three parameters reproducing the end-of-Phase-1 messages verbatim. Phase 3 exposes the controls.

Phase 1 is split because it now makes two independent prompt changes:

- **Step A — neutralise the few-shot example.** Remove the technique and at-risk signals from the demonstration pair, changing nothing else. Verify recipe quality holds. This becomes the new baseline.
- **Step B — widen the product list.** Pass the full inventory with at-risk products flagged and prioritised. Compare quality against the step-A baseline, not against pre-change `main`.

That ordering means: after step A you confirm the demonstration was genuinely format-anchoring; after step B you confirm quality holds with a wider ingredient list; after Phase 2, `Any/Any/Any` must produce a `messages` array indistinguishable from the end of Phase 1 — any drift is a templating bug, not a model-behaviour question. Only Phase 3 lets a user actually change anything.

Bottom-up within each phase: types → service → endpoint → hook → UI.

## Critical Implementation Details

**At-risk-first ordering before truncation.** `MAX_PROMPT_PRODUCTS` slices the product list at `recipe.service.ts:93`. Once Phase 1 passes the full inventory, that slice must be applied to a list already sorted at-risk-first, or a user with 30 products can have every at-risk item truncated out of the prompt — the model then cannot include one, and the PRD's Primary success criterion fails silently with no error anywhere. Sort, then slice.

**The prompt's technique and time lines are rewritten, not extended.** `SYSTEM_PROMPT` lines 14 and 16 enumerate the allowed techniques and state the 45-minute cap. A parameter selection must replace those lines. Appending a preference below a rule that contradicts it gives the model two conflicting instructions, and the observed failure mode is that it follows the first.

**`Any` must render the end-of-Phase-1 text exactly.** The Phase 2 acceptance test is that `Any/Any/Any` produces a `messages` array byte-identical to the one Phase 1 leaves behind. Build the template so that is structurally guaranteed rather than eyeballed. Note the comparison target is the *post-Phase-1* prompt, not pre-change `main` — step A deliberately edits the few-shot.

**The few-shot pair is part of the prompt contract.** `FEW_SHOT_USER` / `FEW_SHOT_ASSISTANT` (`recipe.service.ts:25-38`) sit between the system rules and the real user turn. Today the pair demonstrates pan-frying ("fry for 6 minutes", "Skillet" in the title) and frames the ingredients as "at-risk". Both signals become contradictions once parameters exist: `technique: "no-cook"` pairs an abstract don't-cook rule with a worked example that fries, and `method: "soup"` with a worked example that is a skillet dish — the same "two conflicting instructions" failure this section warns about for `SYSTEM_PROMPT`, except a demonstration is typically the stronger signal. Any reasoning about prompt equivalence must cover the whole `messages` array, not the system string alone.

## Phase 1: FR-007 Alignment

### Overview

Neutralise the few-shot demonstration, then pass the full inventory to the model with at-risk products flagged, remove the generation block, and show the Generate button whenever any product exists. No parameters yet. Land §1 (step A) and confirm its quality check before starting §2–4 (step B).

### Changes Required

#### 1. Few-shot pair — remove technique and at-risk signals (step A)

**File**: `src/lib/services/recipe.service.ts`

**Intent**: Make the demonstration pair anchor answer *format* only, so it stops contradicting the parameters Phase 2 introduces and stops asserting an at-risk framing that the real user turn will sometimes omit.

**Contract**: Two edits, nothing else in this step.

- `FEW_SHOT_USER` (`recipe.service.ts:25-26`): drop "at-risk" from the framing — "Create a recipe using these ingredients: …". Keep the same deliberately-unusual ingredients, the same `(id: …)` rendering, and the same closing instruction about `used_product_ids`.
- `FEW_SHOT_ASSISTANT` (`recipe.service.ts:28-38`): keep the JSON shape, the ingredient list, the step-per-item structure, and both IDs. Rewrite the title so it does not name a vessel ("Skillet") and the instructions so they do not demonstrate a specific technique — today's *heat oil in a pan → fry for 6 minutes* is the strongest signal to remove.

Perfect technique-neutrality is not achievable — every recipe does something. The goal is removing the strong signals, not reaching zero. This extends the intent already documented in the comment at lines 22-24, which avoided anchoring *content* but not technique.

**Verification gate**: generate several recipes and confirm quality holds (criterion 1.12). The resulting `messages` array is the baseline that step B and Phase 2 compare against — capture it before proceeding.

#### 2. Recipe service — full inventory, at-risk flagged and prioritised (step B)

**File**: `src/lib/services/recipe.service.ts`

**Intent**: Accept the whole inventory rather than a pre-filtered at-risk list, mark which products are at risk inside the prompt so the model can prioritise them, and guarantee at-risk products survive truncation.

**Contract**: `generateRecipe(products: ProductWithRisk[], excludeTitles?: string[])` — the first parameter is now the full inventory, not a filtered subset. Before slicing to `MAX_PROMPT_PRODUCTS`, order at-risk products first. The rendered product list distinguishes the two groups. The user turn states at-risk inclusion as a requirement when at-risk products are present, and omits that requirement entirely when none are — matching §Business Logic's "generated freely from the full inventory with no prioritization constraint". The ID cross-check at the end validates against the sliced list as before.

**At-risk inclusion assertion (required).** Add a sibling check beside the ID cross-check at `recipe.service.ts:154-157`: when the sliced prompt list contained at least one at-risk product, `used_product_ids` must intersect the at-risk IDs — otherwise throw, exactly as an unknown ID does. When no at-risk products were sent, the check is skipped.

Rationale: today the endpoint passes an at-risk-only list, so "every returned ID was on the list I sent" *structurally* guarantees FR-007's at-risk floor — the model cannot name a non-at-risk ID because it never sees one. Widening `promptProducts` to the full inventory silently drops that guarantee: the same cross-check passes for a recipe using zero at-risk products, and nothing errors, logs, or notices. This assertion restores the floor as an enforced invariant rather than a prompt request, at the place its sibling invariant already lives.

Accepted cost: when the model genuinely cannot comply — a tight `time: "15"` against a slow-cooking at-risk item — the throw surfaces as a 500 toast and the user retries. If that proves to fire more than occasionally in Phase 2 manual testing (2.12), a single silent retry before throwing is the follow-up, weighed against the 27s baseline latency.

**`RESPONSE_FORMAT` field description (required).** Reword `used_product_ids.description` at `recipe.service.ts:62` from "IDs of the **at-risk** products used in this recipe" to "IDs of the products from the provided list that this recipe uses". The new wording is correct whether or not at-risk products are present.

Rationale: the old wording was accurate only while the prompt list *was* the at-risk list. Once the full inventory is passed it causes two failures. (a) A recipe using non-at-risk products is instructed not to report their IDs — but `approve_recipe` deletes exactly the reported IDs, so consumed products stay in the inventory and FR-008's "will remove from inventory" list (`inventory-panel.tsx:257-263`) under-reports. (b) With zero at-risk products — the case this phase exists to enable — the description names an empty set while `GeneratedRecipeSchema` requires `min(1)` UUIDs, so the model invents IDs, the guardrail throws, and criterion 1.4 becomes flaky rather than failing cleanly.

#### 3. Generate endpoint — drop the at-risk gate

**File**: `src/pages/api/recipes/generate.ts`

**Intent**: Stop rejecting requests when nothing is at risk; pass the full product list through.

**Contract**: Remove the `atRiskProducts` filter and the `400 "No at-risk products"` branch (lines 43-47). Pass `products` to `generateRecipe`. A genuinely empty inventory should still be rejected — a recipe from nothing is not a meaningful request — so return `400` with a distinct message when `products.length === 0`.

**This empty-inventory `400` is a deliberate, narrow exception** to §Business Logic's "recipe generation is never blocked by inventory state", recorded here so a later FR-007 audit does not read it as the same defect this phase removes. The rule exists to stop an *empty at-risk window* being treated as an error; it is not a claim that generation must succeed with nothing to cook. The UI hides the Generate button in this state (§4), so the branch is reachable only by direct API call.

#### 4. Inventory panel — unconditional Generate button

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Make the button's visibility match the endpoint's new precondition.

**Contract**: Replace the `products.some((p) => p.is_at_risk)` guard at line 194 with `products.length > 0`.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run build` passes
- `POST /api/recipes/generate` with a session cookie and an inventory containing **no** at-risk products returns `200` with a recipe
- `POST /api/recipes/generate` with an empty inventory returns `400`
- `POST /api/recipes/generate` still returns `401` without an auth cookie

#### Manual Verification

- With at least one at-risk product, the returned recipe still includes an at-risk product in `used_product_ids` — now enforced by the inclusion assertion, so a violation throws rather than returning a quietly wrong recipe
- With an inventory of 26+ products where only the last few are at-risk, the generated recipe still uses an at-risk product — confirms the sort-before-slice fix
- The Generate button is visible on `/inventory` with only non-at-risk products present
- The Generate button is absent when the inventory is empty
- Recipe quality is unchanged from before the phase — recipes remain practical and cookable per the NFR
- **Step A gate** — after the few-shot edit alone, recipe quality holds and the returned dishes are not skewed toward pan-fried skillet dishes; verify before starting step B

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Parameter Plumbing (Server)

### Overview

Introduce the parameter vocabulary as shared types, validate it at the endpoint, and convert `SYSTEM_PROMPT` from a constant into a template function. Fully testable by curl with no UI.

### Changes Required

#### 1. Shared parameter vocabulary

**File**: `src/types.ts`

**Intent**: Define the three enums once, as the single source of truth consumed by the zod schema, the prompt builder, and the select options. Per CLAUDE.md, shared types live here.

**Contract**: Three exported `as const` arrays with `"any"` as the first member of each, plus derived union types and a `RecipeParams` interface:

| Dimension | Values |
| --- | --- |
| `technique` | `any`, `saute`, `roast`, `bake`, `boil-simmer`, `stir-fry`, `fry`, `no-cook` |
| `method` | `any`, `one-pot`, `sheet-pan`, `salad-assembly`, `soup` |
| `time` | `any`, `15`, `30`, `45` |

Each value needs both a wire token (above) and a human label for the UI; keep the label mapping alongside the enum so the UI does not re-derive it. `RecipeParams` has all three fields required — the UI always sends all three, defaulting to `"any"`.

**`stovetop-only` is deliberately absent from `method`.** It restates a *technique* restriction rather than naming a dish format, which puts it in direct collision with the technique enum — `stovetop-only` + `bake`/`roast` is a flat contradiction. The two dimensions are meant to be orthogonal; every remaining method value names a dish format that any technique can plausibly produce. Note also that the method values are **not** a straight reuse of the Variety rule's list (`recipe.service.ts:20`: soup / stir-fry / bake / salad / omelette) — `stir-fry` and `bake` live in the technique enum instead, and `one-pot` / `sheet-pan` are new vocabulary. Correct the provenance claim in `plan-brief.md` accordingly. Residual contradictions (e.g. `sheet-pan` + `boil-simmer`) remain selectable per §What We're NOT Doing.

**The time enum stops at 45 deliberately.** `45` is the cap already shipped in `SYSTEM_PROMPT` line 16, so every selectable value is equal to or tighter than today's behaviour — consistent with §Overview's "this slice does not *add* constraints, it makes existing ones user-controlled". A `90` value would be the one option that *relaxes* a shipped product rule, and it inverts the control's meaning: a dropdown labelled "available time" where a larger number grants the model more latitude rather than telling it the user has more time. Loosening the cap is a product decision for a later slice, not a side effect of adding a control — the same reasoning §What We're NOT Doing applies to the equipment rule.

#### 2. Prompt template — extracted to its own module

**File**: `src/lib/services/recipe-prompt.ts` (new), consumed by `src/lib/services/recipe.service.ts`

**Intent**: Replace the `SYSTEM_PROMPT` constant with a function that renders the technique, method, and time rules according to the supplied parameters, so a selection *rewrites* the corresponding rule rather than appending to it — and put it somewhere the acceptance test can actually reach.

**Why a new file.** `recipe.service.ts:3` imports `OPENROUTER_API_KEY` from `astro:env/server`, a virtual module Astro resolves only inside its own build. A plain node script importing that file fails with `ServerOnlyModule` before reaching any prompt code — the sibling S-03 plan documents this exact constraint and error (`context/changes/recipe-history/plan.md:93`) and moved a constant out for the same reason. Without the extraction, criterion 2.4 has no runnable path.

**Contract**: `recipe-prompt.ts` exports `buildSystemPrompt(params: RecipeParams): string`, plus the `FEW_SHOT_USER` / `FEW_SHOT_ASSISTANT` constants moved verbatim from `recipe.service.ts:25-38` as step A left them. **No `astro:env` import in this file** — that is the property the whole extraction exists to preserve, so keep it free of runtime config. `recipe.service.ts` imports all three and keeps `RESPONSE_FORMAT`, `GeneratedRecipeSchema`, the fetch, and the guardrails. `generateRecipe` gains a `params` argument and passes it to `buildSystemPrompt`.

**Baseline capture**: before editing, save the end-of-Phase-1 `messages` array to a scratch file. Phase 2 deletes the text criterion 2.4 compares against, so without a saved copy the comparison target is gone. `git show HEAD:src/lib/services/recipe.service.ts` recovers it if this is missed.

Rendering rules — these are the load-bearing part of the phase:

- **`technique: "any"`** → emit the current line 14 verbatim, including the full allowed list and the "Never:" clause.
- **`technique: <value>`** → emit a line naming that technique as the required primary cooking technique, retaining the same "Never:" clause. `no-cook` states that the dish must require no cooking at all.
- **`method: "any"`** → emit no method line.
- **`method: <value>`** → emit a line requiring that dish format.
- **`time: "any"`** → emit the current line 16 verbatim (45-minute cap).
- **`time: <n>`** → emit the same line with `n` substituted.
- The Techniques/Equipment/Time/Pantry/Never-ask/`used_product_ids`/Variety rules keep their current order and wording otherwise.

**The acceptance test for this function is that `Any/Any/Any` reproduces the end-of-Phase-1 `messages` array byte-identically** — the system string from `buildSystemPrompt({ technique: "any", method: "any", time: "any" })`, the few-shot pair as step A left it, and the user turn. Structure the template so the system-string half holds by construction; the few-shot half holds because this phase does not touch it. Comparing the system string alone is insufficient: the few-shot pair is two of the four messages and carries its own technique and framing signals.

#### 3. Endpoint validation

**File**: `src/pages/api/recipes/generate.ts`

**Intent**: Accept and validate the three parameters, rejecting anything outside the enums before it reaches the prompt.

**Contract**: Extend `generateSchema` with three `z.enum(...)` fields built from the `src/types.ts` const arrays, each `.default("any")` so a body omitting them stays valid — this keeps the Phase 1 curl calls and any in-flight client working. Pass the parsed params to `generateRecipe`.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run build` passes
- With all three set to `"any"`, the assembled `messages` array is identical to the saved end-of-Phase-1 baseline — system string, both few-shot messages, and the user turn. Verified by a node script importing `recipe-prompt.ts` directly (possible because that module has no `astro:env` import); no test runner exists
- `POST /api/recipes/generate` with no parameters in the body returns `200` (defaults applied)
- `POST /api/recipes/generate` with `{"technique":"stir-fry","method":"one-pot","time":"30"}` returns `200`
- `POST /api/recipes/generate` with `{"technique":"sous-vide"}` returns `400`
- `POST /api/recipes/generate` with `{"time":15}` (number, not string) returns `400`

#### Manual Verification

- A request with `time: "15"` returns a recipe whose steps are plausibly achievable in 15 minutes
- A request with `technique: "no-cook"` returns a recipe with no cooking step
- A request with `method: "soup"` returns a soup
- With at-risk products present and `time: "15"` selected, the recipe **still includes an at-risk product** — the priority decision holds under a tight constraint. The Phase 1 assertion makes the failure mode a 500 rather than a silently wrong recipe; note how often it fires, since this is the pairing most likely to trip it
- Recipes generated with all three on `Any` are indistinguishable in character from Phase 1 output

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Parameter Controls (UI)

### Overview

Surface the three parameters as native selects above the Generate button and thread the choices through the hook.

### Changes Required

#### 1. Hook accepts parameters

**File**: `src/components/hooks/use-recipe-generation.ts`

**Intent**: Let the caller specify parameters per generation request.

**Contract**: `generate(params: RecipeParams)` — previously zero-arg. The params go into the POST body alongside `excludeTitles`. The `useCallback` dependency list is **unchanged** at `[seenTitles]` (line 43): `params` arrives as an argument rather than being closed over from the hook's scope, so listing it as a dependency would reference a name that does not exist there and fail `typecheck` (criterion 3.1). Parameters are **not** stored in hook state; the component owns them, so a regenerate from the approval modal must pass the same values it used originally.

#### 2. Parameter controls

**File**: `src/components/inventory/inventory-panel.tsx`

**Intent**: Add the three dropdowns inline above the Generate button, holding the selection in component state.

**Contract**: One `useState<RecipeParams>` initialised to all-`"any"`. Three native `<select>` elements rendered from the const arrays and label maps in `src/types.ts` — styled with the same inline Tailwind classes as the add-product inputs at lines 119-145, each with a `<label htmlFor>` matching the existing form's a11y pattern. Disabled while `isGenerating || isApproving`.

Both call sites of `handleGenerate` — the main button at line 196 and **"Generate Different Recipe"** inside the approval modal at line 267 — pass the current params. The controls render in the same `products.length > 0` block as the Generate button, so they appear and disappear with it.

### Success Criteria

#### Automated Verification

- `npm run typecheck` passes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification

- Three dropdowns appear above the Generate button, each showing "Any" on load
- Selecting values and clicking Generate produces a recipe honouring them
- The dropdowns are disabled while a generation or approval is in flight
- "Generate Different Recipe" in the approval modal respects the same parameters as the original request
- Selections persist across a generate → cancel → generate cycle within one page visit
- A page reload resets all three to "Any" (expected — session-only by decision)
- Each select is reachable and operable by keyboard alone, and each has a visible label
- The controls disappear when the inventory is empty
- No console errors or React hydration warnings on `/inventory`
- Layout holds at mobile width — the controls do not overflow the panel

**Implementation Note**: This is the final phase. After automated verification passes, confirm the manual checks before closing the change.

---

## Testing Strategy

No test runner exists in this repo, so verification is static analysis plus curl plus manual browser testing.

### Endpoint tests (curl, authenticated session cookie)

- Empty body → `200`, defaults applied
- Each of the three enums with a valid non-`any` value → `200`
- Each of the three enums with an invalid value → `400`
- Wrong type (number where string expected) → `400`
- No at-risk products in inventory → `200` (the FR-007 fix)
- Empty inventory → `400`
- No auth cookie → `401`

### Prompt-template verification

The `Any/Any/Any` `messages` array must equal the end-of-Phase-1 baseline byte for byte — all four messages, not the system string alone. Capture the baseline to a scratch file at the end of Phase 1, then verify at the end of Phase 2, before touching the UI.

The check runs as a node script importing `src/lib/services/recipe-prompt.ts`. That module is deliberately free of `astro:env` imports so it loads outside an Astro build; keep it that way, and the check stays re-runnable after any future prompt edit rather than being a one-off.

### Manual scenarios

1. Inventory with only non-at-risk products → Generate is available and works.
2. Inventory with 26+ products, at-risk ones added last → generated recipe still uses an at-risk product.
3. `Time = ≤15 min` with a slow-cooking at-risk product → recipe still includes it; the time constraint bends, the at-risk guarantee does not.
4. `No-cook` + `Soup` (a nonsensical pairing) → the app returns *something* and does not crash.
5. Generate → "Generate Different Recipe" → confirm the second recipe honours the same parameters and is a different dish.
6. Keyboard-only pass over the three selects and the Generate button.

## Performance Considerations

Negligible. The parameters add a handful of tokens to a prompt that already carries the inventory, and no new network calls, queries, or renders of consequence. The one real risk is unchanged from S-02: free-tier OpenRouter latency was measured at 27s end-to-end (`context/archive/2026-06-05-recipe-generation-loop/change.md`, Phase 2 deviations), so the existing 30s `AbortSignal.timeout` stays as-is.

Note that Phase 1 *increases* prompt size — the full inventory rather than the at-risk subset — bounded by `MAX_PROMPT_PRODUCTS = 25`.

## Migration Notes

No database migration. No schema change. No change to the `approve_recipe` RPC.

The endpoint's new fields all carry `.default("any")`, so the change is backward-compatible with any client posting the old body shape — deployment order between server and client does not matter.

## Parallel Work Collision

S-03 (`recipe-history`, status `plan_reviewed`) is scheduled to run parallel with this slice and touches two of the same files:

| File | S-03 adds | S-04 (this plan) changes |
| --- | --- | --- |
| `src/lib/services/recipe.service.ts` | `listRecipes()` — a new function at the end | `generateRecipe`; `SYSTEM_PROMPT` and the few-shot constants move out to `recipe-prompt.ts` |
| `src/pages/inventory.astro` | A nav link to `/recipes` | Untouched by this plan |
| `src/lib/services/recipe-prompt.ts` | — | New file, created by this plan |

The additions are disjoint — different functions in `recipe.service.ts`, and this plan does not modify `inventory.astro` at all. Textual merge conflicts are possible in the service file's import block; semantic conflict is not expected. Neither plan changes `src/types.ts` in an overlapping way (S-03 adds a paged-recipes type, this adds parameter enums).

`recipe-prompt.ts` is a new file only this plan creates, so it cannot conflict. It does, however, delete a top-of-file region of `recipe.service.ts` that S-03 leaves alone — if S-03 merges first, expect a textual conflict confined to the import block rather than to `listRecipes()`.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-04
- PRD: `context/foundation/prd.md` — FR-007, FR-008, §Business Logic, §Non-Functional Requirements
- Prior slice (archived): `context/archive/2026-06-05-recipe-generation-loop/plan.md`, and its deviation log at `context/archive/2026-06-05-recipe-generation-loop/change.md`
- Parallel slice: `context/changes/recipe-history/plan.md`
- Lessons: `context/foundation/lessons.md` — the `user_id`-filter rule does not bind here (no new user-owned queries), but `listProducts` already complies
- Prompt constants being templated: `src/lib/services/recipe.service.ts:13-20`
- Truncation hazard: `src/lib/services/recipe.service.ts:11,93`
- Existing native-input form pattern to match: `src/components/inventory/inventory-panel.tsx:119-145`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: FR-007 Alignment

#### Automated

- [x] 1.1 `npm run typecheck` passes
- [x] 1.2 `npm run lint` passes
- [x] 1.3 `npm run build` passes
- [ ] 1.4 `POST /api/recipes/generate` returns 200 with an inventory containing no at-risk products
- [ ] 1.5 `POST /api/recipes/generate` returns 400 with an empty inventory
- [x] 1.6 `POST /api/recipes/generate` returns 401 without an auth cookie

#### Manual

- [ ] 1.7 Recipe still includes an at-risk product when at-risk products exist
- [ ] 1.8 With 26+ products and at-risk ones added last, the recipe still uses an at-risk product (sort-before-slice)
- [ ] 1.9 Generate button visible with only non-at-risk products present
- [ ] 1.10 Generate button absent when inventory is empty
- [ ] 1.11 Recipe quality unchanged from before the phase
- [x] 1.12 Step A gate — quality holds after the few-shot edit alone, no skew toward pan-fried skillet dishes

### Phase 2: Parameter Plumbing (Server)

#### Automated

- [ ] 2.1 `npm run typecheck` passes
- [ ] 2.2 `npm run lint` passes
- [ ] 2.3 `npm run build` passes
- [ ] 2.4 With all three `"any"`, the assembled `messages` array is identical to the end-of-Phase-1 baseline
- [ ] 2.5 `POST /api/recipes/generate` with no parameters returns 200 (defaults applied)
- [ ] 2.6 `POST /api/recipes/generate` with valid technique/method/time returns 200
- [ ] 2.7 `POST /api/recipes/generate` with an out-of-enum technique returns 400
- [ ] 2.8 `POST /api/recipes/generate` with a numeric `time` returns 400

#### Manual

- [ ] 2.9 `time: "15"` returns a recipe plausibly achievable in 15 minutes
- [ ] 2.10 `technique: "no-cook"` returns a recipe with no cooking step
- [ ] 2.11 `method: "soup"` returns a soup
- [ ] 2.12 At-risk product still included when `time: "15"` is selected
- [ ] 2.13 All-`Any` recipes indistinguishable in character from Phase 1 output

### Phase 3: Parameter Controls (UI)

#### Automated

- [ ] 3.1 `npm run typecheck` passes
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npm run build` passes

#### Manual

- [ ] 3.4 Three dropdowns appear above the Generate button, each showing "Any" on load
- [ ] 3.5 Selecting values and generating produces a recipe honouring them
- [ ] 3.6 Dropdowns disabled while generating or approving
- [ ] 3.7 "Generate Different Recipe" respects the same parameters
- [ ] 3.8 Selections persist across a generate → cancel → generate cycle
- [ ] 3.9 Page reload resets all three to "Any"
- [ ] 3.10 Selects are keyboard-operable and labelled
- [ ] 3.11 Controls disappear when the inventory is empty
- [ ] 3.12 No console errors or hydration warnings on `/inventory`
- [ ] 3.13 Layout holds at mobile width
