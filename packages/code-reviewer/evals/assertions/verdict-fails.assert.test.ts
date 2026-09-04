/**
 * The verdict assertion is one predicate, but it is the assertion the whole
 * eval hangs on: if it silently passed everything, `npm run eval` would go green
 * on a reviewer that waved three planted defects through.
 */
import { describe, expect, it } from "vitest";

import verdictFails from "./verdict-fails.assert.js";
import { assertionContext, criteria, criterion, reviewOutput } from "./reviews.test-helper.js";

const CONTEXT = assertionContext({ diff: "irrelevant to this assertion" });

describe("verdict-fails", () => {
  it("passes when the review failed, naming the criteria that fell", () => {
    const output = reviewOutput(criteria(8, { security_safety: criterion(2) }), ["security_safety"]);

    const result = verdictFails(output, CONTEXT);

    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
    expect(result.reason).toContain("security_safety");
  });

  it("fails when the review passed a diff carrying three planted defects", () => {
    const result = verdictFails(reviewOutput(criteria(8)), CONTEXT);

    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it("reports every score when it fails, since the question is always how close it was", () => {
    const output = reviewOutput(criteria(8, { idiomaticity: criterion(5) }));

    const result = verdictFails(output, CONTEXT);

    expect(result.reason).toContain("idiomaticity=5");
    expect(result.reason).toContain("security_safety=8");
  });

  it("throws a readable error rather than passing when the provider attached no verdict", () => {
    expect(() => verdictFails({ summary: "…", criteria: criteria(8) }, CONTEXT)).toThrow(/missing `criteria` or `verdict`/);
  });
});
