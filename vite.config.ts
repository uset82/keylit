import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sites()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
