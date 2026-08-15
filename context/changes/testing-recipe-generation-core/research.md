---
date: 2026-08-15T16:10:07+0200
researcher: Kasia Sepiolo
git_commit: 9281bc1ee8dba82b1641f5de53ef358933f8224b
branch: feature/testing-recipe-generation-core
repository: zero-waste-chef
topic: "Test-plan §3 Phase 1 — runner bootstrap + recipe-generation core (Risks #1, #2, #6)"
tags: [research, testing, vitest, recipe-generation, at-risk, expiry, error-handling]
status: complete
last_updated: 2026-08-15
last_updated_by: Kasia Sepiolo
---

# Research: Test-plan §3 Phase 1 — runner bootstrap + recipe-generation core

**Date**: 2026-08-15T16:10:07+0200
**Researcher**: Kasia Sepiolo
**Git Commit**: `9281bc1`
**Branch**: `feature/testing-recipe-generation-core`
**Repository**: zero-waste-chef

## Research Question

Ground `context/foundation/test-plan.md` §3 Phase 1 in the live codebase. Phase 1
covers **Risk #1** (recipe uses no at-risk product), **Risk #2** (user told to cook
with an expired product) and **Risk #6** (generation failure surfaces as success or
an indefinite wait). Per §2 Risk Response Guidance, research must establish:

- **#1** — where at-risk marking is computed, what the outbound payload actually
  contains, and whether any post-response check exists today.
- **#2** — whether expiry deltas can go negative, and whether "expired" exists as a
  state distinct from "at-risk" anywhere today.
- **#6** — the error-translation path from the provider call to the HTTP response.

Plus the precondition: **there is no test runner in this project**, so Phase 1 must
also stand up the environment.

## Summary

Four findings drive the plan.

1. **Risk #1 is already structurally protected — and the protection is untested.**
   A post-response at-risk floor check exists at `recipe.service.ts:165–170`, and
   at-risk products are sorted ahead of the `MAX_PROMPT_PRODUCTS` cap
   (`recipe.service.ts:74–77`) so the cap cannot silently drop them. The risk is not
   "there is no guard" — it is "the guard is load-bearing, unverified, and one
   refactor from being removed." Phase 1's job is to pin it.

2. **Risk #2 is a live, confirmed defect, not a hypothetical.** `isAtRisk()`
   (`product.service.ts:6–11`) has **only an upper bound**. A product that expired a
   year ago returns `is_at_risk === true`, is sorted to the *front* of the prompt,
   and is rendered under the header *"At-risk ingredients (expiring soon) — the
   recipe must use at least one of these"*. The floor guard at `recipe.service.ts:165`
   then **rejects any recipe that avoids it**. The app does not merely tolerate
   expired food — it insists on it. There is no `expired` state anywhere in the
   codebase. *Verified empirically — see "Probe results" below.*

3. **Risk #6 is real and uniform: every failure class collapses to HTTP 500.**
   `generate.ts:64–67` is a single catch-all that returns `status: 500` with
   `err.message` verbatim. Rate limit, timeout, empty response, malformed JSON,
   schema violation, guardrail violation and raw PostgREST errors are
   indistinguishable to the client. Two of those paths put raw internal text in the
   user's toast: a `ZodError` dump (~700 bytes of JSON) and a `JSON.parse`
   `SyntaxError` quoting the model's prose. The good news: **the provider API key and
   the raw OpenRouter response body do not leak** — the body is `console.error`'d and
   a sanitised message is thrown (`recipe.service.ts:138–145`).

4. **The environment unknown is resolved: `getViteConfig()` will resolve
   `astro:env/server`.** Verified in the installed `astro@6.3.1` source —
   `getViteConfig()` calls `createVite()`, which registers the `astroEnv` virtual
   module plugin. This was the single biggest open question for Phase 1 and it does
   not need a spike.

The one **oracle gap** — what past-dated stock *should* do, which the PRD leaves
silent — was escalated rather than guessed, per CLAUDE.md's oracle rule, and has been
**resolved by the product owner**: expired products are excluded from the prompt
entirely and the user is informed, on two surfaces. See "Resolved Oracle" below; that
section, not the current implementation, is what Phase 1 asserts against.

