import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const distRoot = path.resolve("dist");
const files = [];

async function collectFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath);
    } else {
      files.push(entryPath);
    }
  }
}

await collectFiles(distRoot);

for (const filePath of files) {
  if (!filePath.endsWith(".js")) continue;
  const text = await readFile(filePath, "utf8");
  if (text.includes("codex-bridge") || text.includes("mountCodexBridge")) {
    throw new Error(`Codex DEV bridge leaked into ${path.relative(distRoot, filePath)} — it is localhost-only`);
  }
}

const assets = [];
for (const filePath of files) {
  const relativePath = path.relative(distRoot, filePath).split(path.sep).join("/");
  if (relativePath.startsWith(".openai/") || relativePath.startsWith("server/")) {
    continue;
  }

  const extension = path.extname(relativePath).toLowerCase();
  const contentType = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
  }[extension] ?? "application/octet-stream";

  assets.push([
    `/${relativePath}`,
    { contentType, body: (await readFile(filePath)).toString("base64") },
  ]);
}

assets.sort(([first], [second]) => first.localeCompare(second));
const template = await readFile("src/site-worker.js", "utf8");

/*
 * Inline the shared server modules rather than importing them. Only one worker
 * file is written, so a real import would resolve to nothing once deployed.
 */
const inlineServerModule = async (sourcePath) => {
  const source = await readFile(sourcePath, "utf8");
  if (/^\s*import\s/m.test(source)) {
    throw new Error(`${sourcePath} must stay import-free: it is inlined into the Sites worker, not bundled`);
  }
  return source.replace(/^export const /gm, "const ").replace(/^export /gm, "");
};
const inlinedDesignHandler = await inlineServerModule("src/server/design.js");
const inlinedMusicHandler = await inlineServerModule("src/server/music.js");

let generated = template.replace("/*__SITES_ASSETS__*/", JSON.stringify(assets));
if (generated === template) {
  throw new Error("Sites asset placeholder is missing from src/site-worker.js");
}
const withDesignHandler = generated.replace("/*__DESIGN_HANDLER__*/", inlinedDesignHandler);
if (withDesignHandler === generated) {
  throw new Error("Design handler placeholder is missing from src/site-worker.js");
}
const withMusicHandler = withDesignHandler.replace("/*__MUSIC_HANDLER__*/", inlinedMusicHandler);
if (withMusicHandler === withDesignHandler) {
  throw new Error("Music handler placeholder is missing from src/site-worker.js");
}
generated = withMusicHandler;

await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", generated);
