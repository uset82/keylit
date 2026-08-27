import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await copyFile("src/site-worker.js", "dist/server/index.js");
