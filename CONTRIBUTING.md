# Contributing to KEYLIT

Thanks for being here. KEYLIT exists so that someone who cannot afford a piano app or a private tutor can still be taught to play, by an agent that actually hears them on the page.

Ideas are as welcome as code. If you are not sure where something belongs:

- **An idea, a question, a song request** → [Discussions](https://github.com/uset82/keylit/discussions)
- **Something is broken** → [open an issue](https://github.com/uset82/keylit/issues/new/choose)
- **You have a change ready** → open a pull request

You do not need to be a developer to help. Telling us that a lesson confused a seven-year-old is more useful than most patches.

---

## Run it locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`, click **teach me**, and press the cyan key.

```bash
npm run build
```

That runs `tsc --noEmit`, then the Vite build, then the Sites packaging step. **It must pass before you open a PR.**

The repo has check scripts, not a test runner. Run the ones that touch what you changed; run all of them before a PR:

```bash
npm run test:lessons
npm run test:generate
npm run test:design
npm run test:music
npm run test:midi
npm run test:mcp
```

Coding agents should read [`AGENTS.md`](AGENTS.md). To let Codex call the piano tools on a local page, see [`docs/codex.md`](docs/codex.md).

---

## The best first contribution: add a lesson

Lessons are plain data in [`src/engine/lessons.ts`](src/engine/lessons.ts). Adding a song touches one file and needs no framework knowledge.

A lesson is a list of steps. A step is:

```ts
type LessonStep = {
  midi: number[];        // the note(s) this step wants. 60 = middle C
  hold?: boolean;        // true = press them all together
  coach: string;         // what the teacher says. Written for a child
  fingers?: Finger[];    // parallel to midi. 1 = thumb … 5 = little finger
  hands?: Hand[];        // parallel to midi. "L" or "R"
  landmark?: BlackGroup; // "two" | "three" — light that black-key group
  anyOctave?: boolean;   // accept the right letter in any octave
};
```

To add "Happy Birthday" you would add an entry to the `LESSONS` array, then register the id in three places TypeScript will point you at:

1. `LessonId` in [`src/types.ts`](src/types.ts) — it is a closed union, so the compiler lists every place that needs updating
2. `resolveLessonId` in `lessons.ts` — **insert new keys above the older branches**; the `first-keys` branch matches the bare substring `"find"` and `c-chord` matches `"chord"`, so a loose key will get swallowed
3. A recipe in [`src/agent/studio-agent.ts`](src/agent/studio-agent.ts) — **above** the greedy `/teach|learn|lesson/` recipe, which catches almost every beginner phrasing

### Writing coach lines

This is the part that matters most, and it is not a coding skill.

- Write for a seven-year-old reading aloud. Short, concrete, physical.
- Say *where* a note is, never just its name. "C is the white key just left of the two black keys" teaches; "press C" does not.
- Name the finger when there is one: "Your thumb is finger 1."
- No jargon. No "tonic", no "interval".

Good: `D hides BETWEEN the two black keys.`
Not good: `Play the supertonic.`

### Things that will trip you up

- **Fingering can never be graded.** Nothing in the input path — pointer, computer keyboard, or Web MIDI — carries which finger pressed a key. Finger numbers are guidance only. Never write code or coach text that claims a wrong finger was used.
- **`anyOctave` is per step, not per lesson**, and must not be combined with `hold`: two targets sharing a pitch class would both be satisfied by one key.
- The keybed renders **only the octaves your lesson needs**, so a lesson spanning two octaves will make the keys smaller on a phone. Keep beginner lessons inside one octave where you can.

---

## Style

Match the file you are editing. Beyond that:

- **Comments explain *why*, not *what*.** The codebase is full of comments recording a trap someone already fell into — `pointer: coarse` on a media query, the ordering of the agent recipes. Those are the valuable ones. Do not narrate what the next line plainly does.
- TypeScript is `strict` with `noUnusedLocals` and `noUnusedParameters`. No `any`.
- Plain CSS in `src/style.css`, using the tokens in `:root`. The signal colours mean things — cyan is "play this next", amber is "you", green is "your teacher", violet is "look here" — so do not reuse them decoratively.
- No new dependencies without discussing it first. The whole app is vanilla TypeScript on purpose.

## Accessibility and phones

A lot of people will meet this on a cheap phone, so:

- Tap targets stay at **44px** or larger.
- Form controls stay at **16px** font or larger — below that iOS zooms the page on focus and never zooms back.
- Nothing may rely on colour alone; pair it with a shape, a label, or a position.
- Everything must survive `prefers-reduced-motion: reduce`.

## Before you open a PR

1. `npm run build` passes.
2. Click through the lesson you touched, start to finish. If you changed shared code, click a lesson from each tier.
3. Check it at 390px wide, in portrait and landscape.
4. Say in the PR what you actually verified, and what you did not. "I did not test on a real iPhone" is a genuinely useful sentence.

## Licence

By contributing you agree your work is released under the [MIT Licence](LICENSE).
