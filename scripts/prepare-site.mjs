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
 * Inline the shared server module rather than importing it. Only one file gets
 * written (dist/server/index.js) and nothing bundles it, so a real import would
 * resolve to nothing once deployed. Stripping the `export ` keywords turns the
 * module into plain top-level declarations the worker can call directly, which
 * is why src/server/design.js is required to have no imports of its own.
 */
const handlerSource = await readFile("src/server/design.js", "utf8");
if (/^\s*import\s/m.test(handlerSource)) {
  throw new Error("src/server/design.js must stay import-free: it is inlined into the Sites worker, not bundled");
}
const inlinedHandler = handlerSource.replace(/^export const /gm, "const ").replace(/^export /gm, "");

let generated = template.replace("/*__SITES_ASSETS__*/", JSON.stringify(assets));
if (generated === template) {
  throw new Error("Sites asset placeholder is missing from src/site-worker.js");
}
const withHandler = generated.replace("/*__DESIGN_HANDLER__*/", inlinedHandler);
if (withHandler === generated) {
  throw new Error("Design handler placeholder is missing from src/site-worker.js");
}
generated = withHandler;

await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", generated);
