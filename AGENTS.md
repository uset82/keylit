# KEYLIT — notes for coding agents

KEYLIT is a browser piano teacher. Vanilla TypeScript + Vite, no framework. The live product is a ChatGPT Site: the page registers tools on `document.modelContext`, and ChatGPT (or the in-page Studio Agent) calls them.

This file is the map. `docs/codex.md` is how to plug Codex into the running page.

## Two agent paths

They share the same 33 tools in `src/webmcp/tools.ts` and the same `store`.

1. **Studio Agent** (the chat box on the page) — `src/agent/studio-agent.ts`. Regex recipes first, then word-to-patch / OpenRouter (`/api/design`) / MiniMax (`/api/music`). Executes via `runTool()` in `src/webmcp/adapter.ts`, which calls the local `execute` functions. It does **not** call ChatGPT or Codex.
2. **Inbound WebMCP** — ChatGPT’s in-app browser (or Chrome with the WebMCP flag) discovers `document.modelContext.registerTool`. Native registration throws `SecurityError` unless the response has `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`. Those headers live in `vite.config.ts` (dev) and `src/site-worker.js` (production). Do not drop them.

A third path exists only on a developer machine: Codex talks to `scripts/keylit-mcp.mjs` (stdio MCP), which forwards piano tools over a loopback WebSocket to `src/dev/codex-bridge.ts`. That file is DEV-only and must never reach `dist/server/index.js`.

## Run

```bash
npm install
npm run dev
```

Vite is pinned to `127.0.0.1:5173` in `vite.config.ts`. If that port is taken it prints another (often 5174). Open that URL, click **Start playing** (or **teach me**) so audio arms.

```bash
npm run build
```

That is `tsc --noEmit && vite build && node scripts/prepare-site.mjs`. It must stay green. `prepare-site.mjs` inlines every asset plus `src/server/design.js` and `src/server/music.js` into one worker.

## Verify

| Script | What it guards |
|---|---|
| `npm run test:lessons` | Every step of every lesson names a hand and a finger |
| `npm run test:generate` | Phrase generator: no overlaps, on the keybed, deterministic |
| `npm run test:design` | `/api/design` failure paths without a live key |
| `npm run test:music` | `/api/music` failure paths without a live key |
| `npm run test:midi` | Controller octave detection, including note-on/note-off pairing |
| `npm run test:mcp` | Codex MCP handshake, the no-page error, and a fake-page round trip |

Then `npm run build`. There is no GitHub Actions CI; these scripts are the net.

## Where things live

| Concern | Path |
|---|---|
| Lesson data and grading | `src/engine/lessons.ts` |
| Incoming MIDI + octave shift | `src/engine/midi-input.ts`, `src/engine/midi-octave.ts` |
| Audio graph, limiters, FX | `src/engine/audio.ts` |
| Phrase generator | `src/engine/generate.ts` |
| WebMCP tools | `src/webmcp/tools.ts` |
| Tool dispatch | `src/webmcp/adapter.ts` (`runTool`, `rememberLocal`) |
| In-page agent recipes | `src/agent/studio-agent.ts` |
| ChatGPT Sites worker | `src/site-worker.js` |
| Codex MCP server | `scripts/keylit-mcp.mjs` |
| DEV bridge (page ↔ Codex) | `src/dev/codex-bridge.ts` |

## Rules that have already cost bugs

- **`state.octave` is the computer keyboard.** Incoming MIDI uses `state.midiShift`. Do not reuse one for the other.
- **Fingering cannot be graded.** Pointer, QWERTY, and Web MIDI carry no finger. Numbers are display-only. Never tell the student they used the wrong finger.
- **Do not deploy ChatGPT Sites from a CLI.** Versions are created and published only at chatgpt.com/sites. Build `dist/`, then a human publishes.
- **Never commit secrets.** `OPENROUTER_API_KEY`, `MINIMAX_API_KEY`, and `MINIMAX_MUSIC_MODEL` are worker `env` only. `.env` is gitignored. The browser must never see those values.
- **`Origin-Agent-Cluster` and `Permissions-Policy: tools=(self)` stay on** every response that serves the app. Without them the page registers no tools inside ChatGPT’s browser.
- **Do not vendor or launch [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web).** That is a desktop launcher that puts ChatGPT Web in Codex’s model picker. It is optional, installed separately, and is not part of this app. See `docs/codex.md`.

## Adding a lesson

One file of data (`src/engine/lessons.ts`), then the compiler will name the rest: `LessonId` in `src/types.ts`, a recipe in `src/agent/studio-agent.ts` **above** the greedy `/teach|learn|lesson/` line. Coach lines are written for a seven-year-old. Say where the key is, not just its name.

## What you are not doing

Do not add a framework, a test runner, or a new production dependency without a human asking. Do not open inbound ports. Do not put the Codex bridge, `ws`, or port 17860 in the Sites worker.
