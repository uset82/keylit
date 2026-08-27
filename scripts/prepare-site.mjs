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
const generated = template.replace("/*__SITES_ASSETS__*/", JSON.stringify(assets));
if (generated === template) {
  throw new Error("Sites asset placeholder is missing from src/site-worker.js");
}

await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", generated);
