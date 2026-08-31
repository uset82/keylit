/**
 * DEV-only socket back to scripts/keylit-mcp.mjs.
 *
 * Codex cannot see the piano from a stdio process: the keys, the store and
 * Web Audio live in this tab. This file registers the local tool catalog on
 * connect and runs each invoke through `runTool`, the same path the Studio
 * Agent uses. If the MCP server is not running the socket fails quietly —
 * the app does not depend on it.
 *
 * Vite dead-strips the import in production. Keep it that way: this file
 * must never appear in dist/server/index.js.
 */
import { listLocalCatalog, runTool } from "../webmcp/adapter";
import { state, subscribe } from "../store";

const DEFAULT_PORT = 17860;
const RETRY_MS = 2500;

const port = Number(import.meta.env.VITE_KEYLIT_MCP_PORT) || DEFAULT_PORT;

const badge = (connected: boolean): void => {
  const status = document.querySelector("#webmcp-status");
  if (!status) return;
  const base = (status.textContent ?? "WebMCP · local tools").replace(/\s·\sCodex$/, "");
  status.textContent = connected ? `${base} · Codex` : base;
};

const snapshot = () => ({
  type: "hello" as const,
  tools: listLocalCatalog(),
  ready: state.ready,
  audioBlocked: state.audioBlocked,
});

export const mountCodexBridge = (): void => {
  let socket: WebSocket | null = null;
  let retry: number | null = null;
  let stopWatch: (() => void) | null = null;

  const clearRetry = (): void => {
    if (retry === null) return;
    window.clearTimeout(retry);
    retry = null;
  };

  const schedule = (): void => {
    if (retry !== null) return;
    retry = window.setTimeout(() => {
      retry = null;
      connect();
    }, RETRY_MS);
  };

  const connect = (): void => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    let next: WebSocket;
    try {
      next = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch {
      schedule();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      if (socket !== next) return;
      next.send(JSON.stringify(snapshot()));
      badge(true);
    });

    next.addEventListener("message", (event) => {
      if (socket !== next) return;
      let message: { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type !== "invoke" || !message.id || !message.name) return;
      const id = message.id;
      const name = message.name;
      void (async () => {
        try {
          const result = await runTool(name, message.input ?? {});
          if (socket === next && next.readyState === WebSocket.OPEN) {
            next.send(JSON.stringify({ type: "result", id, ok: true, result }));
          }
        } catch (error) {
          if (socket === next && next.readyState === WebSocket.OPEN) {
            next.send(
              JSON.stringify({
                type: "result",
                id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }
      })();
    });

    next.addEventListener("close", () => {
      if (socket !== next) return;
      socket = null;
      badge(false);
      schedule();
    });

    next.addEventListener("error", () => {
      // close follows; retry is scheduled there.
    });
  };

  stopWatch = subscribe(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({ type: "status", ready: state.ready, audioBlocked: state.audioBlocked }),
    );
  });

  connect();

  window.addEventListener("beforeunload", () => {
    clearRetry();
    stopWatch?.();
    socket?.close();
  });
};
