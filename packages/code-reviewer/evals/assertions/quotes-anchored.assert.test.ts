/**
 * The normaliser is the only real logic in the static assertions, and it is the
 * one place a mistake is invisible: too strict and every model looks like it
 * hallucinates locators; too loose and a genuinely invented quote anchors
 * against unrelated text. These cases pin both edges.
 */
import { describe, expect, it } from "vitest";

import quotesAnchored, { ANCHORED_FRACTION_FLOOR } from "./quotes-anchored.assert.js";
import { assertionContext, criteria, criterion, issue, reviewOutput } from "./reviews.test-helper.js";

/** A fragment of the real fixture, markers and indentation included. */
const DIFF = [
  "@@ -13,158 +13,127 @@ interface ItemListProps {",
  "-  componentDidUpdate(prevProps: ItemListProps) {",
  "+    void loadItems(categoryId);",
  "+",
  "+    return () => {",
  "+      cancelled = true;",
  "+    };",
  "+  }, []);",
  "+ItemList.defaultProps = { pageSize: 25 };",
].join("\n");

const CONTEXT = assertionContext({ diff: DIFF });

function withQuotes(...quotes: string[]) {
  return reviewOutput(criteria(8, { implementation_correctness: criterion(3, quotes.map(issue)) }), [
    "implementation_correctness",
  ]);
}

describe("quotes-anchored", () => {
  it("anchors a quote copied verbatim, diff marker and all", () => {
    const result = quotesAnchored(withQuotes("+    void loadItems(categoryId);"), CONTEXT);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it("anchors a quote the model reflowed — marker dropped, indentation lost", () => {
    const result = quotesAnchored(withQuotes("void loadItems(categoryId);"), CONTEXT);

    expect(result.pass).toBe(true);
  });

  it("anchors a multi-line quote, which the diff wraps across lines", () => {
    const result = quotesAnchored(withQuotes("return () => {\n  cancelled = true;\n};"), CONTEXT);

    expect(result.pass).toBe(true);
  });

  it("does not anchor text the model invented", () => {
    const result = quotesAnchored(withQuotes("useMemo(() => sanitize(item.note), [item.note])"), CONTEXT);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("useMemo");
  });

  it("scores the fraction anchored, so one stray quote is visible without flunking the cell", () => {
    const anchored = [
      "+    void loadItems(categoryId);",
      "}, []);",
      "ItemList.defaultProps = { pageSize: 25 };",
      "cancelled = true;",
    ];

    const result = quotesAnchored(withQuotes(...anchored, "+  const [sanitized] = useState('');"), CONTEXT);

    expect(result.score).toBe(0.8);
    expect(result.pass).toBe(true);
    expect(result.reason).toContain("1 of 5");
  });

  it("fails once unanchored quotes drop the fraction below the floor", () => {
    const result = quotesAnchored(withQuotes("+    void loadItems(categoryId);", "invented one", "invented two"), CONTEXT);

    expect(result.score).toBeLessThan(ANCHORED_FRACTION_FLOOR);
    expect(result.pass).toBe(false);
  });

  it("treats an empty quote as a missing locator, not as matching everywhere", () => {
    const result = quotesAnchored(withQuotes(""), CONTEXT);

    expect(result.pass).toBe(false);
  });

  it("passes vacuously when the review reported no issues at all", () => {
    const result = quotesAnchored(reviewOutput(criteria(9)), CONTEXT);

    expect(result.pass).toBe(true);
    expect(result.reason).toContain("no issues");
  });

  it("collects quotes from every criterion, not just the first", () => {
    const output = reviewOutput(
      criteria(8, {
        idiomaticity: criterion(3, [issue("ItemList.defaultProps = { pageSize: 25 };")]),
        security_safety: criterion(2, [issue("a quote that is nowhere in the diff")]),
      }),
      ["idiomaticity", "security_safety"],
    );

    const result = quotesAnchored(output, CONTEXT);

    expect(result.score).toBe(0.5);
    expect(result.reason).toContain("security_safety");
  });
});
