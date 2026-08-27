## Inspiration

A chatbot can say “play middle C.” It cannot light that key, and it cannot hear whether you hit it. That is a useless piano teacher.

The WebMCP challenge asked for an app that gets better when a human and an agent share the same live page. I wanted that to be something anyone can use: learn piano on the keys in front of you. Not a lesson in a side chat.

I looked at how hardware instruments are laid out — dual layers, an LCD, generate-and-lock, a roll — but KEYLIT is not a clone of those products. No pads, no kits, no preset banks. The product is the glow: the next note is already lit. You play it. The agent hears you on that same piano.

## What it does

KEYLIT is a sampled piano teacher on one live page.

- Press **teach me**. Middle C glows cyan, with a **Q** on the key.
- You play it — click, type, or a MIDI keyboard. The teacher hears that note and lights the next one.
- Miss, and it stays put: `TRY AGAIN · WANT D4 · YOU E4`.
- **hear it** plays the next note in green so you can copy it.
- When you can hold a chord, **harmonize** only works if your hands are already on the keys.

Lessons: first keys, C major scale, C major chord, Twinkle, Ode to Joy. Or the agent calls `set-next-keys` and invents a drill.

If the agent is not on this page, it cannot light a key or grade your hands. That is the point of WebMCP.

## How we built it

Browser app: Vite, TypeScript, Web Audio, Web MIDI, and WebMCP on `document.modelContext.registerTool`. Samples are open rompler sets (Steinway, CP80, Wurlitzer), not a commercial library.

I used AI. I am not going to pretend otherwise.

- **Ideas and code:** Cursor with Grok 4.6 Extra High Fast. Teacher loop, tools, most of the TypeScript. I directed, edited, and cut what did not serve the page.
- **Design:** Claude Code, Opus 5. The rack, LCD, key glow, and making it sell instead of look like a bed.
- **Testing:** Codex Luna Extra High. Click-throughs: teach me → C4 hit → wrong E4 miss → D4 advances.

The challenge allows AI. I did not name this CodexPiano or claim an official OpenAI product. The name is KEYLIT because the next key lights.

## Challenges we ran into

Native `document.modelContext.registerTool` still fails with `SecurityError` in a locked local browser, so the in-page Studio Agent falls back to local tools. Judges need the live HTTPS URL in ChatGPT’s in-app browser. That deploy, the public repo, and the demo video are still on me before the deadline. Samples and the grade-on-press path have to keep working on that origin, not only on localhost.

## Accomplishments that we're proud of

The lesson only moves when you play the glowing key. A wrong note does not skip ahead. Amber is you, cyan is next, green is the agent — on the same keyboard. Harmonize still refuses if your hands are empty. That is the product, not a chat overlay.

## What we learned

A piano teacher that cannot see the keyboard is a paragraph. A teacher that shares the session is a product. WebMCP only pays off if the tool changes the same keys the human is looking at. `get-lesson-state` after they play is more useful than another chatbot tip.

“Inspired by” is not “copy the pads.” The new thing is the shared lesson.

## What's next for KEYLIT

Ship the HTTPS demo, put the repo and LICENSE on GitHub, and record a under-3-minute video in ChatGPT’s browser: “Teach me piano.” Then freeze for judging. After that: more songs, slower drills, and a teacher that can invent a line and light those keys with `set-next-keys`.
