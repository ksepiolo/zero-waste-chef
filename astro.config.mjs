// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  // The dev toolbar is a fixed-position overlay that intercepts pointer events at
  // click coordinates under real automation, causing Playwright click retries to
  // time out (`<astro-dev-toolbar> intercepts pointer events`). Off only for
  // `npm run dev:e2e`; unaffected for plain `npm run dev`.
  devToolbar: { enabled: process.env.npm_lifecycle_event !== "dev:e2e" },
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // `sonner` is only ever imported by client-hydrated islands, so Vite's initial SSR dep
    // crawl at server start misses it. The first request that renders it then triggers a
    // mid-session re-optimize + reload (see Vite's "Automatic Dependency Discovery"), which
    // races real requests and hands them a stale React copy — "Invalid hook call" /
    // "Cannot read properties of null (reading 'useState')" in Toaster. Forcing it into the
    // upfront optimization pass for both environments removes the race.
    optimizeDeps: {
      include: ["sonner", "astro/env/runtime"],
    },
    ssr: {
      optimizeDeps: {
        include: ["sonner", "astro/env/runtime"],
      },
    },
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_URL: envField.string({
        context: "server",
        access: "public",
        optional: true,
        default: "https://openrouter.ai/api/v1/chat/completions",
      }),
    },
  },
});
