import { generatePhrase } from "../engine/generate";
import {
  applyFx,
  applyMaster,
  initAudio,
  noteOff,
  playPhrase,
  setSustain,
  warmCurrentPatches,
} from "../engine/audio";
import {
  answerFromTake,
  duetLine,
  harmonyForHeld,
  nameList,
  recentTake,
  takeToPhrase,
} from "../engine/duet";
import {
  currentStep,
  lessonSnapshot,
  listLessons,
  nextMidi,
  resolveLessonId,
  startDrill,
  startLesson,
  stopLesson,
  teacherLine,
} from "../engine/lessons";
import { downloadBytes, writeMidiFile } from "../engine/midi-file";
import { playAgentNotes } from "../engine/perform";
import {
  FACTORY_SAMPLES,
  cycleSample,
  patchLayer,
  patchState,
  setDuetMode,
  snapshotState,
  state,
  setPhrase,
} from "../store";
import type { LayerId, PhraseStyle } from "../types";
import { releaseNote } from "../ui/keyboard";
import type { ToolDefinition } from "./adapter";

const textResult = (text: string) => ({
  content: [{ type: "text", text }],
});

const withAgent = async (name: string, work: () => unknown | Promise<unknown>) => {
  patchState({ agentActing: name });
  try {
    return await work();
  } finally {
    window.setTimeout(() => {
      if (state.agentActing === name) patchState({ agentActing: null });
    }, 700);
  }
};

