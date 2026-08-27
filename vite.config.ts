import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

// Mirror the headers src/site-worker.js serves in production. Without the
// origin-keyed agent cluster, native WebMCP throws SecurityError and dev
// silently falls back to the polyfill, hiding native-only breakage.
const webmcpHeaders = {
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "tools=(self)",
};

export default defineConfig({
  plugins: [sites()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    headers: webmcpHeaders,
  },
  preview: {
    headers: webmcpHeaders,
  },
});
