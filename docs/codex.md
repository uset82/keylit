# Codex and KEYLIT

Codex can edit this repo the way any coding agent can — read `AGENTS.md` first. This page is the extra path: Codex calling the **same piano tools** ChatGPT uses on the live page, without opening ChatGPT.

It is not a copy of [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web). That project is a desktop launcher that puts ChatGPT Web in Codex’s model picker. KEYLIT does not vendor it, start it, or talk to it.

## What talks to what

```
Codex CLI / Codex app
        │  stdio MCP  (.codex/config.toml → scripts/keylit-mcp.mjs)
        ▼
loopback WebSocket  127.0.0.1:17860
        │
        ▼
the DEV page  (src/dev/codex-bridge.ts → runTool)
        │
        ▼
the 33 tools in src/webmcp/tools.ts
```

ChatGPT Sites is unchanged: when the deployed site is open in ChatGPT’s browser, ChatGPT calls those tools through WebMCP. No tunnel, no public IP, no remote connector to your laptop.

## Setup

1. Install the [Codex CLI](https://developers.openai.com/codex) and **trust this directory**. Project `.codex/config.toml` is ignored until you do.
2. `npm install` then `npm run dev`. Open the URL Vite prints (`http://127.0.0.1:5173`, or 5174 if 5173 is taken).
3. Click **Start playing** so audio arms. The rack readout should grow a `· Codex` suffix once the MCP server is up — Codex starts `scripts/keylit-mcp.mjs` when a session begins.
4. In Codex, run `/mcp`. You should see `keylit`, then `keylit_status`, `keylit_run_checks`, and the piano tools (`start-lesson`, `get-lesson-state`, …).
5. Ask Codex to start `first-keys`. The cyan key should light on the page.

If `/mcp` lists only `keylit_status` and `keylit_run_checks`, the tab is not connected. Open the DEV URL and click Start playing. Calling a piano tool with no tab returns: *Open http://127.0.0.1:5173 and click Start playing*.

`keylit_status` reports whether a tab is connected and whether audio is armed. `keylit_run_checks` runs the five product check scripts (not `test:mcp`).

## Optional: ChatGPT Web as Codex’s model

If you want Codex itself to use ChatGPT Web (Luna / Instant / …) instead of the API model, install [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) with **its** installer, on **your** machine:

```powershell
irm https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.ps1 | iex
```

Then follow their MCP page: new connector named exactly `Codex Native2`, permissions **Allow all actions**. That launcher does not start KEYLIT and KEYLIT does not start that launcher. Do not commit its profile, cookies, or API keys here.

## What must not ship

`src/dev/codex-bridge.ts` is imported only when `import.meta.env.DEV` is true. `npm run build` must leave `codex-bridge` out of `dist/server/index.js`. `npm run test:mcp` checks that.