## Detailed Findings

### Risk #2 — expired products (the headline finding)

`src/lib/services/product.service.ts:6–11`:

```ts
export function isAtRisk(expiryDate: string): boolean {
  const today = new Date();
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + AT_RISK_DAYS);
  return expiryDate <= threshold.toISOString().split("T")[0];
}
```

The comparison is one-sided. Every past date satisfies it.

**PRD oracle** (`prd.md:31`, `prd.md:98`): at-risk is *"the product(s) **expiring
within** 3 days from today's date"*. A product that expired yesterday is not
*expiring within* three days — it has already expired. The PRD's at-risk definition
therefore does **not** cover past-dated stock, and §Business Logic says nothing about
it. `test-plan.md:51` records this gap explicitly as the source of Risk #2.

**Blast radius through the generation path** — the defect does not stay local:

| Step | Location | Effect on an expired product |
|---|---|---|
| Marking | `product.service.ts:10` | `is_at_risk = true` |
| Ordering | `recipe.service.ts:74` | sorted **ahead** of fresh stock |
| Cap | `recipe.service.ts:77` | guaranteed to survive the 25-item slice |
| Prompt | `recipe.service.ts:91` | rendered under *"At-risk ingredients (expiring soon) — the recipe **must use at least one** of these"* |
| Post-response guard | `recipe.service.ts:165–170` | **throws** if the model sensibly avoided it |

The last row is the sting. The Risk #1 guardrail and the Risk #2 defect compose into
active harm: a user whose fridge contains one year-old yoghurt and ten fresh items
cannot get *any* recipe unless the model agrees to cook the yoghurt.

There is no `expired` concept in the codebase — confirmed by absence across
`src/types.ts` (`ProductWithRisk = Product & { is_at_risk: boolean }`, line 11), the
service layer, and the UI panels.

#### Probe results (`isAtRisk` under a real clock, today = 2026-08-15)

| Expiry offset | Date | `is_at_risk` | Correct per PRD |
|---|---|---|---|
| −365 d | 2025-08-15 | `true` | **no** — expired |
| −30 d | 2026-07-16 | `true` | **no** — expired |
| −1 d | 2026-08-14 | `true` | **no** — expired |
| 0 d | 2026-08-15 | `true` | yes |
| +1 d | 2026-08-16 | `true` | yes |
| +3 d | 2026-08-18 | `true` | yes (inclusive boundary) |
| +4 d | 2026-08-19 | `false` | yes |

Identical under `TZ=UTC` and `TZ=Europe/Warsaw` — the negative-delta defect is
**environment-independent**. The upper boundary (+3 inclusive / +4 exclusive) is
correct and matches the PRD's "within 3 days".

#### Secondary: a timezone off-by-one in the upper bound

`setDate()` operates in server-local time; `toISOString()` then re-projects to UTC.
When the two disagree about the calendar day, the window shifts:

| Server TZ | Local wall clock | Threshold produced | Should be | Effect |
|---|---|---|---|---|
| Europe/Warsaw | 2026-08-16 01:30 | `2026-08-18` | `2026-08-19` | window shrinks to 2 days |
| America/New_York | 2026-08-15 21:00 | `2026-08-19` | `2026-08-18` | window widens to 4 days |
| UTC | any | correct | correct | none |

Production runs on `workerd`, which is UTC (`infrastructure.md:10`), so **this does
not bite in production today** — it bites in `astro dev` on a non-UTC machine, and
would bite immediately on any non-UTC runtime. Lower priority than the negative-delta
defect, but it is the reason a Phase 1 test must run under a **pinned TZ and a frozen
clock** rather than the ambient one.

### Risk #1 — at-risk products reaching (and surviving) the model round-trip

Contrary to the risk's framing, a post-response check **does** exist. Three
mechanisms currently protect the at-risk floor:

