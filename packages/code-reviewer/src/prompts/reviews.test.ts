import { describe, expect, it } from "vitest";

import { buildReviewPrompt, REVIEW_INSTRUCTIONS } from "./reviews.js";

const HEADER = "Review the following files. Line numbers are prefixed and are not part of the source.";

describe("REVIEW_INSTRUCTIONS", () => {
  it("is a single joined string, not an array", () => {
    expect(typeof REVIEW_INSTRUCTIONS).toBe("string");
    expect(REVIEW_INSTRUCTIONS).toContain("senior code reviewer");
    expect(REVIEW_INSTRUCTIONS).not.toContain("\n");
  });
});

describe("buildReviewPrompt", () => {
  it("numbers lines 1-indexed with a tab separator", () => {
    const prompt = buildReviewPrompt([{ path: "a.ts", content: "const a = 1;\nconst b = 2;" }]);

    // The first line must be `1`, not `0` — the schema promises 1-indexed anchors.
    expect(prompt).toBe(`${HEADER}\n--- a.ts ---\n1\tconst a = 1;\n2\tconst b = 2;`);
    expect(prompt).not.toContain("0\tconst a = 1;");
  });

  it("separates the number from the source with a tab, not spaces", () => {
    const prompt = buildReviewPrompt([{ path: "a.ts", content: "x" }]);

    expect(prompt).toContain("1\tx");
    expect(prompt).not.toContain("1 x");
  });

  it("frames each file with its own --- path --- heading, blank-line separated", () => {
    const prompt = buildReviewPrompt([
      { path: "a.ts", content: "a" },
      { path: "nested/b.ts", content: "b" },
    ]);

    expect(prompt).toBe(`${HEADER}\n--- a.ts ---\n1\ta\n\n--- nested/b.ts ---\n1\tb`);
  });

  it("omits the context block entirely when no context is given", () => {
    const prompt = buildReviewPrompt([{ path: "a.ts", content: "a" }]);

    expect(prompt).not.toContain("Context for this review:");
    expect(prompt.startsWith(HEADER)).toBe(true);
  });

  it("prefixes the context block when context is given", () => {
    const prompt = buildReviewPrompt([{ path: "a.ts", content: "a" }], "Ticket ZWC-1: tighten validation.");

    expect(prompt).toBe(`Context for this review:\nTicket ZWC-1: tighten validation.\n\n${HEADER}\n--- a.ts ---\n1\ta`);
  });

  it("treats an empty file as one empty numbered line rather than dropping it", () => {
    const prompt = buildReviewPrompt([{ path: "empty.ts", content: "" }]);

    expect(prompt).toBe(`${HEADER}\n--- empty.ts ---\n1\t`);
  });

  it("keeps the trailing empty line a trailing newline produces", () => {
    const prompt = buildReviewPrompt([{ path: "a.ts", content: "a\n" }]);

    expect(prompt).toBe(`${HEADER}\n--- a.ts ---\n1\ta\n2\t`);
  });
});
