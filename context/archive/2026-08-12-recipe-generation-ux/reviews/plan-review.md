<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Recipe Generation UX

- **Plan**: `context/changes/recipe-generation-ux/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-12
- **Verdict**: REVISE → **SOUND** (all 8 findings fixed, 2026-08-12)
- **Findings**: 2 critical, 4 warnings, 2 observations — all triaged and fixed

## Verdicts

| Dimension             | Before triage | After fixes |
| --------------------- | ------------- | ----------- |
| End-State Alignment   | WARNING       | PASS        |
| Lean Execution        | WARNING       | PASS        |
| Architectural Fitness | PASS          | PASS        |
| Blind Spots           | FAIL          | PASS        |
| Plan Completeness     | WARNING       | PASS        |

## Grounding

6/6 paths ✓, 11/11 symbols & line refs ✓, brief↔plan ✓, Progress↔Phase contract ✓ (3 phases, 32 steps, all matched), S-03 collision claim verified ✓ (additive in both shared files).

## Findings

### F1 — Removing the at-risk filter converts an enforced invariant into a hope

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1–2
- **Detail**: Today `generate.ts:43` passes only at-risk products, so the guardrail at `recipe.service.ts:154-157` (`used_product_ids ⊆ promptProducts`) _structurally guarantees_ FR-007's "the recipe must include at least one at-risk product" — the model cannot name a non-at-risk ID because it never sees one. Phase 1 widens `promptProducts` to the full inventory, so the same check now passes for a recipe using zero at-risk products. The requirement degrades from enforced to prompt-suggested, with nothing detecting the failure. The plan spotted one instance of this hazard (truncation, §Critical Implementation Details, "silently breaks the PRD's Primary criterion with no error anywhere") but not the general case. §What We're NOT Doing excuses "no verification that the model honoured the parameters" — the at-risk floor is not a parameter, it is the PRD's Primary success criterion and the roadmap's stated S-04 risk. Verification is one manual eyeball (1.7) plus one under time pressure (2.12).
- **Fix A ⭐ Recommended**: Add an at-risk-inclusion assertion beside the ID guardrail — when at-risk products were passed, require `used_product_ids ∩ atRiskIds ≠ ∅`, otherwise throw the way the ID check does.
  - Strength: Restores enforcement at the same place the sibling invariant already lives (`recipe.service.ts:154-157`); ~5 lines; makes 1.7 / 1.12 / 2.12 automatic.
  - Tradeoff: A throw surfaces as a 500 toast; the user retries. On a tight `time: "15"` + slow at-risk item, that path may fire more than occasionally.
  - Confidence: HIGH — the guardrail pattern, the throw path, and the toast plumbing all exist and are unchanged by this plan.
  - Blind spot: Failure rate under tight constraints is unmeasured; a single silent retry before throwing may be the better shape but adds latency to a 27s baseline.
- **Fix B**: Accept the softening; add an explicit decision record.
  - Strength: Zero code; the PRD is honoured in intent, and §Business Logic's "a floor, not a ceiling" is about scope, not enforcement mechanism.
  - Tradeoff: The one guarantee the product is built on becomes unmonitored, and the next audit re-discovers it.
  - Confidence: MEDIUM — defensible, but trades away a guarantee the code currently gets for free.
  - Blind spot: No telemetry exists to notice if this degrades.
- **Decision**: FIXED via Fix A — at-risk inclusion assertion added to Phase 1 §1 contract, `What We're NOT Doing` amended, criteria 1.7 and 2.12 reworded to reflect enforcement.

### F2 — Response schema still tells the model to return only at-risk IDs

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (unlisted surface)
- **Detail**: `RESPONSE_FORMAT` at `recipe.service.ts:62` describes the field as "IDs of the **at-risk** products used in this recipe". Phase 1's contract covers the product-list rendering and the user turn but never mentions `RESPONSE_FORMAT`. Two consequences: (a) a recipe that uses non-at-risk products is instructed not to report their IDs — `approve_recipe` deletes exactly the reported IDs, so consumed products stay in the inventory and FR-008's "will remove from inventory" list (`inventory-panel.tsx:257-263`) under-reports; (b) when no at-risk products exist — the case Phase 1 exists to enable — the field description names an empty set while `GeneratedRecipeSchema` requires `min(1)` UUIDs, so invented IDs hit the guardrail and return 500, making criterion 1.4 flaky rather than failing cleanly.
- **Fix**: Add `RESPONSE_FORMAT` to Phase 1's changed surfaces — reword the description to "IDs of the products from the provided list that this recipe uses" — and note it applies whether or not at-risk products are present.
- **Decision**: FIXED — `RESPONSE_FORMAT` added to Phase 1 §1 as a required changed surface, with both failure modes recorded.