1. **Stable sort before the cap** (`recipe.service.ts:74–77`). `MAX_PROMPT_PRODUCTS
   = 25`; sorting at-risk-first *before* slicing is what stops the cap from evicting
   every at-risk item. The code comment names this exact hazard. **This ordering is
   the whole guarantee and nothing enforces it** — a refactor that slices first
   reintroduces the original Risk #1 silently. Prime mutation-testing target.
2. **ID cross-check** (`recipe.service.ts:157–160`). Model-returned IDs must all be
   in the prompt set, else *"Model returned unknown product IDs — inventory guardrail
   violated"*.
3. **Explicit at-risk floor** (`recipe.service.ts:165–170`). If any at-risk product
   was sent, at least one returned ID must be at-risk, else *"Model ignored all
   at-risk products — inventory guardrail violated"*. The comment explains why this
   became necessary once the *full* inventory started being sent.

**Prompt assembly** (`recipe.service.ts:89–98`) matches FR-007 correctly: with
at-risk items present it emits a two-section user turn with an explicit "must use at
least one" clause; with none present it omits the prioritisation requirement entirely
rather than stating it over an empty list — exactly `prd.md:102` *"generated freely
from the full inventory"*.

**Injection defence** (`recipe.service.ts:84`): `sanitizeName` strips `[\r\n]+` and
truncates to 60 chars, which is what stops a user-supplied product name from forging
the `Other available ingredients:` header and demoting the at-risk section. Since the
user turn is newline-delimited and multi-section, this is load-bearing and worth a
test.

**A documented deviation from FR-007.** `prd.md:78` says *"The AI **always** receives
the full inventory."* `MAX_PROMPT_PRODUCTS = 25` truncates it. This is a deliberate
token-cost decision (comment at `recipe.service.ts:75–76`), not an oversight, but it
means the literal PRD wording is false for inventories over 25 items. The behaviour
that matters — at-risk items always survive — is preserved. Worth a test asserting
the *survival property*, not the cap number.

**`buildSystemPrompt` is cheaply testable.** `src/lib/services/recipe-prompt.ts` was
deliberately extracted to be free of `astro:env` imports (comment at lines 3–7), with
a type-only `@/types` import. Its own doc comment names its acceptance test:
`{ technique: "any", method: "any", time: "any" }` must reproduce the pre-parameter
system prompt **byte for byte** (lines 54–60). That is a pre-stated oracle handed to
us by the implementation author — the cheapest real signal in this whole phase.

### Risk #6 — the error-translation path

Full path, provider call → HTTP response:

| # | Failure | Where raised | Message thrown | HTTP status returned |
|---|---|---|---|---|
| 1 | Timeout (30 s) | `recipe.service.ts:132–134` | "Recipe generation timed out — try again" | **500** |
| 2 | 401 / 402 | `recipe.service.ts:60` | "Recipe service unavailable — try again later" | **500** |
| 3 | 429 rate limit | `recipe.service.ts:61` | "Rate limited — try again shortly" | **500** |
| 4 | other non-2xx | `recipe.service.ts:62` | "Recipe generation failed" | **500** |
| 5 | empty content | `recipe.service.ts:150` | "OpenRouter returned an empty response" | **500** |
| 6 | non-JSON body | `recipe.service.ts:154` (`JSON.parse`) | raw `SyntaxError` | **500** |
| 7 | schema violation | `recipe.service.ts:154` (`zod`) | raw `ZodError` JSON dump | **500** |
| 8 | unknown IDs | `recipe.service.ts:159` | "…inventory guardrail violated" | **500** |
| 9 | zero at-risk used | `recipe.service.ts:168` | "…inventory guardrail violated" | **500** |
| 10 | DB read failure | `product.service.ts:20` | raw PostgREST `error.message` | **500** |

Everything funnels through one catch-all:

```ts
// src/pages/api/recipes/generate.ts:64-67
} catch (err) {
  const message = err instanceof Error ? err.message : "Unknown error";
  return new Response(JSON.stringify({ error: message }), { status: 500 });
}
```

And the client surfaces `json.error` verbatim as the thrown message
(`use-recipe-generation.ts:32–35`), which the caller renders as a toast.

