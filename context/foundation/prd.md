---
project: "Zero Waste Chef"
version: 1
status: draft
created: 2026-05-20
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: "2026-06-07"
  after_hours_only: true
---

## Vision & Problem Statement

A household user knows food is being wasted in their fridge but cannot tell which products are at risk until it is too late. The failure happens in two steps: they have no real-time view of what's expiring soonest (the visibility gap), and even when they have a vague sense that something is about to expire, they lack a fast path from "this needs to be used" to "here's what to cook with it" (the planning gap).

Existing solutions stop at the warning. Expiry-tracker apps flag at-risk items but leave the user to figure out what to do next. Generic recipe apps suggest meals without knowing which ingredients are urgent. This product closes that gap: it tracks what's in the fridge with expiry dates, surfaces what's at risk, and generates AI recipes that prioritize the products expiring soonest — so the user can act, not just worry.

## User & Persona

**Primary persona:** A single adult managing their own fridge and pantry — living alone or as the designated household cook. They shop regularly but inconsistently, meaning fridge contents drift and expiry dates become unpredictable. They are aware food goes to waste and feel the cost (money, guilt) but have no low-friction way to act on that awareness before it's too late. They reach for this product when they open the fridge and feel uncertain: "what needs to be used up today?"

## Success Criteria

### Primary
- The AI generates a recipe that uses at least one at-risk product — defined as the product(s) expiring within 3 days from today's date.
- After the user approves a recipe on the approval screen, every product shown as "to be consumed" is removed from the inventory. The database state after approval matches exactly what the approval screen displayed.

### Secondary
- The home screen immediately distinguishes at-risk products (expiring within 3 days) from safe ones, without the user having to navigate or filter.

### Guardrails
- **Data isolation**: a logged-in user never sees another user's products or recipes. Account data is strictly scoped to the authenticated session.
- **Inventory consistency**: the approval screen is a contract. The set of products it shows as "to be removed" matches exactly the set removed from the database — never more, never fewer.

## User Stories

### US-01: User uses up at-risk food by generating and approving a recipe

- **Given** a logged-in user with at least one product in their inventory
- **When** they request a recipe and approve the result on the approval screen
- **Then** a recipe is saved to their recipe list AND the products shown on the approval screen are removed from their inventory

#### Acceptance Criteria
- The generated recipe includes at least one product flagged as at-risk (expiring within 3 days)
- The approval screen shows exactly which products will be removed before the user confirms
- After approval, the inventory reflects the removal — the approved products no longer appear in the product list
- If the user navigates away from the approval screen without confirming, no products are removed and no recipe is saved

## Functional Requirements

### Authentication
- FR-001: A visitor can register with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "registration is a drop-off point before the user sees value." Resolution: kept; without accounts, product data from different users mixes — auth is foundational to the isolation guarantee.

- FR-002: A registered user can log in with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "session management, token storage, and password reset add scope." Resolution: kept; login is the complement of registration — one without the other is incomplete.

- FR-003: A logged-in user can log out. Priority: must-have
  > Socrates: Counter-argument considered: "session expiry makes explicit logout unnecessary." Resolution: kept; logout is a basic security expectation — a user on a shared device needs a way to end their session explicitly.

### Inventory Management
- FR-004: A user can add a product to their inventory (name + expiry date). Priority: must-have
  > Socrates: Counter-argument accepted: "manual entry will be abandoned — users won't maintain a list they have to type by hand." Resolution: known risk, accepted. Barcode scanning and natural language input are explicitly out of MVP scope. The app's viability depends on the user committing to manual upkeep; this is a product bet, not a technical oversight.

- FR-005: A user can view their full product list with at-risk items visually distinguished. Priority: must-have
  > Socrates: Counter-argument considered: "sorting by date is enough — visual distinction adds scope without much clarity gain." Tension: the success criteria commits to the home screen "immediately showing at-risk products." Resolution: the form of distinction (colour tag vs sort order vs badge) is an implementation choice; the requirement is that the at-risk signal is present and immediate. Kept as must-have; implementation detail is downstream.

- FR-006: A user can delete a product from their inventory manually. Priority: must-have
  > Socrates: Counter-argument considered: "delete is superseded by the approval flow." Resolution: kept; the recipe flow removes products that were cooked. Delete handles everything else: mistakes, items that can't be cooked, items consumed outside a recipe. Without it, stale data accumulates with no escape.

