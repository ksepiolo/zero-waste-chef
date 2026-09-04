# Eval results — `react19-migration`

First recorded run of the harness. This file is the change's actual deliverable as a piece of
knowledge; the config is just what produces it.

|                     |                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Date**            | 2026-09-04                                                                                   |
| **promptfoo**       | 0.122.2                                                                                      |
| **Fixture**         | `evals/fixtures/react19-migration.diff` — one React 16 → 19 migration, three planted defects |
| **Judge**           | `openrouter:x-ai/grok-4.6` (none of the three subjects — see `promptfooconfig.yaml`)         |
| **Runs**            | 2 full passes. Recorded below as **run 1 / run 2**.                                          |
| **Reviewer prompt** | `REVIEW_INSTRUCTIONS`, unmodified — the model is the only variable                           |

Two passes rather than one because the incumbent ignores `temperature: 0`: OpenRouter reports
`anthropic/claude-sonnet-5` as supporting neither `temperature` nor `seed`, so a single run cannot
tell a real difference from sampling noise. Both challengers do support both.

## Criterion scores

1–10, and the review **fails** when any criterion is at or below `FAILING_SCORE_THRESHOLD` (`4`).
Bold marks a failing criterion.

| Model                                   | correctness   | idiomaticity | complexity | test coverage | documentation | security      | Verdict     |
| --------------------------------------- | ------------- | ------------ | ---------- | ------------- | ------------- | ------------- | ----------- |
| `anthropic/claude-sonnet-5` (incumbent) | **3** / **3** | 5 / 5        | 7 / 6      | **2** / **2** | **4** / **4** | **2** / **2** | fail / fail |
| `z-ai/glm-5.1`                          | **3** / **3** | 5 / 5        | 8 / 8      | **2** / **2** | 7 / 5         | **4** / **4** | fail / fail |
| `deepseek/deepseek-v4-flash`            | **3** / **4** | 6 / 8        | 7 / 9      | **2** / **2** | 8 / 7         | **3** / **3** | fail / fail |

All three models failed the fixture on both runs. That is the floor the eval was built to check,
and it is met.

`test_risk_coverage` scores 2 for everyone on both runs. The diff touches no test file, so this is
correct and expected — it is background, not a fourth defect, and no rubric credits it.

## Defect recall — did the model find each planted flaw?

Judged per defect by `llm-rubric`, `threshold: 1` (binary). ✅ found / ❌ missed, run 1 / run 2.

| Model                        | 1. stale refetch (empty deps) | 2. `defaultProps` removed in React 19 | 3. stored XSS via raw HTML |
| ---------------------------- | ----------------------------- | ------------------------------------- | -------------------------- |
| `anthropic/claude-sonnet-5`  | ✅ / ✅                       | ✅ / ✅                               | ✅ / ✅                    |
| `z-ai/glm-5.1`               | ✅ / ✅                       | ✅ / ✅                               | ✅ / ✅                    |
| `deepseek/deepseek-v4-flash` | ✅ / ✅                       | ❌ / ❌                               | ✅ / ✅                    |

**Defect 2 discriminates, exactly as the fixture intended.** DeepSeek missed it on both runs, and
the judge's reasoning shows why it is the right discriminator rather than a trick: the model _saw_
the `defaultProps` assignment both times and rated it a style preference —

> run 1: "The review never mentions defaultProps, React 19 dropping support for them on function
> components, or any consequence (undefined page size / broken pagination)."
>
> run 2: "The review treats `defaultProps` as a style nit ('less idiomatic than destructuring
> defaults', 'technically valid', 'acceptable') and never states that React 19 ignores
> `defaultProps` on function components."

That is the failure mode the rubric was written to catch: naming the symptom without the
consequence. Both stronger models state the consequence explicitly — `pageSize` is `undefined`,
`slice(0, undefined)` returns the whole array, and the "Show all N items" button stops appearing.

## Static assertions

| Model                        | verdict fails | schema valid | quotes anchored |
| ---------------------------- | ------------- | ------------ | --------------- |
| `anthropic/claude-sonnet-5`  | ✅ / ✅       | ✅ / ✅      | ✅ 6/6 / ✅ 7/8 |
| `z-ai/glm-5.1`               | ✅ / ✅       | ✅ / ✅      | ❌ 5/7 / ❌ 6/8 |
| `deepseek/deepseek-v4-flash` | ✅ / ✅       | ✅ / ✅      | ❌ 2/5 / ❌ 1/4 |