**What is safe.** The OpenRouter response body — which `recipe.service.ts:140–141`
notes carries account and quota metadata for the shared key — is `console.error`'d
and **never** returned to the client. `OPENROUTER_API_KEY` appears only in a request
header and in no error path. Risk #6's credential-leak half is genuinely handled.

**What is not.** Rows 6, 7 and 10 return raw internal text. Measured shapes:

- Row 7 (`ZodError.message`, zod 4.4.3) — a ~700-byte pretty-printed JSON array of
  issue objects, including the internal UUID regex `pattern`. This becomes the toast.
- Row 6 (`SyntaxError`) — e.g. `Unexpected token 'S', "Sorry, I c"... is not valid
  JSON`, echoing the model's refusal prose back through an error channel.
- Row 10 — raw PostgREST diagnostics, a *different* upstream leaking where the
  OpenRouter one was carefully suppressed.

Rows 8 and 9 return correct-but-internal jargon (*"inventory guardrail violated"*) to
an end user. Note row 9 is Risk #1's protection firing: **the detection is right, its
presentation is Risk #6's problem.** The two risks meet on that line.

**Status-code collapse is the core Risk #6 finding.** `test-plan.md:71` asks that
"rate limit, timeout, and malformed response each produce a **distinct** non-2xx."
Today they produce one indistinguishable 500. Nothing retries, no client logic can
branch, and 401/402 (a *configuration* fault) is reported identically to 429 (a
*transient* fault).

**Timeout mechanics verified.** `AbortSignal.timeout(30_000)` (`recipe.service.ts:110`)
rejects with a `DOMException` named `TimeoutError`. Probed on Node: `instanceof Error`
is `true` and `name === "TimeoutError"`, so the guard at `recipe.service.ts:132`
matches and the friendly message is produced. **Not verified under `workerd`** — see
Open Questions §1.

**One path escapes the catch-all entirely.** `context.request.json()` failure is
swallowed to `body = {}` (`generate.ts:31–38`) — deliberate, since a first generation
posts no body. Worth one test so the intent is pinned rather than rediscovered.

### Environment — what Phase 1 must stand up

**Current state: zero test infrastructure.** No `vitest.config.*`, no `*.test.ts` /
`*.spec.ts` anywhere outside `node_modules`, no test dependency in `package.json`, no
`test` script. CI (`.github/workflows/ci.yml`) runs `astro sync` → `lint` → `build`,
then auto-deploys to Cloudflare on `main`. Wiring the runner into CI is **Phase 4**,
not this phase (`test-plan.md:127`).

**Resolved: `astro:env/server` works under `getViteConfig()`.** Traced in the
installed `astro@6.3.1`:

- `node_modules/astro/dist/config/index.js:36` — `getViteConfig()` → `createVite()`
- `node_modules/astro/dist/core/create-vite.js:160` — `createVite()` registers
  `astroEnv({ settings, sync, envLoader })`, the `astro:env` virtual module plugin

So `recipe.service.ts` (which imports `OPENROUTER_API_KEY` from `astro:env/server` at
module top level, line 3) and `supabase.ts` (line 3) are importable in Vitest without
mocking the virtual module. All three env fields are `optional: true`
(`astro.config.mjs:17–21`), so an unset key resolves to `undefined` rather than
throwing — which is exactly right when the provider `fetch` is stubbed.

