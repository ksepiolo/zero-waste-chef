<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Inventory Management (S-01)

- **Plan**: context/changes/inventory-management/plan.md
- **Scope**: Phase 1 + Phase 2 of 2
- **Date**: 2026-06-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical  3 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated Verification

| Check | Result |
|-------|--------|
| Zod installed (`npm ls zod`) | ✅ PASS — zod@4.4.3 |
| TypeScript build (`npm run build`) | ✅ PASS |
| Linting (`npm run lint`) | ✅ PASS (pre-existing astro-eslint-parser warnings, no new errors) |

## Findings

### F1 — listProducts has no app-layer user_id filter

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/product.service.ts:14
- **Detail**: The query is `.from("products").select("*")` with no `.eq("user_id", userId)` clause. Data isolation is enforced entirely by RLS (confirmed: `auth.uid() = user_id` on SELECT, explicit anon deny). The authenticated cookie-based client carries the JWT so RLS fires correctly today. But if the client is ever called with a service-role key (bypasses RLS), or RLS is accidentally disabled, all users' products become visible. `createProduct` already receives `userId` — `listProducts` is the only outlier.
- **Fix A ⭐ Recommended**: Add `userId: string` param to `listProducts` and chain `.eq("user_id", userId)` to the query.
  - Strength: Makes isolation explicit and safe regardless of RLS state. Matches `createProduct`'s pattern in the same file. One call site to update.
  - Tradeoff: Minor refactor — service signature changes, one API route and one .astro frontmatter updated.
  - Confidence: HIGH — pattern already used in `createProduct`.
  - Blind spot: None significant.
- **Fix B**: Accept RLS as sufficient — document the decision.
  - Strength: RLS policies are correctly authored (verified in migration). Supabase's intended pattern for user isolation is RLS, not app-layer filters.
  - Tradeoff: If a service-role client is ever used (e.g. admin tooling, cron jobs), isolation silently breaks.
  - Confidence: MED — depends on discipline in future callers.
  - Blind spot: Whether any future S-02 flows will call listProducts from a non-user context.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Always add an app-layer user_id filter alongside RLS on read and delete queries

---

### F2 — deleteProduct has no user_id constraint (IDOR risk)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/product.service.ts:42
- **Detail**: `.delete().eq("id", productId)` — no `.eq("user_id", userId)` constraint. An authenticated user who guesses another user's product UUID would get a 404 (count=0 → "not found") because RLS DELETE policy enforces `auth.uid() = user_id` correctly. However, if the client is ever invoked outside the user session context, a cross-user delete succeeds silently.
- **Fix A ⭐ Recommended**: Add `userId: string` to `deleteProduct` signature and chain `.eq("user_id", userId)` to the delete query. API route already has `context.locals.user.id`.
  - Strength: Closes IDOR at application layer; makes intent explicit for future service callers.
  - Tradeoff: Minor — one param added, one call site updated.
  - Confidence: HIGH — no downside for authenticated flows.
  - Blind spot: None significant.
- **Fix B**: Accept RLS as sufficient.
  - Strength: RLS DELETE policy is correctly authored. Behavior is safe today — attacker gets 404, not 204.
  - Tradeoff: Depends on RLS remaining intact and client always being user-scoped.
  - Confidence: MED — same caveat as F1.
  - Blind spot: None significant.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Always add an app-layer user_id filter alongside RLS on read and delete queries

---

### F3 — Unguarded re-fetch after POST can silently empty the list

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/inventory/inventory-panel.tsx:52–54
- **Detail**: After a successful POST, the component fetches `GET /api/products` to refresh the list. That second fetch has no error guard: `const listJson = await listRes.json() as { products: ProductWithRisk[] }; setProducts(listJson.products)`. If the re-fetch fails (transient 500, network hiccup), `listJson` will be `{ error: "..." }` not `{ products: [...] }`, and `setProducts(undefined)` silently replaces the displayed list with nothing. The add succeeds, the new product exists in the DB, but the UI shows an empty inventory with no error message.
- **Fix A ⭐ Recommended**: Skip the re-fetch — use the product returned in the POST response directly: `setProducts(prev => [...prev, json.product].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)))`.
  - Strength: Eliminates the second network call entirely; no re-fetch failure path. POST already returns the new product.
  - Tradeoff: Sort maintained client-side — one extra line.
  - Confidence: HIGH — no downside; POST response already carries the data.
  - Blind spot: None significant.
- **Fix B**: Keep the re-fetch but guard it: check `listRes.ok` before consuming the body, set an error message on failure.
  - Strength: Preserves server-authoritative list order.
  - Tradeoff: Still two network calls per add; fallback message is a mild UX annoyance.
  - Confidence: MED — adds complexity for a rare failure case.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

---

### F4 — SSR error swallowing shows empty state, not error

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/inventory.astro:14–16
- **Detail**: `catch { initialProducts = [] }` — a DB error at page load renders as "No products yet", indistinguishable from genuinely empty inventory. UX confusion, not data corruption.
- **Fix**: Pass a `hasError` prop to `InventoryPanel` and render "Could not load inventory — please reload" instead of the empty state message.
- **Decision**: SKIPPED

---

### F5 — Double cast suppresses TypeScript safety in product.service.ts

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/product.service.ts:29–33
- **Detail**: Insert result cast as `as unknown as { data: Product | null; ... }` to work around Supabase type inference. Runtime null-check on line 36 provides safety, so no actual data risk. TypeScript hygiene issue only.
- **Fix**: Run `supabase gen types typescript` and import generated database types to remove the cast.
- **Decision**: FIXED via Option B — replaced double cast with `.single<Product>()` generic

---

### F6 — Today-date logic duplicated in 3 places

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/products/index.ts:12, src/lib/services/product.service.ts:8, src/components/inventory/inventory-panel.tsx
- **Detail**: `new Date().toISOString().split("T")[0]` computed independently in three files. Not a bug — all three produce the same value. Risk: if the threshold logic changes, three files need updating.
- **Fix**: Export `getTodayISO()` from `product.service.ts` and import it in the API route. (Low priority — the client min-date can stay local.)
- **Decision**: SKIPPED
