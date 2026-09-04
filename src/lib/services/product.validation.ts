/**
 * Client-side draft validation for the product form.
 *
 * This mirrors — but deliberately does not import — `product.schema.ts`. The schema is a zod
 * object that runs on the server against a parsed request body; this runs during render
 * against half-typed input, and has to say *which* field is at fault so the dialog can put the
 * reason under it. Sharing one artefact between the two would mean either dragging zod's
 * error-shape into the render path or reading the clock inside the rule.
 *
 * The message strings are byte-identical to the schema's on purpose: two enforcement points
 * describing one rule must not drift into describing it differently.
 */

export interface ProductDraft {
  name: string;
  expiry_date: string;
}

/** Field-keyed reasons the draft is refused. An empty object means the draft is valid. */
export interface ProductDraftMessages {
  name?: string;
  expiry_date?: string;
}

/**
 * Explain why a product draft would be refused.
 *
 * `today` is a required `YYYY-MM-DD` argument rather than something read from the clock here:
 * it is what lets the boundary test assert -1/0/+1 without faking timers, and it keeps the
 * caller in charge of which "today" applies (the panel already computes one).
 */
export function validateProductDraft(draft: ProductDraft, today: string): ProductDraftMessages {
  const messages: ProductDraftMessages = {};

  if (draft.name.length === 0) {
    messages.name = "Name is required";
  } else if (draft.name.length > 255) {
    messages.name = "Name must be 255 characters or fewer";
  }

  // Lexicographic comparison is date comparison for zero-padded ISO strings, which is the
  // same trick product.schema.ts uses.
  if (draft.expiry_date < today) {
    messages.expiry_date = "Expiry date must be today or in the future";
  }

  return messages;
}

/** Convenience for the Save gate: a draft is valid when nothing is left to explain. */
export function isProductDraftValid(messages: ProductDraftMessages): boolean {
  return Object.keys(messages).length === 0;
}
