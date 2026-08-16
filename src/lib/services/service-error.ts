/**
 * The one error type the service layer throws when it knows *why* something failed.
 *
 * The endpoint used to receive a bare `Error` and could do nothing with it but return a flat
 * 500 and echo `err.message` — which is how a `ZodError` dump and PostgREST diagnostics ended
 * up rendered as user toasts. Carrying the failure class turns that translation into a lookup,
 * and makes hygiene structural: the endpoint answers with the message from this table or with
 * its own generic copy, so no upstream string has a path to the client.
 */

/**
 * The failure classes the endpoint can answer differently. Deliberately coarse: a class only
 * earns its own entry if a caller would *act* differently on it.
 */
export type ServiceErrorKind =
  | "rate_limit"
  | "timeout"
  | "provider_unavailable"
  | "upstream_fault"
  | "unusable_model_response"
  | "data_access";

/**
 * Status and message are derived together from this one table, so a class cannot exist with a
 * status but no safe message — the shape that let raw upstream text through before.
 *
 * Every message here is written by us and is safe to render verbatim. The four provider-fault
 * strings are unchanged from before the typed error existed; they are pinned by
 * recipe.service.test.ts and must stay distinct from one another.
 */
const CONTRACT: Record<ServiceErrorKind, { status: number; message: string }> = {
  // Worth retrying shortly — the only class where waiting actually helps.
  rate_limit: { status: 429, message: "Rate limited — try again shortly" },
  // 504, not 500: the upstream never answered us, and a gateway timeout says exactly that.
  timeout: { status: 504, message: "Recipe generation timed out — try again" },
  // Upstream 401/402 — our own account is unusable, so the feature is down rather than broken.
  provider_unavailable: { status: 503, message: "Recipe service unavailable — try again later" },
  upstream_fault: { status: 502, message: "Recipe generation failed" },
  // Empty content, non-JSON, schema violation and both inventory guardrails share one message
  // on purpose: a user acts identically on all four, and naming the cause would mean either
  // exposing model output or claiming something ("didn't match your inventory") that is false
  // for an empty response. The cause stays distinguishable in the server log, where it is
  // actually useful.
  unusable_model_response: { status: 502, message: "The suggested recipe could not be used — try generating again" },
  data_access: { status: 500, message: "Inventory is temporarily unavailable — try again" },
};

export class ServiceError extends Error {
  readonly kind: ServiceErrorKind;
  readonly status: number;

  constructor(kind: ServiceErrorKind, options?: ErrorOptions) {
    super(CONTRACT[kind].message, options);
    this.name = "ServiceError";
    this.kind = kind;
    this.status = CONTRACT[kind].status;
  }
}
