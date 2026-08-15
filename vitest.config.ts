/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import type { Plugin, UserConfig } from "vite";

// Node caches the timezone when a thread starts, and `test.env` below is applied *inside*
// the worker — too late to move it. That is invisible under Vitest's default forks pool but
// fatal under @stryker-mutator/vitest-runner, which forces `pool: "threads"`: the boundary
// tables would silently run in the developer's local timezone. Setting it here, in the main
// process at config load, is what every worker then inherits at startup.
process.env.TZ = "UTC";

// The `test` block belongs in getViteConfig's FIRST argument — its signature is
// getViteConfig(userViteConfig, inlineAstroConfig?), so anything passed second is read as
// Astro inline config and the Vitest options are silently dropped.
//
// Going through Astro (rather than a bare defineConfig) is what registers the astroEnv
// virtual-module plugin, so `astro:env/server` and the `@/*` alias both resolve in tests
// without any mocking.
const astroViteConfig = getViteConfig({
  test: {
    // Astro 6 removed Astro-component rendering in client environments; server code is all
    // this suite touches anyway.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // isAtRisk() compares local-date strings. Cloudflare's workerd runs UTC
    // (context/foundation/infrastructure.md), so pin the runner to match production rather
    // than let the boundary tables drift with the developer's timezone.
    env: { TZ: "UTC" },
    // Globals stay off: every test imports describe/it/expect/vi explicitly, which keeps
    // ESLint's no-undef and strictTypeChecked working without a globals declaration.
    globals: false,
  },
});

// astro.config.mjs sets the Cloudflare adapter, so getViteConfig() drags in
// @cloudflare/vite-plugin. That plugin refuses to start when a worker environment carries
// `resolve.external` — which Astro's own SSR config sets — and Vitest never gets past
// config resolution. Nothing in this suite runs on workerd (tests are `environment: "node"`
// and the provider fetch is stubbed), so the adapter's plugins are dropped for tests only.
// The build path is untouched: `astro build` never reads this file.
function stripCloudflarePlugins(config: UserConfig): UserConfig {
  return {
    ...config,
    plugins: flattenPlugins(config.plugins ?? []).filter((plugin) => !/cloudflare/i.test(plugin.name)),
  };
}

// Vite's PluginOption is arbitrarily nested and includes false/null/promises; flattening it
// with `.flat(Infinity)` makes tsc give up (ts2589), so walk it by hand.
function flattenPlugins(input: readonly unknown[]): Plugin[] {
  const flat: Plugin[] = [];

  for (const item of input) {
    if (Array.isArray(item)) {
      flat.push(...flattenPlugins(item as readonly unknown[]));
    } else if (item && typeof item === "object" && "name" in item) {
      flat.push(item as Plugin);
    }
  }

  return flat;
}

export default async (env: Parameters<typeof astroViteConfig>[0]) => stripCloudflarePlugins(await astroViteConfig(env));
