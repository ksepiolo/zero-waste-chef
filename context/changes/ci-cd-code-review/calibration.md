# Threshold calibration — `FAILING_SCORE_THRESHOLD`

Phase 4, change #4. Evidence for keeping the failing floor at `4`.

## Method

The reviewer was run against the six measured pull requests (#23–#28) with the real
`OPENROUTER_API_KEY`, via the package CLI rather than `workflow_dispatch`:

```
npm start -- --json --title "<pr title>" --diff <pr.diff> --body <pr-body.md>
```

Running locally rather than dispatching keeps AI review comments off six already-merged
pull requests while producing identical verdict data — the CLI is the same code path the
composite action invokes, and the verdict is derived by `deriveVerdict` either way.

## Results

`FAILING_SCORE_THRESHOLD = 4` (fail when any criterion scores ≤ 4).

| PR  | verdict | correctness | idiomaticity | complexity | test/risk | docs | security | failing            |
| --- | ------- | ----------: | -----------: | ---------: | --------: | ---: | -------: | ------------------ |
| #23 | pass    |           7 |            8 |          8 |         7 |    9 |        9 | —                  |
| #24 | fail    |           8 |            7 |          8 |         4 |    9 |        9 | test_risk_coverage |
| #25 | pass    |           9 |            9 |          9 |         6 |   10 |        9 | —                  |
| #26 | pass    |           7 |            8 |          8 |         6 |    9 |        8 | —                  |
| #27 | fail    |           8 |            8 |          8 |         4 |    9 |        9 | test_risk_coverage |
| #28 | pass    |           8 |            9 |          9 |         6 |    8 |        9 | —                  |

## Reading

Four pass, two fail. Both failures are `test_risk_coverage` at exactly 4, and both are on
UI-only redesign PRs (#24 "home page UI update", #27 "recipe history ux update") that ship
markup and token changes with no accompanying tests. That is a defensible verdict rather
than a false failure, so the floor is **kept at 4**.

Scores are non-uniform (1-point spread within a PR is common, 4–10 across the sample) and
the summaries reference real code, so the rubric is discriminating rather than rubber-stamping.

Two observations worth carrying, neither blocking:

- **`documentation` scores high everywhere (8–10).** These PRs carry large `context/changes/`
  planning artifacts in the diff, which the model reads as documentation. On a code-only PR
  the criterion would likely score very differently, so this sample does not calibrate it.
- **`implementation_correctness` never drops below 7 on the merged sample.** Expected — these
  PRs were reviewed and merged. The criterion does discriminate: the deliberately flawed
  fixture in PR #30 scored 1.

## Counter-check

PR #30 (`test/ai-code-review-antipatterns`) planted one defect class per criterion. Scored
1/2/2/1/2/1 — all six below the floor — and identified every planted defect, including the
removed `user_id` filters, a logged `SUPABASE_KEY`, PostgREST filter injection, and a UTC→local
date regression. The floor separates that from the merged sample cleanly.
