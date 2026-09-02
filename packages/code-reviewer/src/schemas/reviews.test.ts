import { describe, expect, it } from "vitest";

import { reviewFindingSchema, reviewResultSchema, severitySchema } from "./reviews.js";

const finding = {
  severity: "major",
  file: "src/a.ts",
  line: 12,
  title: "Unhandled rejection",
  explanation: "The promise can reject and nothing catches it, crashing the process.",
  suggestion: "Wrap the await in try/catch and surface the error.",
};

describe("severitySchema", () => {
  it("accepts the four documented levels", () => {
    for (const level of ["critical", "major", "minor", "nit"]) {
      expect(severitySchema.safeParse(level).success).toBe(true);
    }
  });

  it("rejects a severity outside the scale", () => {
    expect(severitySchema.safeParse("blocker").success).toBe(false);
  });
});

describe("reviewFindingSchema", () => {
  it("parses a well-formed finding", () => {
    expect(reviewFindingSchema.safeParse(finding).success).toBe(true);
  });

  it("accepts line: null for a whole-file finding", () => {
    expect(reviewFindingSchema.safeParse({ ...finding, line: null }).success).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
  ])("rejects a %s line number", (_label, line) => {
    expect(reviewFindingSchema.safeParse({ ...finding, line }).success).toBe(false);
  });

  it("rejects an omitted line — null is the explicit whole-file signal", () => {
    const { line: _line, ...withoutLine } = finding;

    expect(reviewFindingSchema.safeParse(withoutLine).success).toBe(false);
  });

  it("rejects an unknown severity", () => {
    expect(reviewFindingSchema.safeParse({ ...finding, severity: "blocker" }).success).toBe(false);
  });
});

describe("reviewResultSchema", () => {
  it("parses a result carrying findings", () => {
    const parsed = reviewResultSchema.safeParse({ summary: "Mostly sound.", findings: [finding] });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.findings[0]?.severity).toBe("major");
  });

  it("accepts an empty findings array — sound code is a valid answer", () => {
    expect(reviewResultSchema.safeParse({ summary: "No defects found.", findings: [] }).success).toBe(true);
  });

  it("rejects a result missing its summary", () => {
    expect(reviewResultSchema.safeParse({ findings: [] }).success).toBe(false);
  });
});
