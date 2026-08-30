import { test, expect } from "@playwright/test";
import http from "node:http";

// Protects test-plan.md Risk #8: the generate→approve→removal loop's UI wiring
// diverging from its already-proven API contract. Models `tests/seed.spec.ts`'s
// style. Requires OPENROUTER_URL=http://127.0.0.1:4399/mock-openrouter set before
// `npm run dev` starts (astro:env/server resolves at server startup) — see
// .env.example and plan.md's "Critical Implementation Details".

// Fixed, not ephemeral: OPENROUTER_URL is resolved once at `npm run dev` startup, so the
// stub must own the exact port the running server was pointed at. Run this spec one
// --project at a time (per Success Criteria below) — concurrent projects would race for
// this port.
const STUB_PORT = 4399;
const STUB_TITLE = `Stub Recipe ${Date.now()}`;
const STUB_INGREDIENTS = ["1 test ingredient"];
const STUB_INSTRUCTIONS = ["Combine and serve."];
// Hoisted to module scope (not the test body) so the stub handler can close over the exact
// name and pick *this* product's id out of the prompt — a dev DB commonly carries leftover
// products from earlier runs, and the first "(id: ...)" in the prompt is not reliably ours.
const PRODUCT_NAME = `Stub Product ${Date.now()}`;

let stubServer: http.Server;

test.beforeAll(async () => {
  const escapedName = PRODUCT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idForProductName = new RegExp(`${escapedName} \\(id: ([0-9a-fA-F-]{36})\\)`);

  stubServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
        messages: { content: string }[];
      };
      const lastUserContent = body.messages[body.messages.length - 1].content;
      const match = idForProductName.exec(lastUserContent);
      const usedProductId = match?.[1];

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: STUB_TITLE,
                  ingredients: STUB_INGREDIENTS,
                  instructions: STUB_INSTRUCTIONS,
                  used_product_ids: usedProductId ? [usedProductId] : [],
                }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    // Without this, a bind failure (e.g. port 4399 already taken by another worker) is an
    // uncaught exception that crashes the whole test process instead of failing this test.
    stubServer.on("error", reject);
    stubServer.listen(STUB_PORT, "127.0.0.1", () => {
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) =>
    stubServer.close(() => {
      resolve();
    }),
  );
});

test("approving a generated recipe removes the used product from inventory and adds it to history", async ({
  page,
}) => {
  const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  await page.goto("/inventory");
  // InventoryPanel is a client:load island: the SSR markup is interactive-looking (visible,
  // enabled) before React attaches its submit handler. Filling and clicking faster than
  // hydration completes falls through to the native form submit — a GET with the values as a
  // query string — silently dropping the add. Wait for the network to settle (hydration's JS
  // chunks finish loading) before interacting.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Product name").fill(PRODUCT_NAME);
  await page.getByLabel("Expiry date").fill(expiryDate);
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(page.getByText(PRODUCT_NAME, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Generate", exact: true }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: STUB_TITLE })).toBeVisible();
  await expect(dialog.getByText(`Will remove from inventory: ${PRODUCT_NAME}`)).toBeVisible();

  await dialog.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(PRODUCT_NAME, { exact: true })).not.toBeVisible();

  // Reload proves the removal is persisted server-side, not just optimistic client state.
  await page.reload();
  await expect(page.getByText(PRODUCT_NAME, { exact: true })).not.toBeVisible();

  await page.goto("/recipes");
  await expect(page.getByText(STUB_TITLE, { exact: true })).toBeVisible();
});