### F3 — The few-shot pair contradicts the chosen technique and method

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2
- **Detail**: Phase 2 templates `SYSTEM_PROMPT` but leaves `FEW_SHOT_USER` and `FEW_SHOT_ASSISTANT` (`recipe.service.ts:25-38`) untouched — and the plan never mentions them. They sit _between_ the system prompt and the real user turn, and they demonstrate frying ("fry for 6 minutes") in a skillet, framed as "prioritizes using these **at-risk** ingredients". With `technique: "no-cook"` the model gets an abstract rule saying don't cook and a concrete worked example that fries; with `method: "soup"`, a worked example that is a skillet dish. This is the exact failure mode §Critical Implementation Details warns about ("two conflicting instructions… it follows the first"), and the plan's defence against it only covers `SYSTEM_PROMPT`. A demonstration is typically a stronger signal than a rule. Separately, in Phase 1 with no at-risk products, the few-shot user turn still says "at-risk ingredients" while the real turn does not.
- **Fix A ⭐ Recommended**: Neutralise the few-shot and widen the byte-identity test — reword `FEW_SHOT_USER` to drop "at-risk", keep the assistant example purely format-anchoring, and make criterion 2.4 cover the whole `messages` array rather than just the system string.
  - Strength: The `messages` array is what actually determines whether Any/Any/Any reproduces Phase 1; the format-anchoring comment at lines 22-24 shows the example was already built to be content-neutral.
  - Tradeoff: Changing the few-shot in Phase 1 means Phase 1's own output is no longer byte-comparable to today's, blurring the attribution the phase order was designed to protect. Do it in Phase 1 and re-baseline there.
  - Confidence: MEDIUM — the intent is documented in the code, but the model's actual sensitivity is unmeasured.
  - Blind spot: Whether the free-tier model weights the demonstration over the rule has not been tested on this model.
- **Fix B**: Leave the few-shot; add a conditional override line for `no-cook`.
  - Strength: Minimal edit; touches only the pairing where the conflict is a hard contradiction rather than a nudge.
  - Tradeoff: Patches the symptom — `method: "soup"` and `method: "salad-assembly"` keep the same contradiction in weaker form.
  - Confidence: MEDIUM — narrow enough to be safe, not general enough to close the class.
  - Blind spot: Same measurement gap as A.
- **Decision**: FIXED via Fix A — Phase 1 split into step A (few-shot neutralisation, new §1) and step B (§2–4) to preserve attribution; new criterion 1.12 gates step A; criterion 2.4, §Critical Implementation Details, and §Testing Strategy widened from the system string to the whole `messages` array.

### F4 — Phase 2's load-bearing acceptance test has no runnable path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2, criterion 2.4 / §Testing Strategy
- **Detail**: The plan calls byte-identity "the acceptance test for this function" and suggests verifying it "by a throwaway node script". That script cannot exist as described: `recipe.service.ts:3` imports `astro:env/server`, a virtual module Astro resolves only inside its own build — the sibling S-03 plan documents this exact constraint and its `ServerOnlyModule` error (`context/changes/recipe-history/plan.md:93`). The contract also does not say `buildSystemPrompt` is exported. And the comparison target disappears: once Phase 2 lands, the pre-change `SYSTEM_PROMPT` is gone from the file, and the plan does not tell the implementer to capture a baseline first.
- **Fix A ⭐ Recommended**: Put the prompt builder in its own import-safe module, `src/lib/services/recipe-prompt.ts`, with no `astro:env` import.
  - Strength: A plain node script can load it, making 2.4 genuinely runnable and repeatable; mirrors the placement reasoning S-03 already applied to `RECIPES_PAGE_SIZE`.
  - Tradeoff: A fifth touched file, and one more merge surface alongside S-03.
  - Confidence: HIGH — the constraint and the precedent are both documented in this repo.
  - Blind spot: None significant.
- **Fix B**: Keep it in place; diff runtime output against a git baseline captured with `git show HEAD:src/lib/services/recipe.service.ts`.
  - Strength: No new file.
  - Tradeoff: Manual and re-run-hostile; nobody repeats it after a later prompt edit.
  - Confidence: HIGH that it works once; LOW that it survives.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Phase 2 §2 retargeted to a new `src/lib/services/recipe-prompt.ts` (builder + few-shot constants, no `astro:env` import), with an explicit baseline-capture step, an export contract, and an updated Parallel Work Collision table.

