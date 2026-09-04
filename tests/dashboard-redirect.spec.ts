import { test, expect } from "@playwright/test";

// Protects the legacy `/dashboard` URL: a refactor must not silently turn it back
// into a dead end (404, or a resurrected starter page). Signed-out coverage is
// already implicit — middleware.ts guards "/dashboard" via PROTECTED_ROUTES — so
// the risk that had never been exercised at runtime is the *authenticated* hop
// through src/pages/dashboard.astro's Astro.redirect("/inventory").
// Models `tests/seed.spec.ts`'s style. Auth comes from the `setup` project's
// storageState (playwright.config.ts:41-56), so no UI sign-in here.

test("authenticated visit to legacy /dashboard lands on the inventory page", async ({ page }) => {
  await page.goto("/dashboard");

  // The redirect is the behavior under test: the URL must settle on /inventory.
  await expect(page).toHaveURL(/\/inventory$/);

  // ...and on the real inventory page, not merely a URL that happens to match —
  // AppNav only renders for an authenticated inventory route, so this fails if the
  // redirect ever lands somewhere broken or bounces back through /auth/signin.
  await expect(page.getByRole("link", { name: "My Inventory" })).toBeVisible();
});
