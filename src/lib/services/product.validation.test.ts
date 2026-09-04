import { describe, expect, it } from "vitest";

import { isProductDraftValid, validateProductDraft } from "./product.validation";

// No fake timers here, unlike product.service.test.ts: `today` is an argument, so the boundary
// table means the same thing on every machine without touching the clock at all. That is the
// whole reason the predicate takes it as a parameter.
const TODAY = "2026-08-15";

/** ISO date string `days` from TODAY; negative offsets are past dates. */
function expiryIn(days: number): string {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

// Oracle: product.schema.ts:8 — "today or in the future". Today is inside the accepted range
// and yesterday is the first day outside it, so -1/0/+1 pins both sides of the only edge the
// rule has. Convention: product.service.test.ts:41-45, test-plan.md:69.
const EXPIRY_TABLE = [
  { offset: -1, label: "expired yesterday", refused: true },
  { offset: 0, label: "expires today", refused: false },
  { offset: 1, label: "expires tomorrow", refused: false },
];

describe("validateProductDraft — expiry boundaries", () => {
  it.each(EXPIRY_TABLE)("a product that $label (day $offset) is refused=$refused", ({ offset, refused }) => {
    const messages = validateProductDraft({ name: "Milk", expiry_date: expiryIn(offset) }, TODAY);

    expect(messages.expiry_date).toBe(refused ? "Expiry date must be today or in the future" : undefined);
    expect(isProductDraftValid(messages)).toBe(!refused);
  });
});

// Oracle: product.schema.ts:5 — min(1) and max(255). 0 and 256 are the refused sides, 1 and
// 255 the accepted ones.
const NAME_TABLE = [
  { length: 0, label: "an empty name", message: "Name is required" },
  { length: 1, label: "a one-character name", message: undefined },
  { length: 255, label: "a name at the 255-character limit", message: undefined },
  { length: 256, label: "a name one character over the limit", message: "Name must be 255 characters or fewer" },
];

describe("validateProductDraft — name boundaries", () => {
  it.each(NAME_TABLE)("$label (length $length) yields message $message", ({ length, message }) => {
    const messages = validateProductDraft({ name: "x".repeat(length), expiry_date: TODAY }, TODAY);

    expect(messages.name).toBe(message);
    expect(isProductDraftValid(messages)).toBe(message === undefined);
  });
});

describe("validateProductDraft — combined", () => {
  // The dialog renders one message per field, so a draft wrong in two places has to come back
  // wrong in two places; collapsing to the first fault would leave the second unexplained.
  it("reports both fields when both are invalid", () => {
    const messages = validateProductDraft({ name: "", expiry_date: expiryIn(-1) }, TODAY);

    expect(messages).toStrictEqual({
      name: "Name is required",
      expiry_date: "Expiry date must be today or in the future",
    });
  });

  it("returns an empty object for a valid draft", () => {
    expect(validateProductDraft({ name: "Milk", expiry_date: expiryIn(1) }, TODAY)).toStrictEqual({});
  });

  // The date input is clearable, and an empty string sorts before every real date. Falling
  // through as "valid" would re-open the silent refusal this change exists to close.
  it("refuses a cleared date", () => {
    expect(validateProductDraft({ name: "Milk", expiry_date: "" }, TODAY).expiry_date).toBe(
      "Expiry date must be today or in the future",
    );
  });
});
