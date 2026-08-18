import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const authFile = path.resolve("playwright/.auth/user.json");

const EMAIL = process.env.E2E_USER_EMAIL ?? "test@example.com";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "Test1234!";

setup("authenticate", async ({ request }) => {
  const res = await request.post("/api/auth/signin", {
    form: { email: EMAIL, password: PASSWORD },
    headers: { origin: "http://localhost:4321" },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  await request.storageState({ path: authFile });
});