This directly contradicts the hazard logged at `infrastructure.md:89` (*"Tests or seed
scripts that import server modules will fail…"*). That warning applies to
`import { env } from "cloudflare:workers"`, which this codebase does not use.

**Version constraints, verified against npm today:**

| Item | Value | Source |
|---|---|---|
| `vitest@latest` | **4.1.10** | `npm view vitest dist-tags` |
| `getViteConfig()` minimum | Vitest **3.2** or **4.1**+ | Astro v6 upgrade guide (Context7) |
| Astro installed | 6.3.1 | `node_modules/astro/package.json` |
| Vite installed | 7.3.3 (`overrides: vite ^7.3.2`) | `package.json` |
| Required `test.environment` | `node` | Astro v6 no longer renders Astro components in client environments |

`4.1.10` satisfies the `getViteConfig()` floor. The test-plan's pin is correct.

**Endpoint tests must stub `@/lib/supabase`, not the database.** `generate.ts:23–26`
calls `createClient()`, which returns `null` when `SUPABASE_URL`/`SUPABASE_KEY` are
unset (`supabase.ts:6–8`) and short-circuits to **503 before any interesting code
runs**. With no env vars set, every endpoint test would assert 503 and prove nothing.
`test-plan.md:90` confirms Phase 1 does *not* depend on the local seed (only Phases 2
and 3 do), so the cheapest honest route is `vi.mock("@/lib/supabase")` plus a stubbed
`listProducts` — no `npx supabase db reset` in this phase at all.

**Two stub boundaries, both at the module edge** — consistent with `test-plan.md:101`
("stub at the module boundary", no MSW):

- `globalThis.fetch` for the OpenRouter call (it is a bare global `fetch`, trivially
  replaceable with `vi.stubGlobal`)
- `@/lib/supabase` / `@/lib/services/product.service` for inventory reads

## Code References

- `src/lib/services/product.service.ts:4` — `AT_RISK_DAYS = 3`
- `src/lib/services/product.service.ts:6-11` — `isAtRisk()`; **no lower bound** (Risk #2)
- `src/lib/services/product.service.ts:20` — raw PostgREST message thrown (leak path, row 10)
- `src/lib/services/recipe.service.ts:11-13` — model id, 30 s timeout, 25-product cap
- `src/lib/services/recipe.service.ts:59-63` — `openRouterErrorMessage()` status mapping
- `src/lib/services/recipe.service.ts:74-77` — at-risk-first sort **then** slice (Risk #1 guarantee)
- `src/lib/services/recipe.service.ts:84` — `sanitizeName` prompt-injection defence
- `src/lib/services/recipe.service.ts:89-98` — FR-007 two-branch user turn
- `src/lib/services/recipe.service.ts:110` — `AbortSignal.timeout(30_000)`
- `src/lib/services/recipe.service.ts:131-136` — timeout translation
- `src/lib/services/recipe.service.ts:138-145` — upstream body logged, **not** returned
- `src/lib/services/recipe.service.ts:154` — `JSON.parse` + `zod` (raw-message leak rows 6 & 7)
- `src/lib/services/recipe.service.ts:157-160` — unknown-ID cross-check
- `src/lib/services/recipe.service.ts:165-170` — **at-risk floor guard** (Risk #1)
- `src/lib/services/recipe-prompt.ts:3-7` — deliberately `astro:env`-free
- `src/lib/services/recipe-prompt.ts:54-60` — **pre-stated byte-identity oracle** for all-`any`
- `src/pages/api/recipes/generate.ts:15-20` — closed-enum zod schema (Risk #7, Phase 3)
- `src/pages/api/recipes/generate.ts:31-38` — unparseable body swallowed to `{}`
- `src/pages/api/recipes/generate.ts:55-57` — empty inventory → 400
- `src/pages/api/recipes/generate.ts:64-67` — **catch-all 500** (Risk #6)
- `src/lib/supabase.ts:6-8` — `null` when env unset → endpoint returns 503
- `src/components/hooks/use-recipe-generation.ts:32-35` — server `error` string surfaced verbatim
- `src/types.ts:11` — `ProductWithRisk`; no `expired` state anywhere
- `astro.config.mjs:17-21` — all three env fields `optional: true`
- `node_modules/astro/dist/core/create-vite.js:160` — `astroEnv` plugin registered by `createVite()`

## Architecture Insights

- **The guardrails are in the service, the translation is in the endpoint.** Domain
  invariants live in `recipe.service.ts` and signal by `throw`; the endpoint is a thin
  catch-all that flattens every throw to 500. Risk #6 is a direct consequence of that
  split: the service knows the failure *class*, and the current interface (a bare
  `Error`) discards it at the boundary. Any real fix is a typed error, not a bigger
  `catch`.
- **`recipe-prompt.ts` was extracted for testability before a runner existed.** Its
  header comment reasons explicitly about a plain-node script dying on
  `ServerOnlyModule`. Phase 1 now shows that concern was over-cautious under
  `getViteConfig()` — but the split is still the right seam, and the module ships
  with its own acceptance criterion.
- **Comment density is unusually high and the comments carry design rationale**, not
  restatement (e.g. why the sort precedes the slice, why a technique selection
  *rewrites* rather than appends, why `overrideTypes` needs narrowing). These are
  oracle-adjacent and were treated as evidence — but per CLAUDE.md they are still
  *implementation*, so every assertion below traces to the PRD or the test-plan, not
  to a comment.
- **Post-response validation is the pattern for AI output**: schema (syntax) →
  ID cross-check (referential) → at-risk floor (semantic). A clean three-layer defence
  worth naming in the §6 cookbook.

## Historical Context (from prior changes)

- `context/archive/2026-06-05-recipe-generation-loop/change.md` — the free-tier model
  (`google/gemma-4-26b-a4b-it:free`) is rate-limited with a documented paid fallback,
  and first real end-to-end generation took **27 s** against a 30 s timeout. Risk #6's
  likelihood rating is grounded in that measurement: the timeout margin is 3 s.
- Same file — the `approve_recipe` RPC return value was passed on untyped and the bug
  only surfaced when the call was extracted with a declared return type. This is the
  evidence behind Risk #3 (Phase 2), and a reminder that *"nothing type-checked it"*
  is how defects survive here.
- Same file — `supabase/seed.sql` was fixed to yield a working
  `test@example.com` / `Test1234!` login. Phase 1 does not need it; Phases 2–3 do.
- `context/foundation/lessons.md` lesson #1 — app-layer `user_id` filter alongside
  RLS. `listProducts` (`product.service.ts:16`) and `deleteProduct` (line 48) both
  comply. Belongs to Risk #4 / Phase 3, noted here only to confirm no regression on
  the read path Phase 1 exercises.
- `context/changes/recipe-generation-ux/` — the in-flight change that introduced the
  three closed-list parameters. It is the reason `buildSystemPrompt(params)` exists
  and the reason the byte-identity acceptance test was written down.

## Related Research

- `context/archive/2026-06-05-recipe-generation-loop/research.md` — original
  exploration of the generation loop
- `context/archive/2026-06-05-recipe-generation-loop/rgp-research.md` — recipe
  generation prompt research
- `context/archive/2026-06-05-recipe-generation-loop/supabase-rpc-docs.md` — RPC
  reference behind the Phase 2 atomicity risk

## Resolved Oracle — expired products (user decision, 2026-08-15)

The PRD gap behind Risk #2 was escalated and resolved by the product owner. **This
section, not the current implementation, is the oracle for Phase 1.** Sources
(`prd.md:31`, `prd.md:98`) establish that at-risk means *expiring within* 3 days and
therefore excludes past dates; the decision below fills the silence about what
past-dated stock should do.

**Decision: expired products are excluded from the prompt entirely, and the user is
told — both persistently in the inventory list and at the moment of generation.**

> **Scope note.** D1–D4 describe behaviour that **ships in
> `context/changes/expired-product-handling/`, not in this change** — see D5. They
> are recorded here because this is where the oracle was established, and that
> change's `change.md` points back to this section rather than re-deriving it.

### D1 — Three mutually exclusive states, not two

`expired` becomes a first-class state alongside `at-risk`, replacing today's
two-state `is_at_risk` boolean:

| State | Condition (against today, UTC) | Today's behaviour |
|---|---|---|
| **expired** | `expiry_date < today` | wrongly reported as at-risk |
| **at-risk** | `today <= expiry_date <= today + 3` | correct |
| **safe** | `expiry_date > today + 3` | correct |

This makes `isAtRisk()` two-sided. The upper bound is already right (+3 inclusive,
+4 exclusive — see probe table above) and must not change.

### D2 — Excluded from the prompt, and from the at-risk floor

Expired products are filtered out **before** the at-risk sort and the
`MAX_PROMPT_PRODUCTS` slice (`recipe.service.ts:74–77`). They never appear in the
outbound payload in any section, and they never enter `atRiskProducts`. This
dissolves the second-order defect by construction: the floor guard at
`recipe.service.ts:165–170` can no longer *force* a recipe to use expired food,
because expired food is not in the set it guards.

### D3 — The user is told, on two surfaces

- **Persistently**, in the inventory list: an `is_expired` flag drives an "Expired"
  badge mirroring the existing "At risk" badge at `inventory-panel.tsx:212–214`. Per
  `test-plan.md:169-175` the badge itself is out of scope — **the flag is tested, the
  rendering is not.**
- **At generation time**: the generate response reports which products were excluded
  as expired, so the caller can tell the user what was left out. This is an endpoint
  contract and *is* integration-testable with the model boundary stubbed — it is the
  testable half of "inform the user."

### D4 — All-expired inventory is its own case

A non-empty inventory in which every product is expired currently falls through to
`generate.ts:55`, whose message — *"Inventory is empty — add a product first"* — is
untrue and unactionable. It needs a distinct branch with its own message telling the
user their stock has expired. Distinguishing this from the genuinely-empty case is a
Phase 1 assertion, and it doubles as the first honest instance of the Risk #6
status/message discipline.

### D5 — Built test-first, in a separate change

Confirmed: the expired-product work is built **test-first with `/10x-tdd`** — the
first red test is nameable in one sentence (*"a past-dated product is excluded from
the prompt and reported back to the caller"*), which is exactly CLAUDE.md's bar for
test-first mode.

**Scope split (user decision, 2026-08-15).** D1–D4 are product behaviour, not test
coverage, so they do **not** ship in this change. They move to
`context/changes/expired-product-handling/`, which owns Risk #2 end to end. That
keeps `testing-recipe-generation-core` a genuine test-rollout phase rather than a
feature change wearing one.

This change therefore covers:

| In scope here | Moved to `expired-product-handling` |
|---|---|
| Vitest bootstrap (`/10x-implement` — no red test to name) | D1 three-state expiry model |
| Risk #1 tests — at-risk marking, sort-before-slice, prompt assembly, floor guard | D2 exclusion from the prompt |
| Risk #6 tests — failure-class translation, message hygiene | D3 `is_expired` flag + generation report |
| §6 cookbook update | D4 all-expired branch |

The dependency runs one way: `expired-product-handling` needs the runner from this
change, so this one lands first. Risk #1 and Risk #6 tests here run against code that
already exists, so `/10x-implement` and `/10x-tdd` are both defensible — planning
should pick per phase using the rule in CLAUDE.md.

**One coupling to carry into planning.** The Risk #1 floor-guard tests written here
assert against an `atRiskProducts` set that *currently* includes expired products.
Once `expired-product-handling` lands D2, that set changes. Prefer fixtures with
future-dated expiry values only, so the Risk #1 assertions survive D2 untouched — a
fixture dated in the past would silently become a different test case.

## Open Questions

1. **Does `workerd` reject `AbortSignal.timeout()` with an `Error`-derived
   `DOMException`?** Verified on Node (`instanceof Error === true`, `name ===
   "TimeoutError"`), so the guard at `recipe.service.ts:132` holds locally. If
   `workerd` differs, the timeout path degrades in **production only** to
   `"Unknown error"` at `generate.ts:65`. Cheap to settle with one `wrangler dev`
   probe; not a blocker for writing the tests, since a hermetic test can only assert
   the Node shape anyway.

2. **Is the timezone drift worth a test given production is UTC?** The defect is real
   but currently unreachable in production (`infrastructure.md:10`). Recommendation:
   do not test the drift; instead **pin `TZ=UTC` in the Vitest config** so the suite
   is deterministic, and note the constraint in §6 of the test-plan. Testing it would
   pin behaviour the product does not depend on.

3. **`MAX_PROMPT_PRODUCTS = 25` contradicts FR-007's literal "always receives the full
   inventory."** Deliberate and documented, but undeclared in the PRD. Should the PRD
   be amended, or is the cap an accepted implementation detail? Affects only whether a
   test asserts the cap value (brittle) or the survival property (correct) — planning
   should assume the latter regardless.
