# ⚠️ This file is the answer key — do not pass it to the reviewer

**Never add this file to a test case's `vars`, and never let anything `vars` loads pull it in.** `vars` is what
`reviewer.provider.ts` hands to the model under test. A leak silently turns a recall test into a reading-comprehension
test: every model then "finds" all three defects, the eval keeps passing, and it measures nothing.

The answer key legitimately reaches exactly one place: the `llm-rubric` assertions in `promptfooconfig.yaml`, whose
`value` is read by the judge and never by the reviewer. This file is for humans maintaining the eval.

(Convention carried over from the `test/code-review-fixtures` branch, whose README opens the same way.)

---

## What this fixture is

`react19-migration.diff` is a synthetic React 16 → React 19 migration of a listing widget: a class component becomes a
function component, and its mount helper moves from `ReactDOM.render` to `createRoot`. Three files, ~130 added lines.

It is synthetic on purpose. A diff lifted from this repo carries incidental problems, and it would stop being possible
to tell whether a model found a _planted_ flaw or a real one it happened to trip over.

`react19-migration.vars.yaml` carries the PR title and body. That body is confidently, specifically wrong: it claims the
migration is behaviour-preserving and that the same prop defaults apply. Each planted flaw contradicts it. The body
names none of them.

## The three planted defects

The reviewer scores six criteria 1–10; `FAILING_SCORE_THRESHOLD` is `4`, so a criterion at or below 4 fails the review
(`src/schemas/reviews.ts`). One defect is planted under each of three criteria, so a review that finds all three cannot
return a passing verdict.

| #   | Criterion                    | File                           | Quotable excerpt                                  | The defect                                                                                                                                                                            |
| --- | ---------------------------- | ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `implementation_correctness` | `src/components/item-list.tsx` | `void loadItems(categoryId);` … `}, []);`         | The old `componentDidUpdate` refetched whenever `categoryId` changed. The effect that replaces it has an **empty dependency array**, so the fetch runs once on mount and never again. |
| 2   | `idiomaticity`               | `src/components/item-list.tsx` | `ItemList.defaultProps = { pageSize: 25 };`       | React 19 **removed** `defaultProps` for function components. It is silently ignored, so `pageSize` is `undefined` at runtime.                                                         |
| 3   | `security_safety`            | `src/components/item-list.tsx` | `dangerouslySetInnerHTML={{ __html: item.note }}` | `item.note` is user-supplied and was escaped by JSX before this change. Rendering it as raw HTML introduces stored XSS.                                                               |

### Why each one is impactful, not a nit

1. **Stale data, silently.** Switching category in the sidebar clears the selection (the render-time reset still fires)
   but leaves the previous category's items on screen. Nothing errors; the user just sees the wrong list. This is the
   single most common real-world React migration bug.
2. **Pagination stops existing.** With `pageSize` undefined, `matching.slice(0, pageSize)` is `matching.slice(0, undefined)`
   — the whole array. Every item in the category renders, and the "Show all N items" button never appears because
   `matching.length > visible.length` is never true. Invisible to the type checker: `pageSize?: number` is optional, and
   `Array.prototype.slice` accepts `undefined` for its end index. The expando assignment on a function declaration also
   typechecks.
3. **Stored XSS.** A note saved by one user renders as markup for everyone who opens the category. The in-diff comment
   ("Notes arrive from the CSV importer with `<em>`/`<strong>` markup already in them") is the rationalisation a real
   author would write, not a mitigation — nothing sanitises the value.

**Defect 2 is the discriminator.** Defects 1 and 3 are recognisable to any competent reviewer. Defect 2 requires knowing
a specific React 19 removal, and the diff visibly bumps `react` to `^19.2.6` so the knowledge is fairly cued. Do not
soften it — if all three models find all three defects, the comparison says nothing, and this is the flaw to sharpen.

## What is deliberately correct — do not "fix" it

The bulk of the diff is a genuine, correct migration. It has to be, or the model can flag everything and score well by
accident. If you change any of the following, you change what the eval measures:

- **`class` → function with hooks.** `this.state` → five `useState` calls; the three bound handlers become plain
  functions.
- **Adjusting state during render.** `previousCategoryId` compared against `categoryId` inside the render body, with
  `setPreviousCategoryId` / `setSelectedIds` / `setShowAll` called there, replaces `UNSAFE_componentWillReceiveProps`.
  This looks wrong at a glance and **is** the pattern React documents. Some models flag it; that is a false positive, and
  nothing gates on precision.
- **String ref → `useRef`.** `ref="search"` + `this.refs.search.focus()` becomes `searchRef` focused from a mount effect.
- **`componentWillUnmount` → effect cleanup.** The `keydown` listener is added and removed by the same effect; the
  in-flight fetch is cancelled by the `cancelled` flag returned from its own effect.
- **`propTypes` removed.** `ItemListProps` already stated the same contract; `prop-types` is dropped from
  `dependencies` in the same diff.
- **`ReactDOM.render` → `createRoot`.** One root per container, kept in a `WeakMap`, unmounted and evicted by
  `unmountItemList`. Correct React 19.
- **Dependency bump.** `react`, `react-dom`, `@types/react`, `@types/react-dom` all move to 19 together.

Two of the three effects legitimately carry `}, []);` — the focus effect and the `keydown` effect. Only the fetch effect
is wrong. That is the discrimination the fixture asks the model to make; do not "tidy" the deps of the other two.

## No test changes — expected, not planted

The diff touches no test file, so `test_risk_coverage` scores low for every model. That is background, not a fourth
defect. **The rubrics must not credit a model for reporting it**, or every model scores a point for noticing something
that is simply true of the diff.

## Re-verifying the diff

The patch is generated from a real before/after tree rather than written by hand, so its hunk headers and offsets are
correct by construction. To re-check `git apply --check` after editing it, reconstruct the pre-image in a scratch repo:

```bash
mkdir -p /tmp/fx && cd /tmp/fx && git init -q .
# write the pre-image files (the '-' side of the diff), commit, then:
git apply --check /path/to/evals/fixtures/react19-migration.diff
```

The cheaper check, and the one that actually matters day to day, is that each defect's excerpt is still present verbatim:

```bash
grep -cF 'void loadItems(categoryId);'                      react19-migration.diff
grep -cF 'ItemList.defaultProps = { pageSize: 25 };'        react19-migration.diff
grep -cF 'dangerouslySetInnerHTML={{ __html: item.note }}'  react19-migration.diff
```

Each must return `1`. If one returns `0`, a rubric is scoring a defect that is no longer in the fixture and will fail for
every model — which looks like a model regression and is not one.