### F5 — `time: "90"` silently loosens a cap the plan says stays intact

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1, time enum
- **Detail**: The framing throughout is that this slice "does not _add_ constraints, it makes existing ones user-controlled" (§Overview) and that the 45-minute cap stays intact (brief, `Any` semantics row). But `90` is not an existing constraint made selectable — it _relaxes_ a shipped product rule, and it inverts the control: a dropdown labelled "available time" where picking a larger number grants the model more latitude than the default. A user selecting "≤90 min" gets a recipe the product previously refused to produce. §What We're NOT Doing explicitly protects the equipment rule from loosening but says nothing about the time rule.
- **Fix A ⭐ Recommended**: Cap the enum at 45 (`any` / `15` / `30` / `45`).
  - Strength: Keeps the slice's stated framing exactly true; every value narrows, none widens; 5→4 values costs nothing.
  - Tradeoff: Loses the one value that serves a user with real time available.
  - Confidence: HIGH — consistent with the plan's own thesis and the NFR's "practically usable" framing.
  - Blind spot: Whether users actually want a longer option is unknown.
- **Fix B**: Keep 90; record it as a deliberate relaxation and correct the framing in §Overview and the brief.
  - Strength: More user value; 90 minutes is still home cooking, not a professional-equipment violation of the NFR.
  - Tradeoff: Requires edits in two documents or the next reviewer flags it again.
  - Confidence: MEDIUM — defensible product call, not a plan defect.
  - Blind spot: Longer recipes mean longer outputs against a 30s timeout — untested, though the interaction is likely nil.
- **Decision**: FIXED via Fix A — time enum capped at `any` / `15` / `30` / `45`, with the reasoning recorded in Phase 2 §1 and a matching `What We're NOT Doing` entry. The brief needed no edit (it never listed `90`).

### F6 — `params` cannot be a `useCallback` dependency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1
- **Detail**: The contract says `generate(params: RecipeParams)` — "Add `params` to the `useCallback` dependency list." `params` is an argument of the memoised function, not a value closed over from `use-recipe-generation.ts`'s scope; putting it in the dep array is `Cannot find name 'params'` and fails criterion 3.1. The dep list stays `[seenTitles]` (line 43).
- **Fix**: Strike the dependency sentence; state that deps are unchanged because params arrive as an argument.
- **Decision**: FIXED — Phase 3 §1 contract now states the dep list stays `[seenTitles]`, with the typecheck consequence noted.

### F7 — Technique and method enums are not orthogonal

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 §1
- **Detail**: The brief justifies the method values as reusing "the dish formats the existing Variety rule names". That rule names soup / stir-fry / bake / salad / omelette (`recipe.service.ts:20`); the enum ships one-pot, sheet-pan, stovetop-only, salad-assembly, soup — three of five are new vocabulary, while stir-fry and bake landed in _technique_ instead. The result is that the two dimensions collide: `stovetop-only` + `bake`/`roast` is a flat contradiction, `sheet-pan` + `boil-simmer` likewise. §What We're NOT Doing accepts nonsensical pairings, but these are adjacent everyday choices, not exotic ones — roughly a third of the 8×6 grid is self-contradicting.
- **Fix**: Drop `stovetop-only` (it restates a technique, not a dish format) and correct the brief's provenance claim.
- **Decision**: FIXED — `stovetop-only` removed from the method enum (now 8 × 5 × 4), reasoning recorded in Phase 2 §1, and the brief's "no new vocabulary invented" claim corrected.

### F8 — Empty inventory reintroduces an inventory-state block

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2
- **Detail**: Phase 1 quotes §Business Logic — "Recipe generation is never blocked by inventory state" — to justify deleting the 400 gate, then adds a new 400 keyed on inventory state (`products.length === 0`). The call is right (a recipe from nothing is not a request), and the UI hides the button so it is only reachable by direct API call, but the plan presents the rule and the exception one paragraph apart without naming the exception as such.
- **Fix**: Add one line stating this is a deliberate, documented narrowing of the §Business Logic rule, so a later FR-007 audit doesn't re-open it.
- **Decision**: FIXED — Phase 1 §3 now names the empty-inventory `400` as a deliberate, narrow exception and explains why it is not the defect this phase removes.