export const instrumentTools = (): ToolDefinition[] => [
  {
    name: "get-instrument-state",
    description: "Return the live KEYBED state: layers, FX, phrase, and who is holding which keys (you vs agent).",
    inputSchema: { type: "object", properties: {} },
    execute: () => textResult(JSON.stringify(snapshotState(), null, 2)),
  },
  {
    name: "play-notes",
    description: "Play MIDI notes as the agent on the shared piano. Lights keys green. The human's amber keys stay theirs.",
    inputSchema: {
      type: "object",
      properties: {
        notes: { type: "array", items: { type: "integer", minimum: 0, maximum: 127 } },
        velocity: { type: "integer", minimum: 1, maximum: 127, default: 100 },
        durationMs: { type: "integer", minimum: 20, maximum: 8000, default: 420 },
      },
      required: ["notes"],
    },
    execute: ({ notes, velocity, durationMs }) =>
      withAgent("play-notes", async () => {
        await initAudio();
        const list = (notes as number[]) ?? [];
        const vel = Number(velocity ?? 100);
        const dur = Number(durationMs ?? 420);
        playAgentNotes(list, vel, dur);
        return textResult(`Agent played ${list.join(",")}`);
      }),
  },
  {
    name: "get-duet-state",
    description:
      "See what the human is playing on this live page right now: held notes, last take, and whether you can harmonize, answer, or follow. Use this before acting.",
    inputSchema: { type: "object", properties: {} },
    execute: () => {
      const take = recentTake();
      return textResult(
        JSON.stringify(
          {
            line: duetLine(),
            youHolding: state.humanHeld,
            youHoldingNames: nameList(state.humanHeld),
            agentHolding: state.agentHeld,
            lastTake: take.map((event) => event.midi),
            takeCount: take.length,
            mode: state.duetMode,
            canHarmonize: state.humanHeld.length > 0,
            canAnswer: take.length > 0,
            lesson: lessonSnapshot(),
            hint: state.lesson
              ? state.lesson.lastGrade === "done"
                ? "Lesson finished. Offer another lesson or harmonize-held."
                : "A lesson is live. Call get-lesson-state or show-next-keys. Do not skip ahead — wait for the student to play the glowing keys."
              : state.humanHeld.length
                ? "Human is holding notes. Call harmonize-held, or start-lesson to teach."
                : take.length
                  ? "Human just played. Call answer-human, arrange-human-take, or start-lesson."
                  : "Ask them to play, or start-lesson so you can light the next keys. You cannot invent their hands.",
          },
          null,
          2,
        ),
      );
    },
  },
  {
    name: "list-lessons",
    description: "List beginner piano lessons on this live page, easiest first: landmarks, first-keys, rh-c-position, lh-c-position, hands-together, c-scale, c-chord, twinkle, ode, birthday.",
    inputSchema: { type: "object", properties: {} },
    execute: () => textResult(JSON.stringify({ lessons: listLessons() }, null, 2)),
  },
  {
    name: "start-lesson",
    description:
      "Start a piano lesson on this shared keyboard. Lights the next keys the student must play. Lessons: landmarks, first-keys, rh-c-position, lh-c-position, hands-together, c-scale, c-chord, twinkle, ode, birthday. Teaching only works if they play those keys on this page.",
    inputSchema: {
      type: "object",
      properties: {
        lesson: { type: "string", description: "landmarks, first-keys, rh-c-position, lh-c-position, hands-together, c-scale, c-chord, twinkle, ode, birthday, or a song name" },
      },
    },
    execute: ({ lesson }) =>
      withAgent("start-lesson", () => {
        const id = resolveLessonId(String(lesson ?? "landmarks")) ?? "landmarks";
        const started = startLesson(id);
        const step = currentStep();
        return textResult(
          `Lesson started: ${started.title}.\nNext: ${nameList(nextMidi())}.\n${step?.coach ?? started.coach}\nI lit the keys. Wait for the student to play them.`,
        );
      }),
  },
  {
    name: "set-next-keys",
    description:
      "Light specific next keys for the student to play, in order. Use this to invent a drill. They must press those glowing keys — you cannot play them for the student.",
    inputSchema: {
      type: "object",
      properties: {
        notes: { type: "array", items: { type: "integer", minimum: 0, maximum: 127 } },
        title: { type: "string" },
        coach: { type: "string" },
      },
      required: ["notes"],
    },
    execute: ({ notes, title, coach }) =>
      withAgent("set-next-keys", () => {
        const list = (notes as number[]) ?? [];
        if (!list.length) return textResult("Give me MIDI notes to light. Example: [60, 64, 67].");
        const drill = startDrill(list, String(title || "Next keys"), String(coach || "Play the glowing keys in order."));
        return textResult(`I lit ${nameList(nextMidi())}. ${drill.coach} Wait for them to play.`);
      }),
  },
  {
    name: "get-lesson-state",
    description:
      "See the live piano lesson: which keys to play next, computer-key hints, hits, misses, and what the student just played. Call this after they play.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      textResult(
        JSON.stringify(
          {
            line: teacherLine() || "No lesson. Call start-lesson or set-next-keys.",
            youHolding: state.humanHeld,
            youHoldingNames: nameList(state.humanHeld),
            ...lessonSnapshot(),
          },
          null,
          2,
        ),
      ),
  },
  {
    name: "show-next-keys",
    description:
      "Show the student the next keys on the shared piano. Target keys glow cyan; on a find-the-note step the black-key group that locates them glows violet. Starts the landmarks lesson if none is running. Does not play the notes for them.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("show-next-keys", () => {
        if (!state.lesson) startLesson("landmarks");
        const step = currentStep();
        const next = nextMidi();
        if (!next.length) {
          return textResult(state.lesson?.lastGrade === "done" ? "Lesson is done. Start another." : "No next keys.");
        }
        return textResult(
          `NEXT ${nameList(next)}.\n${step?.coach ?? ""}\nThe keys are glowing on the page. I will only advance when they play those notes.`,
        );
      }),
  },
  {
    name: "demo-next",
    description:
      "Play the next lesson notes as the agent (green keys) so the student can hear them, then they copy on the glowing keys. Requires an active lesson.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("demo-next", async () => {
        await initAudio();
        const next = nextMidi();
        if (!next.length) {
          return textResult("No lesson step to demo. Call start-lesson first, then I can play the next keys.");
        }
        playAgentNotes(next, 88, next.length > 1 ? 900 : 520, next.length > 1 ? 0 : 0);
        return textResult(`I played ${nameList(next)}. Now you copy — the same keys stay lit.`);
      }),
  },
  {
    name: "stop-lesson",
    description: "End the current piano lesson and clear the next-key glow.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("stop-lesson", () => {
        if (!state.lesson) return textResult("No lesson was running.");
        const title = state.lesson.title;
        stopLesson();
        return textResult(`Stopped ${title}. The keys are yours again.`);
      }),
  },
  {
    name: "harmonize-held",
    description:
      "Add agent notes around the chord the human is holding on the shared keyboard. Does nothing useful if they are not holding keys — this is the together feature.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("harmonize-held", async () => {
        await initAudio();
        const extras = harmonyForHeld(state.humanHeld);
        if (!extras.length) {
          return textResult("Play and hold a chord on the keys first. I add color on the same piano.");
        }
        playAgentNotes(extras, 92, 1400);
        return textResult(`I added ${nameList(extras)} over your ${nameList(state.humanHeld)}`);
      }),
  },
  {
    name: "answer-human",
    description:
      "Play a call-and-response on the shared keys using the human's last take. Requires that they already played.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("answer-human", async () => {
        await initAudio();
        const take = recentTake();
        const notes = answerFromTake(take);
        if (!notes.length) {
          return textResult("I have no take yet. Play a short line, then ask me to answer.");
        }
        playAgentNotes(notes, 96, 280, 140);
        return textResult(`Answered your take with ${nameList(notes)}`);
      }),
  },
  {
    name: "follow-human",
    description:
      "Shadow the human an octave up in real time on the same keyboard. Toggle off to stop. Better only when they keep playing.",
    inputSchema: {
      type: "object",
      properties: { on: { type: "boolean" } },
    },
    execute: ({ on }) =>
      withAgent("follow-human", () => {
        const next = typeof on === "boolean" ? on : state.duetMode !== "follow";
        if (!next) {
          [...state.agentHeld].forEach((midi) => {
            releaseNote(midi, "agent");
            noteOff(midi, true);
          });
        }
        setDuetMode(next ? "follow" : "idle");
        return textResult(next ? "Following you +8va. Keep playing." : "Follow off. Your keys are yours again.");
      }),
  },
  {
    name: "arrange-human-take",
    description:
      "Turn the human's last live take into the shared phrase roll and play it back. Requires notes they already played on this page.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("arrange-human-take", async () => {
        await initAudio();
        const take = recentTake();
        if (!take.length) {
          return textResult("No human take to arrange. Play first — I write what you played, not a canned loop.");
        }
        const phrase = takeToPhrase(take, state.bpm);
        patchState({ presetName: "YOUR TAKE" });
        setPhrase(phrase);
        playPhrase(phrase);
        return textResult(`Arranged ${phrase.length} notes from your hands onto the roll.`);
      }),
  },
  {
    name: "set-layer",
    description: "Set layer A or B sample, volume, transpose, or lock.",
    inputSchema: {
      type: "object",
      properties: {
        layer: { type: "string", enum: ["A", "B"] },
        sampleId: { type: "string" },
        volume: { type: "number", minimum: 0, maximum: 1 },
        transpose: { type: "integer", minimum: -24, maximum: 24 },
        locked: { type: "boolean" },
        cycle: { type: "integer", enum: [-1, 1] },
      },
      required: ["layer"],
    },
    execute: ({ layer, sampleId, volume, transpose, locked, cycle }) =>
      withAgent("set-layer", async () => {
        const id = layer as LayerId;
        if (cycle === 1 || cycle === -1) cycleSample(id, cycle);
        const factory = FACTORY_SAMPLES.find((sample) => sample.id === sampleId);
        patchLayer(id, {
          ...(factory ? { sampleId: factory.id, kind: factory.kind } : {}),
          ...(typeof volume === "number" ? { volume } : {}),
          ...(typeof transpose === "number" ? { transpose } : {}),
          ...(typeof locked === "boolean" ? { locked } : {}),
        });
        await initAudio();
        await warmCurrentPatches();
        return textResult(`Layer ${id} updated`);
      }),
  },
  {
    name: "set-adsr",
    description: "Set the shared ADSR envelope. Switches the LCD to Envelope.",
    inputSchema: {
      type: "object",
      properties: {
        attack: { type: "number", minimum: 0.001, maximum: 2 },
        decay: { type: "number", minimum: 0.01, maximum: 2 },
        sustain: { type: "number", minimum: 0, maximum: 1 },
        release: { type: "number", minimum: 0.02, maximum: 3 },
      },
    },
    execute: (input) =>
      withAgent("set-adsr", () => {
        patchState({
          lcdPage: "envelope",
          adsr: {
            attack: Number(input.attack ?? state.adsr.attack),
            decay: Number(input.decay ?? state.adsr.decay),
            sustain: Number(input.sustain ?? state.adsr.sustain),
            release: Number(input.release ?? state.adsr.release),
          },
        });
        return textResult("Envelope updated");
      }),
  },
  {
    name: "set-fx",
    description: "Set the 5-stage FX chain: filter, distortion, crush, delay, reverb (0-1).",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "number", minimum: 0, maximum: 1 },
        distortion: { type: "number", minimum: 0, maximum: 1 },
        crush: { type: "number", minimum: 0, maximum: 1 },
        delay: { type: "number", minimum: 0, maximum: 1 },
        reverb: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    execute: (input) =>
      withAgent("set-fx", () => {
        patchState({
          fx: {
            filter: Number(input.filter ?? state.fx.filter),
            distortion: Number(input.distortion ?? state.fx.distortion),
            crush: Number(input.crush ?? state.fx.crush),
            delay: Number(input.delay ?? state.fx.delay),
            reverb: Number(input.reverb ?? state.fx.reverb),
          },
        });
        applyFx();
        return textResult("FX updated");
      }),
  },
  {
    name: "generate-phrase",
    description: "Generate a musical stab phrase in a style and play it on the shared instrument.",
    inputSchema: {
      type: "object",
      properties: {
        style: { type: "string", enum: ["rave", "house", "techno", "piano", "garage"] },
        bars: { type: "integer", enum: [4, 8] },
      },
    },
    execute: ({ style, bars }) =>
      withAgent("generate-phrase", async () => {
        await initAudio();
        const nextStyle = (style as PhraseStyle) || state.style;
        const nextBars = (bars as 4 | 8) || state.bars;
        const phrase = generatePhrase(nextStyle, nextBars);
        patchState({ style: nextStyle, bars: nextBars, presetName: `${nextStyle.toUpperCase()} GEN` });
        setPhrase(phrase);
        playPhrase(phrase);
        return textResult(`Generated ${phrase.length} notes in ${nextStyle}`);
      }),
  },
  {
    name: "lock-layer",
    description: "Lock or unlock layer A or B so generate/cycle will not replace it.",
    inputSchema: {
      type: "object",
      properties: {
        layer: { type: "string", enum: ["A", "B"] },
        locked: { type: "boolean" },
      },
      required: ["layer"],
    },
    execute: ({ layer, locked }) =>
      withAgent("lock-layer", () => {
        const id = layer as LayerId;
        const current = id === "A" ? state.layerA : state.layerB;
        patchLayer(id, { locked: typeof locked === "boolean" ? locked : !current.locked });
        return textResult(`Layer ${id} lock=${id === "A" ? state.layerA.locked : state.layerB.locked}`);
      }),
  },
  {
    name: "save-preset",
    description: "Save the current KEYBED preset to localStorage.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
    },
    execute: ({ name }) =>
      withAgent("save-preset", () => {
        const presetName = String(name || state.presetName || "USER PRESET");
        patchState({ presetName });
        localStorage.setItem("keybed-preset", JSON.stringify({ ...snapshotState(), presetName }));
        return textResult(`Saved ${presetName}`);
      }),
  },
  {
    name: "load-preset",
    description: "Load the last saved KEYBED preset from localStorage.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("load-preset", async () => {
        const raw = localStorage.getItem("keybed-preset");
        if (!raw) return textResult("No saved preset");
        const parsed = JSON.parse(raw) as ReturnType<typeof snapshotState>;
        patchState({
          presetName: parsed.presetName,
          style: parsed.style,
          bars: parsed.bars,
          master: parsed.master,
          adsr: parsed.adsr,
          fx: parsed.fx,
          layerA: parsed.layerA,
          layerB: parsed.layerB,
          phrase: parsed.phrase,
        });
        applyFx();
        applyMaster();
        await initAudio();
        await warmCurrentPatches();
        return textResult(`Loaded ${parsed.presetName}`);
      }),
  },
  {
    name: "export-midi",
    description: "Download the current phrase as a Standard MIDI File.",
    inputSchema: { type: "object", properties: {} },
    execute: () =>
      withAgent("export-midi", () => {
        if (!state.phrase.length) return textResult("No phrase to export. Generate one first.");
        downloadBytes(writeMidiFile(state.phrase, state.bpm), "keybed-phrase.mid", "audio/midi");
        return textResult(`Exported ${state.phrase.length} notes`);
      }),
  },
  {
    name: "set-master",
    description: "Set master volume from 0 to 1.",
    inputSchema: {
      type: "object",
      properties: { volume: { type: "number", minimum: 0, maximum: 1 } },
      required: ["volume"],
    },
    execute: ({ volume }) =>
      withAgent("set-master", () => {
        patchState({ master: Number(volume) });
        applyMaster();
        return textResult(`Master ${volume}`);
      }),
  },
  {
    name: "set-sustain",
    description: "Hold or release the sustain pedal (MIDI CC 64). Same as a pedal on an APC Key 25, Roland, or Yamaha controller.",
    inputSchema: {
      type: "object",
      properties: { down: { type: "boolean" } },
      required: ["down"],
    },
    execute: ({ down }) =>
      withAgent("set-sustain", async () => {
        await initAudio();
        setSustain(Boolean(down));
        return textResult(`Sustain ${down ? "down" : "up"}`);
      }),
  },
  {
    name: "set-swing",
    description: "Set phrase swing from 0 to 0.4.",
    inputSchema: {
      type: "object",
      properties: { swing: { type: "number", minimum: 0, maximum: 0.4 } },
      required: ["swing"],
    },
    execute: ({ swing }) =>
      withAgent("set-swing", () => {
        patchState({ swing: Number(swing) });
        return textResult(`Swing ${swing}`);
      }),
  },
];
