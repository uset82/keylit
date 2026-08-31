/**
 * stdio MCP server Codex launches from .codex/config.toml.
 *
 * Piano tools live in the page, not here: Web Audio, the store and the glowing
 * keys are browser state. This process speaks MCP on stdin/stdout and a
 * WebSocket on 127.0.0.1 so a DEV tab can register its catalog and run tools.
 *
 * Two tools work with no tab: keylit_status and keylit_run_checks.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PROTOCOL = "2024-11-05";
const DEFAULT_PORT = 17860;
const INVOKE_MS = 20_000;
const PAGE_HINT = "Open http://127.0.0.1:5173 and click Start playing";

const port = Number(process.env.KEYLIT_MCP_PORT) || DEFAULT_PORT;

const LOCAL_TOOLS = [
  {
    name: "keylit_status",
    description:
      "Whether a KEYLIT tab is connected to this MCP server, how many piano tools it advertised, and whether audio is armed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "keylit_run_checks",
    description:
      "Run KEYLIT's check scripts (lessons, generate, design, music, midi) and return their summaries. Does not run test:mcp.",
    inputSchema: { type: "object", properties: {} },
  },
];

/** @type {{ ws: import("ws").WebSocket, tools: object[], ready: boolean, audioBlocked: boolean } | null} */
let page = null;

const pending = new Map();

const textResult = (text, isError = false) => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

const asMcpTool = (entry) => ({
  name: entry.name,
  description: entry.description ?? "",
  inputSchema: entry.inputSchema ?? { type: "object", properties: {} },
});

const pageMissing = () => textResult(`${PAGE_HINT}. Codex cannot touch the piano until that tab is connected.`, true);

const invokeOnPage = (name, input) =>
  new Promise((resolve) => {
    if (!page || page.ws.readyState !== page.ws.OPEN) {
      resolve(pageMissing());
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(textResult(`The page did not answer ${name} in time.`, true));
    }, INVOKE_MS);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (!message.ok) {
        resolve(textResult(String(message.error ?? "tool failed"), true));
        return;
      }
      const result = message.result;
      if (result && typeof result === "object" && Array.isArray(result.content)) return resolve(result);
      resolve(textResult(typeof result === "string" ? result : JSON.stringify(result)));
    });
    page.ws.send(JSON.stringify({ type: "invoke", id, name, input: input ?? {} }));
  });

const runChecks = () =>
  new Promise((resolve) => {
    const scripts = ["test:lessons", "test:generate", "test:design", "test:music", "test:midi"];
    const lines = [];
    const next = (index) => {
      if (index >= scripts.length) {
        resolve(textResult(lines.join("\n")));
        return;
      }
      const child = spawn("npm", ["run", scripts[index]], {
        cwd: process.cwd(),
        env: process.env,
        shell: true,
      });
      let out = "";
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        out += chunk;
      });
      child.on("close", (code) => {
        const summary = out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^(pass|FAIL|all green|All generator|\d+ failing)/.test(line))
          .slice(-6);
        lines.push(`${scripts[index]} (exit ${code ?? 1})`);
        lines.push(summary.join("\n") || out.trim().slice(-400) || "(no output)");
        lines.push("");
        next(index + 1);
      });
    };
    next(0);
  });

const handleCall = async (name, args) => {
  if (name === "keylit_status") {
    const connected = Boolean(page && page.ws.readyState === page.ws.OPEN);
    return textResult(
      JSON.stringify(
        {
          pageConnected: connected,
          toolCount: connected ? page.tools.length : 0,
          ready: connected ? page.ready : false,
          audioBlocked: connected ? page.audioBlocked : null,
          hint: connected ? "Piano tools are live." : PAGE_HINT,
        },
        null,
        2,
      ),
    );
  }
  if (name === "keylit_run_checks") return runChecks();
  if (!page || page.ws.readyState !== page.ws.OPEN) return pageMissing();
  if (!page.tools.some((tool) => tool.name === name)) {
    return textResult(`The connected page did not advertise ${name}.`, true);
  }
  return invokeOnPage(name, args);
};

const listTools = () => {
  const piano = page?.tools ?? [];
  return [...LOCAL_TOOLS, ...piano].map(asMcpTool);
};

/* ---- MCP stdio (Content-Length, same framing Codex uses) ---- */

const writeMessage = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
};

const reply = (id, result) => {
  if (id === undefined || id === null) return;
  writeMessage({ jsonrpc: "2.0", id, result });
};

const replyError = (id, code, message) => {
  if (id === undefined || id === null) return;
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
};

const handleRpc = async (message) => {
  if (!message || message.jsonrpc !== "2.0") return;
  const { id, method, params } = message;
  if (!method) return;

  if (method === "initialize") {
    reply(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "keylit", version: "1.0.0" },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "tools/list") {
    reply(id, { tools: listTools() });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    if (!name) {
      replyError(id, -32602, "tools/call needs a name");
      return;
    }
    try {
      reply(id, await handleCall(name, params?.arguments ?? {}));
    } catch (error) {
      reply(id, textResult(error instanceof Error ? error.message : String(error), true));
    }
    return;
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (id !== undefined) replyError(id, -32601, `Unknown method: ${method}`);
};

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
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
    try {
      void handleRpc(JSON.parse(body));
    } catch {
      // A garbled frame is dropped; the next one still has a length prefix.
    }
  }
});

process.stdin.on("end", () => process.exit(0));

/* ---- loopback WebSocket for the DEV page ---- */

const httpServer = createServer((request, response) => {
  response.writeHead(404);
  response.end();
});

const sockets = new WebSocketServer({ server: httpServer });

const forget = (socket) => {
  if (page?.ws === socket) {
    for (const [id, settle] of pending) {
      settle({ ok: false, error: "The KEYLIT tab disconnected." });
      pending.delete(id);
    }
    page = null;
  }
};

sockets.on("connection", (socket, request) => {
  const host = request.socket.remoteAddress;
  if (host !== "127.0.0.1" && host !== "::1" && host !== ":ffff:127.0.0.1") {
    socket.close();
    return;
  }
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.type === "hello") {
      page = {
        ws: socket,
        tools: Array.isArray(message.tools) ? message.tools : [],
        ready: Boolean(message.ready),
        audioBlocked: Boolean(message.audioBlocked),
      };
      return;
    }
    if (message.type === "status" && page?.ws === socket) {
      page.ready = Boolean(message.ready);
      page.audioBlocked = Boolean(message.audioBlocked);
      return;
    }
    if (message.type === "result" && message.id) {
      const settle = pending.get(message.id);
      if (!settle) return;
      pending.delete(message.id);
      settle(message);
    }
  });
  socket.on("close", () => forget(socket));
  socket.on("error", () => forget(socket));
});

httpServer.on("error", (error) => {
  const detail = error && error.code === "EADDRINUSE" ? `port ${port} is already in use` : String(error);
  process.stderr.write(`keylit-mcp: ${detail}\n`);
  process.exit(1);
});

httpServer.listen(port, "127.0.0.1", () => {
  process.stderr.write(`keylit-mcp: listening 127.0.0.1:${port}\n`);
});

process.stdin.resume();
