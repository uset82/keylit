# KEYBED — WebMCP Challenge playbook

Official sources: [OpenAI challenge](https://openai.com/webmcp-challenge/), [Devpost](https://webmcp.devpost.com/), [Official Rules](https://webmcp.devpost.com/rules), [Resources / FAQ](https://webmcp.devpost.com/resources), [WebMCP spec](https://github.com/webmachinelearning/webmcp), [Chrome WebMCP](https://developer.chrome.com/docs/ai/webmcp), [Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), [Best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices).

Deadline: **3 September 2026, 1:00 pm Pacific**. After that, do not touch Devpost, the repo, or the live URL until winners (~23 September).

---

## 1. What the contest actually wants

One sentence from OpenAI:

> Build something we haven’t seen before: an app that becomes **meaningfully better** when people and their agents can use it together.

WebMCP is not “add ChatGPT next to a website.” It is: the **same live page and session** expose `document.modelContext` tools. The agent calls functions. The human sees the UI update. No DOM scraping.

Chrome’s framing (judges include Sarah Drasner / Chrome and Justin Rushing / OpenAI Browser):

- Discovery: register tools on the page
- JSON Schema: stop hallucination
- Shared state: agent and human see the same instrument
- Visible execution: tools run in the tab so the user trusts them
- Human in the loop: not headless

Showcase apps they already published (do **not** clone these): grocery cart, 3D modeling, crossword, writing, beat machine ([Fieldwork // 12](https://developers.openai.com/showcase/)). KEYBED’s wedge: **a piano teacher on the same live keys** — the agent lights the next note, the student plays it, the agent hears it. That loop is impossible if the agent is in a side chat.

---

## 2. Clock, prizes, eligibility

| When | What |
|---|---|
| 25 Aug 11:00 PT – 3 Sep 13:00 PT | Register + submit |
| 4 Sep 10:00 PT – 21 Sep 17:00 PT | Judging (do not edit live site / repo / Devpost) |
| ~23 Sep 14:00 PT | Winners |

**10 winners.** Each: OpenAI $3,000 + Codex Micro + ChatGPT Pro (up to 3 people) + merch + Cloudflare / Vercel / Render / Netlify / Shopify / Chrome extras. Cash line-item is **$3,500** (OpenAI $3k + Netlify $500).

Eligible: majority age, country that can use OpenAI API. **Not** Brazil, China, Hong Kong, Quebec, Russia, Crimea, Cuba, Iran, NK, Syria, Venezuela, Donetsk/Luhansk. Norway is fine.

One project per team. Team size unlimited; some prizes cap at 3 people.

Existing apps are allowed **only if WebMCP work after 25 Aug 11:00 PT is documented** (commits). Pre-period work is ignored. KEYBED WebMCP was built in this window — keep the git history clean and public.

AI coding is allowed. Do **not** let AI pick a vague name or overclaim.

---

## 3. Stage-one filter (pass / fail)

If any of these fail, you never reach scoring:

1. **Live HTTPS URL** that opens in **ChatGPT desktop in-app browser** or **Chrome 149+** with `chrome://flags/#enable-webmcp-testing`
2. Native **`document.modelContext.registerTool({ name, description, inputSchema, execute })`** in the public repo (they literally require this pattern)
3. **Public repo + LICENSE** visible in GitHub “About”
4. **English** description + **<3 min YouTube video with audio** (no copyrighted music)
5. App **works as the video claims**

Judges are **not required** to click the live URL. Video + README + description must carry the win if they only skim.

---

## 4. How they score (equal weight)

### WebMCP Leverage

Thorough, skillful, **non-trivial**, **working** native tools.

Chrome wants:

- Clear verb names (`play-notes`, not `doStuff`)
- One job per tool, little overlap
- Strict code validation, loose-enough schema
- UI updates after every tool
- `execute(input, { signal })` cancellation
- Optional: annotations (`readOnlyHint`), `toolchange`, declarative HTML `toolname` / `tooldescription`

**KEYBED now:** 12+ tools, shared keys, local Studio Agent. **Risk:** native register often **SecurityError** in locked browsers; we fall back to polyfill. ChatGPT’s browser is the judge path — **native must succeed on the deployed HTTPS origin.**

### Execution

A finished product, not a tools demo.

**KEYBED now:** dual-layer sampled rompler, FX, generate, MIDI in, sustain. Looks like a product. Must stay that way on the live URL (samples load, audio arms, tools light keys).

### Potential Impact

Specific audience + real problem + demo proves it.

**Audience:** anyone who wants to start piano, plus players with an APC Key 25 / Roland / Yamaha who want a teacher **on the keys**.

**Problem:** a chatbot can name “middle C” but cannot light that key or hear whether you hit it. Scraping a piano UI is late and wrong. WebMCP lets the agent show the next keys and grade the same session.

### Creativity & Ambition

Different from storefront / form-fill / travel booking.

Music + MIDI + shared performance is rare. Official showcase already has a **beat machine** — sell KEYBED as **instrument + controller + human/agent duet**, not another sequencer.

Tie-break order: Leverage → Execution → Impact → Creativity.

---

## 5. Official WebMCP knowledge (implement this, not the polyfill-only path)

```js
await document.modelContext.registerTool({
  name: "play-notes",
  description: "Play MIDI notes on the shared KEYBED piano. Lights the on-screen keys.",
  inputSchema: {
    type: "object",
    properties: {
      notes: { type: "array", items: { type: "integer", minimum: 0, maximum: 127 } },
      velocity: { type: "integer", minimum: 1, maximum: 127 },
      durationMs: { type: "integer", minimum: 20, maximum: 8000 },
    },
    required: ["notes"],
  },
  execute: async (input, { signal } = {}) => { /* ... */ },
});
```

Also used by judges / Chrome inspector:

- `document.modelContext.getTools()`
- `document.modelContext.executeTool(tool, '{"notes":[60,64,67]}')` — **JSON string**, not an object
- `toolchange` event
- Permissions-Policy `tools` (default `self`)
- Secure origin; `Origin-Agent-Cluster` must stay isolated (`?1`)
- Two APIs: **imperative** (JS) and **declarative** (HTML `toolname` + `tooldescription`)

Test:

1. ChatGPT desktop → in-app browser → live URL → “play a C major chord”
2. Chrome flag on → [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp)
3. Optional: Chrome DevTools WebMCP panel

---

## 6. KEYBED scorecard (today)

| Requirement | Status | Action |
|---|---|---|
| Human + agent same session | Strong | Keep Studio Agent + native tools on one rack |
| `registerTool` in repo | Partial | Must be `document.modelContext` on HTTPS, not only polyfill |
| Live URL | Missing | Deploy Vercel / Cloudflare / Netlify |
| Public GitHub + LICENSE | Missing | MIT + push |
| Permissions-Policy `tools` | Missing | Add response header |
| ChatGPT browser test | Missing | This is the judge path |
| Demo video | Missing | <3 min, voiceover, WebMCP first |
| Devpost 4 paragraphs | Draft below | Paste on step 3 |
| Samples / audio | Working locally | Must work on live host (CORS) |
| Hardware MIDI | Working | Optional in video; do not require it for judges |

---

## 7. Paste this on Devpost — Project overview

**Project name** (54 / 60):

```
KEYLIT — learn piano. The next key is already glowing.
```

**Elevator pitch** (139 / 200):

```
Never guess which key is next. KEYLIT lights it. You play it. ChatGPT hears you on that same piano — so anyone can start, on one live page.
```

Thumbnail: 3:2 JPG of the amber LCD + a cyan glowing key (no third-party logos). Avoid the generic Devpost collage.

---

## 8. Paste this on Devpost — Project details

### About the project (Markdown)

```markdown
## Inspiration

A chatbot can say “play middle C.” It cannot light that key, and it cannot hear whether you hit it. That is a useless piano teacher.

The WebMCP challenge asked for an app that gets better when a human and an agent share the same live page. I wanted that to be something anyone can use: learn piano on the keys in front of you. Not a lesson in a side chat. Not a drum generator with a chatbot taped on.

I looked at how hardware instruments are laid out — dual layers, an LCD, generate-and-lock, a roll — but KEYLIT is not a clone of those products. No pads, no kits, no preset banks. The product is the glow: the next note is already lit. You play it. The agent hears you on that same piano.

## What it does

KEYLIT is a sampled piano teacher on one page.

- Press **teach me**. Middle C glows cyan, with a **Q** on the key.
- You play it (click, type, or a MIDI keyboard). The teacher hears that note and lights the next one.
- Miss, and it stays put: `TRY AGAIN · WANT D4 · YOU E4`.
- **hear it** plays the next note in green so you can copy it.
- When you can hold a chord, **harmonize** only works if your hands are already on the keys.

Lessons: first keys, C major scale, C major chord, Twinkle, Ode to Joy. Or the agent calls `set-next-keys` and invents a drill.

That loop is the WebMCP point. If the agent is not on this page, it cannot light a key or grade your hands.

## How I built it

I built KEYLIT in the browser: Vite, TypeScript, Web Audio, Web MIDI, and WebMCP tools on `document.modelContext.registerTool`. Samples come from open rompler sets (Steinway, CP80, Wurlitzer) — not from a commercial instrument library.

I am going to be honest about the tools:

- **Ideas and code:** Cursor with Grok 4.6 (Extra High Fast). That is where the teacher loop, the tools, and most of the TypeScript came from. I directed, edited, and threw out what did not serve the page.
- **Design:** Claude Code, Opus 5. The rack, LCD, key glow, and the “sell it, don’t label it” pass.
- **Testing:** OpenAI Codex Luna (Extra High). Click-throughs on the live lesson: teach me → C4 hit → wrong E4 miss → D4 advances.

AI is allowed in this challenge. I used it. I did not let it name the product “CodexPiano” or claim an official OpenAI tie-in. The name is KEYLIT because the next key lights.

## What I learned

A piano teacher that cannot see the keyboard is a paragraph. A teacher that shares the session is a product. WebMCP only pays off if the tool changes the same keys the human is looking at. `get-lesson-state` after they play is more useful than another chatbot tip.

I also learned that “inspired by” is not “copy the pads.” Generate, lock, and a roll are old instrument patterns. The new thing is the shared lesson.

## Challenges

Native `document.modelContext.registerTool` still fails with `SecurityError` in a locked local browser, so the in-page Studio Agent falls back to local tools. The judged path is ChatGPT’s in-app browser on a **live HTTPS URL** — that deploy is still on me before the deadline. Samples, sustain, and the grade-on-press path have to keep working on that origin, not only on localhost.

## Tools the agent actually calls

`start-lesson`, `set-next-keys`, `get-lesson-state`, `show-next-keys`, `demo-next`, `harmonize-held`, `answer-human`, `follow-human`, `play-notes`, `set-layer`, `set-fx`, `set-sustain`.
```

### Built with (tags, add one at a time)

`typescript` `vite` `web-audio` `web-midi` `webmcp` `smplr` `tailwindcss` `cursor` `grok` `claude` `openai-codex`

### Try it out

Add these when they exist (do not invent them):

1. Live HTTPS demo — ChatGPT in-app browser
2. Public GitHub repo + LICENSE

---

### Why this is a strong fit for WebMCP (if a later field asks)

A chatbot can say “play middle C.” It cannot light that key or hear whether you hit it. KEYLIT can. WebMCP tools start a lesson, glow the next notes, demo them in green, and read what you just played on the same piano. Anyone can start — no teacher in the room, no music-school app that talks past your hands.

### How it creates a better user experience

You never leave the keyboard. The teacher is the glow on the next key, not a paragraph in a side chat. `start-lesson` lights C. You play it. `get-lesson-state` says hit — then D lights. Miss, and it stays put: `TRY AGAIN · WANT D4`. After you can hold a chord, harmonize still needs your hands first. That is the product.

### What people and agents can do together that was hard before

Learn: the agent lights C, then D, then E — you cannot finish the lesson unless you play those keys. Jam: you hold a chord, the agent harmonizes on the same piano. Sound design: the agent sets FX while you keep both hands on an APC Key 25, Roland, or Yamaha. None of that works if the agent is clicking piano CSS.

### How we implemented WebMCP

Tools register with `document.modelContext.registerTool` (imperative API: name, description, JSON Schema, `execute`). They mutate the same store the UI reads, so agent and human stay in sync. A polyfill covers browsers without native WebMCP; the judged path is ChatGPT’s in-app browser and Chrome with `chrome://flags/#enable-webmcp-testing`. Tools include `start-lesson`, `set-next-keys`, `get-lesson-state`, `show-next-keys`, `demo-next`, `harmonize-held`, `play-notes`, `set-layer`, `set-fx`, and `set-sustain`.

---

## 9. Video script (~2:20, you talk, no copyrighted music)

1. **0:00–0:20** Problem: APC Key 25 / any MIDI controller is silent without a host; agents cannot play it by scraping.
2. **0:20–0:50** Open live URL in ChatGPT browser. Show tools listed. “Play C major.” Keys light, chord sounds.
3. **0:50–1:20** You play QWERTY. Agent: “yamaha” / set CP80. Both on one rack.
4. **1:20–1:50** Generate phrase + export MIDI. LCD + roll update.
5. **1:50–2:20** One sentence: WebMCP = shared instrument, not a chatbot. Show `registerTool` in the repo.

---

## 10. Seven-day build-to-win list

Must ship before 3 Sep 13:00 PT:

1. **HTTPS deploy** + `Permissions-Policy: tools=(self)` + confirm `document.modelContext.registerTool` count > 0 in ChatGPT desktop.
2. **Public GitHub**: MIT `LICENSE`, README with judge steps (Chrome flag + ChatGPT + three prompts).
3. **Judge README block** at the top: live URL, “open in ChatGPT browser”, prompts: `Teach me piano`, `Show the next keys`, `I played them — what next?`
4. **Native adapter fix**: prefer `document.modelContext`; `executeTool` JSON-string if needed; pass `signal`; keep polyfill as fallback only.
5. **Optional leverage points**: one declarative tool on Generate; `readOnlyHint` on `get-instrument-state`; `toolchange` when patches load.
6. **Video + Devpost** using the copy above.
7. Freeze. Fork if you keep building.

Sponsor freebies (optional): [Netlify credits form](https://forms.gle/xw75XGUQzCXEiALc7) by **1 Sep 12:00 PT**; Render $50 credits (first 500).
