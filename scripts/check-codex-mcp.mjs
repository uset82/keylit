/**
 * The Codex MCP server has to fail closed without a tab, and has to round-trip
 * a tool call once a tab (or a stand-in) is connected. A hang or a silent
 * success with no page would look like a working teacher to Codex.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const PORT = 17861;
const PAGE_HINT = "Open http://127.0.0.1:5173 and click Start playing";

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`}`);
};

const checkMatch = (label, actual, pattern) => {
  const ok = pattern.test(String(actual ?? ""));
  if (!ok) failures += 1;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(actual)})`}`);
};

const encode = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
};

const readMessages = async (stream, count, ms = 8000) => {
  const found = [];
  let buffer = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${count} MCP frames`)), ms);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) return;
        const body = buffer.subarray(start, start + length).toString("utf8");
        buffer = buffer.subarray(start + length);
        found.push(JSON.parse(body));
        if (found.length >= count) {
          clearTimeout(timer);
          stream.off("data", onData);
          resolve(found);
        }
      }
    };
    stream.on("data", onData);
  });
};

const waitForPort = (port, ms = 8000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const socket = createConnection({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        if (Date.now() - start > ms) reject(new Error(`port ${port} never opened`));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });

const child = spawn(process.execPath, ["scripts/keylit-mcp.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, KEYLIT_MCP_PORT: String(PORT) },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const shutdown = () => {
  if (!child.killed) child.kill("SIGTERM");
};

try {
  await waitForPort(PORT);
  checkMatch("server announces the loopback port", stderr, /listening 127\.0\.0\.1:17861/);

  child.stdin.write(
    encode({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "check-codex-mcp", version: "1" } },
    }),
  );
  const [initialized] = await readMessages(child.stdout, 1);
  check("initialize names the server keylit", initialized.result?.serverInfo?.name, "keylit");

  child.stdin.write(encode({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const [listed] = await readMessages(child.stdout, 1);
  const names = (listed.result?.tools ?? []).map((tool) => tool.name);
  check("tools/list includes keylit_status with no page", names.includes("keylit_status"), true);
  check("tools/list includes keylit_run_checks with no page", names.includes("keylit_run_checks"), true);
  check("tools/list has no piano tools without a page", names.includes("start-lesson"), false);

  child.stdin.write(
    encode({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "start-lesson", arguments: { lesson: "first-keys" } },
    }),
  );
  const [missing] = await readMessages(child.stdout, 1);
  const missingText = missing.result?.content?.[0]?.text ?? "";
  check("start-lesson without a page is an error", missing.result?.isError, true);
  checkMatch("start-lesson without a page tells you to open the app", missingText, new RegExp(PAGE_HINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  child.stdin.write(encode({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "keylit_status" } }));
  const [status] = await readMessages(child.stdout, 1);
  const statusBody = JSON.parse(status.result?.content?.[0]?.text ?? "{}");
  check("status with no page is disconnected", statusBody.pageConnected, false);

  const page = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((resolve, reject) => {
    page.addEventListener("open", resolve);
    page.addEventListener("error", () => reject(new Error("fake page could not connect")));
  });

  const invocations = [];
  page.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type !== "invoke") return;
    invocations.push(message);
    const hit = message.name === "start-lesson" && message.input?.lesson === "first-keys";
    page.send(
      JSON.stringify({
        type: "result",
        id: message.id,
        ok: hit,
        result: hit
          ? { content: [{ type: "text", text: "Lesson started: Play C D E." }] }
          : undefined,
        error: hit ? undefined : `unexpected ${message.name}`,
      }),
    );
  });

  page.send(
    JSON.stringify({
      type: "hello",
      tools: [
        {
          name: "start-lesson",
          description: "Start a piano lesson",
          inputSchema: { type: "object", properties: { lesson: { type: "string" } } },
        },
      ],
      ready: true,
      audioBlocked: false,
    }),
  );

  // hello is processed on the next tick of the server; give it one.
  await new Promise((resolve) => setTimeout(resolve, 50));

  child.stdin.write(encode({ jsonrpc: "2.0", id: 5, method: "tools/list" }));
  const [listedLive] = await readMessages(child.stdout, 1);
  const liveNames = (listedLive.result?.tools ?? []).map((tool) => tool.name);
  check("tools/list adds start-lesson after hello", liveNames.includes("start-lesson"), true);

  child.stdin.write(encode({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "keylit_status" } }));
  const [liveStatus] = await readMessages(child.stdout, 1);
  const liveBody = JSON.parse(liveStatus.result?.content?.[0]?.text ?? "{}");
  check("status sees the connected page", liveBody.pageConnected, true);
  check("status reports the advertised tool count", liveBody.toolCount, 1);
  check("status reports audio armed", liveBody.ready, true);

  child.stdin.write(
    encode({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "start-lesson", arguments: { lesson: "first-keys" } },
    }),
  );
  const [started] = await readMessages(child.stdout, 1);
  check("start-lesson reaches the page", invocations[0]?.name, "start-lesson");
  check("start-lesson forwards the lesson id", invocations[0]?.input?.lesson, "first-keys");
  check("start-lesson returns the page result", started.result?.content?.[0]?.text, "Lesson started: Play C D E.");
  check("start-lesson is not flagged as an error", Boolean(started.result?.isError), false);

  page.close();

  const worker = path.resolve("dist/server/index.js");
  if (existsSync(worker)) {
    const text = readFileSync(worker, "utf8");
    check("production worker source has no codex-bridge", text.includes("codex-bridge"), false);
    check("production worker source has no mountCodexBridge", text.includes("mountCodexBridge"), false);
  } else {
    check("production worker source has no codex-bridge", "skipped-no-dist", "skipped-no-dist");
    check("production worker source has no mountCodexBridge", "skipped-no-dist", "skipped-no-dist");
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL  ${error instanceof Error ? error.message : error}`);
} finally {
  shutdown();
}

await new Promise((resolve) => {
  if (child.exitCode !== null) {
    resolve();
    return;
  }
  child.on("exit", resolve);
  setTimeout(() => {
    child.kill("SIGKILL");
    resolve();
  }, 1500);
});

console.log(failures ? `\n${failures} failing` : "\nall green");
process.exit(failures ? 1 : 0);