### Recipe Generation
- FR-007: A user can request an AI-generated recipe from their inventory at any time. The AI always receives the full inventory. When at-risk products exist, the recipe must include at least one of them; it may also use additional non-at-risk products. When no at-risk products exist, the recipe is generated freely from the full inventory. Priority: must-have
  > Socrates: Counter-argument accepted: "bad AI output erodes trust faster than no output at all." Resolution: kept as must-have — this is the product's differentiator. The quality concern surfaces as an NFR: the AI output must be practically usable (see Non-Functional Requirements).

- FR-008: A user can view an approval screen showing the generated recipe and the list of products it would consume. Priority: must-have
  > Socrates: Counter-argument considered: "an extra step — users might prefer auto-remove after generation." Resolution: kept; the approval screen is the trust and safety mechanism. It also enforces the inventory consistency guardrail — auto-remove without confirmation breaks the contract.

- FR-009: A user can approve the recipe, which removes the listed products from inventory and saves the recipe. Priority: must-have
  > Socrates: Counter-argument considered: "partial failure could leave inventory in a silent inconsistent state." Resolution: kept; this surfaces as a guardrail requirement — the remove and save must succeed or fail as a unit. Implementation detail, but the requirement is must-have.

- FR-010: A user can view a list of previously generated and approved recipes. Priority: must-have
  > Socrates: Counter-argument accepted: "history adds storage and UI scope without contributing to the core loop." Resolution: kept as must-have per the original idea notes. The counter-argument is valid — this could ship in v2 — but the user has defined it as part of MVP. If timeline pressure appears, this is the first candidate to cut.

## Non-Functional Requirements

- A generated recipe must use only common home-cooking techniques and ingredients the user plausibly has in typical quantities — a recipe requiring professional equipment or exotic preparation steps is a failure, not a success.
- The app remains fully functional on the two most recent major versions of Chrome, Firefox, Safari, and Edge.
- A user's product and recipe data must not be accessible to any other user, including through direct URL construction or session manipulation.

## Business Logic

When a user requests a recipe, the AI always receives the full inventory (product names + expiry dates) and today's date. The system also computes which products fall within the 3-day at-risk window and marks them explicitly.

If at-risk products exist, the recipe must include at least one of them as a required ingredient. The recipe may also draw on any additional products from the full inventory — the at-risk constraint is a floor, not a ceiling. The goal is a complete, cookable recipe that happens to use up what's most urgent.

If no at-risk products exist, the recipe is generated freely from the full inventory with no prioritization constraint.

The rule is urgency-driven prioritization with graceful fallback: the application favors waste prevention when the opportunity exists, and defaults to general recipe assistance when it does not. Recipe generation is never blocked by inventory state — an empty at-risk window is not an error.

## Access Control

Authentication: email and password. No social auth. No magic link. No passwordless flow.

User model: flat. Every registered user has identical access to their own data — products and recipes are scoped to the account. No admin role, no guest access, no data sharing across accounts. An unauthenticated request to any protected route redirects to login.

## Non-Goals

- **No product editing**: correcting a product requires deleting it and adding it again. Edit functionality is deferred to v2.
- **No quantity tracking**: products are present or absent — no grams, millilitres, or unit counts. A recipe may assume a usable quantity of whatever is listed. Quantity tracking is deferred.
- **No notifications**: the app does not proactively alert the user. To see at-risk items, the user must open the app. Push notifications and email alerts are out of scope.
- **No barcode or receipt scanning**: product entry is text-only (name + expiry date). Camera integration, receipt parsing, and barcode lookup are out of scope.
- **No search or filtering**: the product list and recipe list have no search bar, no filter, and no sort control. Lists appear in natural order (product list: by expiry date ascending; recipe list: by creation date descending).
- **No multi-user sharing**: inventory is strictly single-account. No shared fridge, no household accounts, no collaborative features.
- **No offline support**: the app requires an active internet connection. No service worker, no local-first architecture, no sync. Online-only.
- **No separate recipe detail page**: recipe content is visible on the approval screen and inline in the recipe list. There is no dedicated route for a single recipe. The list view is sufficient for MVP.

## Open Questions

1. ~~**What happens when no at-risk products exist?**~~ **Resolved 2026-05-20**: recipe generation is always available; when no at-risk products exist the AI generates from the full inventory without prioritization constraint. FR-007 and Business Logic updated accordingly.
2. ~~**How many products does the AI receive?**~~ **Resolved 2026-05-20**: the AI always receives the full inventory. At-risk products are flagged within it. When at-risk products exist, the recipe must include at least one; it may also use additional products. FR-007 and Business Logic updated accordingly.
3. **What text does the recipe list show?** With no detail page, the list must show enough of the recipe to be useful. Is it recipe title only, title + ingredient list, or title + full instructions? — Owner: user. Block: no (can be decided during implementation).