**`quotes-anchored` is the one assertion that did not pass on all three models — and that is a real
finding, not a miscalibrated check.** The schema asks each issue for "a short verbatim excerpt from
the diff … a locator, not the whole hunk". Both challengers routinely answer with an _elision_
instead:

```
useEffect(() => { ... }, []);
```

That text is nowhere in the diff. A reader cannot search for it, which is the entire job `quote`
exists to do — the schema has no `line` field precisely because `quote` is meant to be the locator.
GLM also over-quotes in the other direction, pasting whole reformatted hunks that no longer match
the source. Sonnet quotes verbatim.

The assertion scores the _fraction_ anchored against a `0.8` floor, and run 2 shows why that is the
right shape rather than all-or-nothing: Sonnet had one loose quote out of eight (0.875) and still
passed, while DeepSeek's 1-of-4 (0.25) did not.

This is a finding about the **prompt**, not only about the models: `REVIEW_INSTRUCTIONS` never says
"no ellipses, no reformatting". Fixing it is a change to `src/prompts/reviews.ts` and therefore out
of this change's scope — see "What We're NOT Doing" in the plan.

## Cost

| Model                        | run 1 (prompt / completion) | run 2 (prompt / completion) |
| ---------------------------- | --------------------------- | --------------------------- |
| `anthropic/claude-sonnet-5`  | 9,833 / 7,741               | 9,833 / 5,918               |
| `z-ai/glm-5.1`               | 3,798 / 3,542               | 3,798 / 3,911               |
| `deepseek/deepseek-v4-flash` | 4,009 / 2,651               | 4,009 / 1,291               |
| **judge** (9 rubric calls)   | 17,133 / 6,555              | —                           |

A full pass is ~55k tokens end to end and runs in about two minutes wall-clock at promptfoo's
default concurrency of 4. Prompt tokens differ across models only because each tokenises the same
prompt differently — the input is identical.

## What this says

1. **The incumbent is the right default.** `anthropic/claude-sonnet-5` found all three defects on
   both runs, quoted accurately, and was the only model to also fail `documentation`. It is also
   roughly 2.5× the tokens of either challenger.
2. **GLM 5.1 is a credible challenger on recall.** Same 3-of-3 on both runs at under half the
   token cost. What it does not match is locator discipline — 5/7 and 6/8 anchored. If the quote
   contract were tightened in the prompt, this is the arm worth re-running first.
3. **DeepSeek v4 Flash is the cheapest and the weakest.** It reliably catches the two defects any
   competent reviewer catches, and reliably misses the one that requires knowing a specific React 19
   removal. Its quotes are the least usable of the three.
4. **The fixture discriminates.** All three fail the diff (so the verdict is never the interesting
   part), yet only one model misses a defect — which is exactly the resolution this eval needs.
   Sharpening defect 2 further would collapse that.

### Precision is not measured here — but it was better than expected

Nothing gates on precision; the brief asks for recall. Two observations worth keeping anyway, since
a future change that adds a precision gate starts from them:

- **The predicted false positive did not appear.** The answer key expects some models to flag the
  render-time state adjustment that replaces `UNSAFE_componentWillReceiveProps` — it looks wrong at
  a glance and is the pattern React documents. Across six model-runs, not one model raised it as a
  defect. Sonnet mentioned it once, in run 2, under `complexity`, as a design critique (a second
  piece of derived state to detect a prop change, next to a fetch effect that ignores the same
  prop). That reading is defensible, not a false positive.
- **Every other issue raised traces to something real**: one of the three planted defects, the
  absent tests, or the in-diff comment that rationalises the raw-HTML render. DeepSeek's run 1 is
  the one wobble — it reports the empty-deps defect twice, once under `implementation_correctness`
  and again under `idiomaticity`, which is duplication rather than a second finding.

## Reproducing

```bash
cd packages/code-reviewer
npm run eval          # ~2 min, ~$0.06, exits 1 if a model misses a defect
npm run eval:view     # the three-column comparison in a browser
```

Results land in `evals/output/latest.json` (gitignored). Drift against the tables above is the
signal this file exists to make measurable.
