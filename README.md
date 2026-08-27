# KEYLIT

**Learn piano. The next key is already glowing.**

You play it. Your teacher hears you *on this page* — not in a chat that cannot see your hands.

🎹 **[Try it](https://keyboard-midi.uset182.chatgpt.site/)** · 💬 **[Share an idea](https://github.com/uset82/keylit/discussions)** · 🛠 **[Contribute](CONTRIBUTING.md)**

---

## Why this exists

Piano lessons are expensive, and so are most of the apps that replace them. KEYLIT is an attempt at a tutor that costs nothing and still does the thing a tutor does: it shows you what to play, watches you play it, and only then moves on.

It is built for someone who has never touched a piano. It does not start with "press C" — it starts by teaching you **how to find C**, because the black keys come in groups of two and three, and C hides just left of every group of two. That is how anyone finds a note on any piano, and no app had ever bothered to tell me.

Built for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/). This is Phase 1, and it already works today.

## What it does

- **Teaches you to find notes**, not just to press them — black-key groups, then letters, then fingers
- **Finger numbers and a hand map** — thumb is 1, little finger is 5, on both hands
- **Fifteen lessons**, from "find any C" to Für Elise, plus a duet where the agent plays the backing and you play the melody
- **Listens on the page.** The agent registers tools with `document.modelContext`, so it can see which key you actually pressed. A chat in another tab cannot do that.
- **Real sound** — sampled piano, or your own USB/Bluetooth MIDI keyboard if you have one
- Works on a phone

## The colours mean things

| | |
|---|---|
| 🔵 **Cyan** | play this next |
| 🟣 **Violet** | look here — the black-key group that locates the note |
| 🟡 **Amber** | you |
| 🟢 **Green** | your teacher |

## Run it

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`, click **teach me**, and press the cyan key. That is the product.

```bash
npm run build
```

## For judges

1. Open the live URL in **ChatGPT's in-app browser**, or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`.
2. Press **Start playing** to arm audio.
3. Try: `Teach me piano` · `Happy Birthday` · `Show the next keys` · `Harmonize`

Tools register with `document.modelContext.registerTool`.

**Teaching:** `start-lesson`, `set-next-keys`, `get-lesson-state`, `show-next-keys`, `demo-next`
**Once you can play:** `harmonize-held`, `answer-human`, `follow-human`

## Help make it better

Contributions are genuinely welcome, and **not only code**.

- **Ideas, questions, a song you want taught** → [Discussions](https://github.com/uset82/keylit/discussions)
- **Something is broken** → [open an issue](https://github.com/uset82/keylit/issues/new/choose)
- **Ready to change something** → see [CONTRIBUTING.md](CONTRIBUTING.md); adding a lesson touches one file

The most useful thing you can give this project is not a patch. It is telling us that a lesson confused a beginner, or that a phrase made no sense to a child. That is the part software cannot check for itself.

## Built on

Vanilla TypeScript and Vite — no framework, on purpose. Web Audio, Web MIDI, and [WebMCP](https://github.com/webmachinelearning/webmcp). Samples via [smplr](https://github.com/danigb/smplr) (Splendid Grand, FluidR3 and MusyngKite soundfonts). Only public-domain tunes ship in the repo.

## Licence

[MIT](LICENSE). Do what you like with it — especially if it helps someone learn.
