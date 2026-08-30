import { test, expect } from "@playwright/test";

test("added product appears in inventory and persists after reload", async ({ page }) => {
  const timestamp = Date.now();
  const productName = `Test Product ${timestamp}`;
  const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  await page.goto("/inventory");
  // InventoryPanel is a client:load island: the SSR markup is interactive-looking (visible,
  // enabled) before React attaches its submit handler. Filling and clicking faster than
  // hydration completes falls through to the native form submit — a GET with the values as a
  // query string — silently dropping the add. Wait for the network to settle (hydration's JS
  // chunks finish loading) before interacting.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Product name").fill(productName);
  await page.getByLabel("Expiry date").fill(expiryDate);
  await page.getByRole("button", { name: "Add product", exact: true }).click();

  await expect(page.getByText(productName, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();

  // Cleanup
  await page.getByRole("button", { name: `Delete ${productName}` }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(productName, { exact: true })).not.toBeVisible();
});
