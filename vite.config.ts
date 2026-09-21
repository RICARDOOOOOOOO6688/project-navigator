// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv, type Plugin } from "vite";

// The Lovable config only injects VITE_* vars (as import.meta.env). Server-only
// vars read via process.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DIFY_API_KEY…)
// are not loaded during `vite dev`, so load the whole .env into process.env here.
// Real shell/CI env always wins over .env values.
function loadServerEnv(): Plugin {
  return {
    name: "load-server-env",
    config(_config, env) {
      const loaded = loadEnv(env.mode, process.cwd(), "");
      for (const [key, value] of Object.entries(loaded)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [loadServerEnv()],
  },
});
