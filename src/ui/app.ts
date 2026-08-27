import { runAgentTurn, type AgentMessage } from "../agent/studio-agent";
import {
  applyFx,
  applyMaster,
  getAnalyser,
  getContext,
  initAudio,
  playPhrase,
  resetSound,
  warmCurrentPatches,
} from "../engine/audio";
import { duetLine, nameList, recentTake } from "../engine/duet";
import {
  currentStep,
  fingerBadge,
  fingerLine,
  isNextTarget,
  landmarkPitchClasses,
  nextFingers,
  nextHands,
  nextMidi,
  teacherLine,
} from "../engine/lessons";
import { playHuman, releaseHuman } from "../engine/perform";
import { generatePhrase } from "../engine/generate";
import { downloadBytes, writeMidiFile } from "../engine/midi-file";
import { connectMidi } from "../engine/midi-input";
import { normalizeAndTrim, storeUserSample } from "../engine/samples";
import {
  cycleSample,
  factoryLabel,
  factorySource,
  patchLayer,
  patchState,
  setPhrase,
  state,
  subscribe,
} from "../store";
import type { Hand, LayerId, PhraseNote, PhraseStyle } from "../types";
import { mountIntro } from "./intro";
import { mountVoice, primeSpeech } from "./voice";
import { KEY_COUNT, START_MIDI, isBlack, midiToComputerKey, qwertyToMidi } from "./keyboard";

const messages: AgentMessage[] = [
  {
    role: "agent",
    text: "Never played before? Press teach me. First I show you how to FIND a note — the black keys come in groups of 2 and 3, and C hides just left of every group of 2. Violet means look here. Cyan means play this. Amber is you. Green is me.",
  },
];

const sampleLabel = (id: string): string => factoryLabel(id);

const engineLine = (): string => {
  if (state.loadProgress) {
    const { loaded, total, label } = state.loadProgress;
    return `LOAD ${label} ${loaded}/${total}`;
  }
  if (state.sampleEngine === "loading") return "LOADING SAMPLES";
  if (state.sampleEngine === "sampled") return factorySource(state.layerA.sampleId);
  if (state.sampleEngine === "fallback") return "OSC FALLBACK";
  return "ARM TO LOAD SAMPLES";
};

const adsrPath = (): string => {
  const { attack, decay, sustain, release } = state.adsr;
  const a = 20 + attack * 80;
  const d = a + decay * 70;
  const r = 260 - release * 40;
  const s = 88 - sustain * 50;
  return `M16 88 L${a} 18 L${d} ${s} L${r} ${s} L280 88`;
};

let renderedPhrase: PhraseNote[] | null = null;
let renderedBars = -1;

const renderRoll = (): void => {
  const roll = document.querySelector("#phrase-roll");
  if (!roll) return;
  if (renderedPhrase === state.phrase && renderedBars === state.bars) return;
  renderedPhrase = state.phrase;
  renderedBars = state.bars;
  const beats = state.bars * 4;
  const fragment = document.createDocumentFragment();
  const hitsByBeat = new Map<number, PhraseNote[]>();
  state.phrase.forEach((note) => {
    const beat = Math.floor(note.startBeat);
    const hits = hitsByBeat.get(beat) ?? [];
    hits.push(note);
    hitsByBeat.set(beat, hits);
  });
  for (let i = 0; i < beats; i += 1) {
    const cell = document.createElement("div");
    cell.className = `roll-beat${i % 4 === 0 ? " roll-bar" : ""}`;
    const hits = hitsByBeat.get(i) ?? [];
    hits.slice(0, 4).forEach((note) => {
      const mark = document.createElement("span");
      mark.className = "roll-hit";
      mark.style.left = `${((note.startBeat % 1) * 100)}%`;
      mark.style.bottom = `${((note.midi - 48) / 36) * 80 + 8}%`;
      cell.appendChild(mark);
    });
    fragment.appendChild(cell);
  }
  roll.replaceChildren(fragment);
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const noteLabel = (midi: number): string => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/* Left edge of each black key as a fraction of a white key, measured from the
   white key before it. Real keybeds offset these asymmetrically inside each
   group — a uniform value makes every accidental sit on a boundary. */
const BLACK_LEFT: Record<number, number> = { 1: 0.62, 3: 0.76, 6: 0.6, 8: 0.69, 10: 0.78 };

const dressKey = (key: HTMLButtonElement, midi: number): void => {
  key.dataset.midi = String(midi);
  key.dataset.note = String(midi % 12);
  key.style.setProperty("--i", String(midi - START_MIDI));
  key.setAttribute("aria-label", noteLabel(midi));
  const face = document.createElement("span");
  face.className = "key-face";
  key.appendChild(face);
  // Beginner mode letters every white key. Black keys stay unlabelled on purpose:
  // "C#" means nothing to a first-timer, and there is no room under the lip.
  if (!isBlack(midi)) {
    const name = document.createElement("span");
    name.className = "key-name";
    name.textContent = midi % 12 === 0 ? noteLabel(midi) : NOTE_NAMES[midi % 12];
    key.appendChild(name);
  }
};

const renderKeys = (): void => {
  const board = document.querySelector("#piano");
  if (!board || board.childElementCount) return;
  const whites: number[] = [];
  for (let i = 0; i < KEY_COUNT; i += 1) {
    const midi = START_MIDI + i;
    if (!isBlack(midi)) whites.push(midi);
  }
  whites.forEach((midi, index) => {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "key white";
    key.style.left = `${(index / whites.length) * 100}%`;
    key.style.width = `${100 / whites.length}%`;
    dressKey(key, midi);
    board.appendChild(key);
  });
  for (let i = 0; i < KEY_COUNT; i += 1) {
    const midi = START_MIDI + i;
    if (!isBlack(midi)) continue;
    const prevWhite = whites.filter((value) => value < midi).length - 1;
    const key = document.createElement("button");
    key.type = "button";
    key.className = "key black";
    key.style.left = `${((prevWhite + (BLACK_LEFT[midi % 12] ?? 0.68)) / whites.length) * 100}%`;
    key.style.width = `${(100 / whites.length) * 0.62}%`;
    dressKey(key, midi);
    board.appendChild(key);
  }
};

/* ---- keybed panning ----
   Below roughly 1180px the bed is wider than its window, because a key narrower
   than a fingertip is worse than a key you have to scroll to. So the window
   pans: to whatever the lesson lights next, or by an octave on the buttons. */

const keybed = (): HTMLElement | null => document.querySelector<HTMLElement>("#keybed");

const bedOverflow = (bed: HTMLElement): number => bed.scrollWidth - bed.clientWidth;

let revealedMidi = -1;

/** Centre the key a lesson is pointing at, once per target. */
const revealKey = (key: HTMLElement | null): void => {
  if (!key) {
    revealedMidi = -1;
    return;
  }
  const midi = Number(key.dataset.midi);
  if (midi === revealedMidi) return;
  const bed = keybed();
  if (!bed) return;
  revealedMidi = midi;
  const overflow = bedOverflow(bed);
  if (overflow <= 1) return;
  const centred = key.offsetLeft + key.offsetWidth / 2 - bed.clientWidth / 2;
  bed.scrollTo({ left: Math.max(0, Math.min(overflow, centred)), behavior: "smooth" });
};

let lastLesson: typeof state.lesson = null;

/**
 * revealKey pans the bed sideways; this brings the bed itself on screen. On a phone the
 * keys sit roughly 700px below the fold, so tapping a lesson closes the intro and leaves
 * you staring at the chat bar as if nothing happened. startLesson builds a fresh lesson
 * object per call, so restarting the same song scrolls again.
 */
const revealKeybed = (): void => {
  if (state.lesson === lastLesson) return;
  lastLesson = state.lesson;
  if (!state.lesson) return;
  keybed()?.scrollIntoView({ behavior: "smooth", block: "end" });
};

const panKeybed = (direction: 1 | -1): void => {
  const bed = keybed();
  if (!bed) return;
  bed.scrollBy({ left: (direction * bed.scrollWidth) / 3, behavior: "smooth" });
};

const syncPanButtons = (): void => {
  const bed = keybed();
  const idle = !bed || bedOverflow(bed) <= 1;
  document.querySelector("#pan-left")?.classList.toggle("hidden-pan", idle);
  document.querySelector("#pan-right")?.classList.toggle("hidden-pan", idle);
};

const renderMessages = (): void => {
  const log = document.querySelector("#agent-log");
  if (!log) return;
  log.innerHTML = messages
    .map((message) => `<p class="bubble ${message.role}"><span>${message.role}</span>${message.text}</p>`)
    .join("");
  log.scrollTop = log.scrollHeight;
};

/**
 * Create, update or remove a small overlay span on a key. Empty text removes it,
 * which also stops the badge rendering as an empty pill on F5-B5 (no QWERTY key).
 */
const setKeyTag = (key: HTMLElement, className: string, text: string): void => {
  const existing = key.querySelector(`.${className}`);
  if (!text) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.textContent = text;
    return;
  }
  const tag = document.createElement("span");
  tag.className = className;
  tag.textContent = text;
  key.appendChild(tag);
};

/** Light the finger(s) the current step asks for, and hide the map when none. */
const renderHands = (): void => {
  const map = document.querySelector("#hand-map");
  if (!map) return;
  const fingers = nextFingers();
  const hands = nextHands();
  map.classList.toggle("hidden", fingers.length === 0);
  map.querySelectorAll<HTMLElement>("[data-hand]").forEach((hand) => {
    const side = hand.dataset.hand as Hand;
    hand.classList.toggle("active", hands.includes(side));
    hand.querySelectorAll<HTMLElement>(".digit").forEach((digit) => {
      const finger = Number(digit.dataset.finger);
      const lit = fingers.some((value, index) => value === finger && (hands[index] ?? hands[0]) === side);
      digit.classList.toggle("lit", lit);
    });
  });
};

let celebratedLessonId: string | null = null;

const updateView = (): void => {
  const set = (id: string, text: string) => {
    const el = document.querySelector(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  const together = state.humanHeld.length > 0 && state.agentHeld.length > 0;
  const teaching = Boolean(state.lesson) && state.lesson?.lastGrade !== "done";

  // Trigger celebration modal when a lesson/song is successfully completed
  if (state.lesson && state.lesson.lastGrade === "done" && celebratedLessonId !== state.lesson.id) {
    celebratedLessonId = state.lesson.id;
    const modal = document.querySelector<HTMLElement>("#celebration-modal");
    if (modal) {
      modal.classList.remove("hidden");
      const titleEl = document.querySelector("#celebration-title");
      if (titleEl) titleEl.textContent = `${state.lesson.title} Mastered!`;
      const hitsEl = document.querySelector("#celebration-hits");
      if (hitsEl) hitsEl.textContent = `${state.lesson.hits} / ${state.lesson.steps.length}`;
      const accuracy = Math.round((state.lesson.hits / Math.max(1, state.lesson.hits + state.lesson.misses)) * 100);
      const accEl = document.querySelector("#celebration-accuracy");
      if (accEl) accEl.textContent = `${accuracy}%`;
    }
  } else if (!state.lesson || state.lesson.lastGrade !== "done") {
    celebratedLessonId = null;
  }
  set("#lcd-mode", state.lcdPage === "envelope" ? "ENV" : teaching ? "TEACH" : together || state.duetMode === "follow" ? "DUET" : "EDIT");
  set("#lcd-title", state.agentActing ? `AGENT · ${state.agentActing}` : state.lesson ? state.lesson.title.toUpperCase() : state.presetName);
  set("#lcd-engine", engineLine());
  set("#lcd-duet", teacherLine() || duetLine());
  set("#lcd-layer-a", `A ${sampleLabel(state.layerA.sampleId)}  ${state.layerA.transpose >= 0 ? "+" : ""}${state.layerA.transpose}  ${state.layerA.locked ? "LOCK" : "OPEN"}`);
  set("#lcd-layer-b", `B ${sampleLabel(state.layerB.sampleId)}  ${state.layerB.transpose >= 0 ? "+" : ""}${state.layerB.transpose}  ${state.layerB.locked ? "LOCK" : "OPEN"}`);
  set("#you-notes", nameList(state.humanHeld));
  set("#agent-notes", nameList(state.agentHeld));
  set("#take-notes", nameList(recentTake().map((event) => event.midi)));
  const step = currentStep();
  const targets = nextMidi();
  const landmarks = landmarkPitchClasses();
  const fingering = fingerLine();
  const nextHint = step?.anyOctave
    ? `${nameList(targets)} · any octave`
    : `${nameList(targets)}${fingering ? ` · ${fingering}` : ""} · ${targets.map((midi) => midiToComputerKey(midi) ?? "").filter(Boolean).join(" ") || "click the glow"}`;
  set("#lesson-next", targets.length ? nextHint : "Press teach me");
  set("#lesson-progress", state.lesson ? `${Math.min(state.lesson.stepIndex + 1, state.lesson.steps.length)} / ${state.lesson.steps.length}` : "NO LESSON");
  set("#lesson-hits", state.lesson ? `${state.lesson.hits} hit · ${state.lesson.misses} miss` : "0 / 0");
  set("#lesson-coach", step?.coach ?? (state.lesson?.lastGrade === "done" ? "You did it. Ask for Twinkle, or hold a chord and say harmonize." : "Press teach me. I will show you where C is first."));
  set("#pedal-label", state.sustain ? "SUSTAIN · DOWN" : "SUSTAIN · UP");
  set("#lcd-adsr", `A ${Math.round(state.adsr.attack * 1000)}ms  D ${Math.round(state.adsr.decay * 1000)}ms  S ${Math.round(state.adsr.sustain * 100)}%  R ${Math.round(state.adsr.release * 1000)}ms`);
  set("#midi-label", state.midiDevice);
  set("#style-label", state.style);
  set("#bars-label", `${state.bars} BAR`);
  // The dropdown is the one control updateView does not otherwise own, so anything that
  // changes style from outside it — Restore, or the agent's set-style — would leave the
  // menu showing the old name.
  const styleSelect = document.querySelector<HTMLSelectElement>("#style");
  if (styleSelect && styleSelect.value !== state.style) styleSelect.value = state.style;
  const env = document.querySelector("#env-path");
  if (env) env.setAttribute("d", adsrPath());
  document.querySelector("#browse-page")?.classList.toggle("hidden", state.lcdPage !== "browse");
  document.querySelector("#envelope-page")?.classList.toggle("hidden", state.lcdPage !== "envelope");
  document.querySelector("#power")?.classList.toggle("live", state.ready);
  document.querySelector("#agent-chip")?.classList.toggle("live", Boolean(state.agentActing) || state.duetMode === "follow");
  document.querySelector("#you-pill")?.classList.toggle("live", state.humanHeld.length > 0);
  document.querySelector("#agent-pill")?.classList.toggle("live", state.agentHeld.length > 0 || Boolean(state.agentActing));
  document.querySelector("#follow-chip")?.classList.toggle("live", state.duetMode === "follow");
  document.querySelector("#next-chip")?.classList.toggle("live", teaching);
  document.querySelector("#duet-strip")?.classList.toggle("together", together);
  document.querySelector("#lesson-strip")?.classList.toggle("teaching", teaching);
  document.querySelector("#lesson-pill")?.classList.toggle("live", teaching);
  document.querySelector("#piano")?.classList.toggle("show-names", state.noteNames);
  document.querySelector("#note-names")?.classList.toggle("live", state.noteNames);
  document.querySelectorAll<HTMLInputElement>("[data-knob]").forEach((input) => {
    const key = input.dataset.knob;
    if (!key) return;
    const value =
      key === "master"
        ? state.master
        : key === "volA"
          ? state.layerA.volume
          : key === "volB"
            ? state.layerB.volume
            : state.fx[key as keyof typeof state.fx];
    if (document.activeElement !== input) input.value = String(value);
    const dial = input.previousElementSibling as HTMLElement | null;
    if (dial) {
      dial.style.setProperty("--rot", `${value * 270 - 135}deg`);
      dial.parentElement?.style.setProperty("--val", String(value));
    }
  });
  let firstNextKey: HTMLElement | null = null;
  document.querySelectorAll<HTMLElement>(".key").forEach((key) => {
    const midi = Number(key.dataset.midi);
    const you = state.humanHeld.includes(midi);
    const agent = state.agentHeld.includes(midi);
    const next = isNextTarget(midi) && !you;
    key.classList.toggle("on-human", you && !agent);
    key.classList.toggle("on-agent", agent && !you);
    key.classList.toggle("on-both", you && agent);
    key.classList.toggle("on-next", next);
    // Violet "look here" cue on the black-key group that locates the target.
    key.classList.toggle("on-landmark", landmarks.includes(midi % 12));
    setKeyTag(key, "key-badge", next ? midiToComputerKey(midi) ?? "" : "");
    setKeyTag(key, "key-finger", next ? fingerBadge(midi) : "");
    if (next && !firstNextKey) firstNextKey = key;
  });
  revealKey(firstNextKey);
  revealKeybed();
  renderHands();
  renderRoll();
};

const ensureAudio = async (): Promise<void> => {
  await initAudio();
  if (!state.ready) {
    patchState({ ready: true });
    applyFx();
    applyMaster();
  }
};

let playRequest = 0;
const pendingHumanNotes = new Map<number, number>();

const handlePlayMidi = (midi: number, velocity = 108): void => {
  const request = ++playRequest;
  pendingHumanNotes.set(midi, request);
  const ready = ensureAudio();
  // initAudio builds the playable graph synchronously before its resume promise
  // settles. Starting the voice now gives touch feedback in this same event,
  // which matters on iPad; the context resumes under the same user gesture.
  if (getContext()) {
    pendingHumanNotes.delete(midi);
    playHuman(midi, velocity);
    void ready.catch(() => handleReleaseMidi(midi));
    return;
  }
  void ready.then(() => {
    if (pendingHumanNotes.get(midi) !== request) return;
    pendingHumanNotes.delete(midi);
    playHuman(midi, velocity);
  }).catch(() => pendingHumanNotes.delete(midi));
};

const handleReleaseMidi = (midi: number): void => {
  pendingHumanNotes.delete(midi);
  if (state.humanHeld.includes(midi)) releaseHuman(midi);
};

const handleGenerate = (): void => {
  void ensureAudio().then(() => {
    const phrase = generatePhrase(state.style, state.bars);
    patchState({ presetName: `${state.style.toUpperCase()} GEN` });
    setPhrase(phrase);
    playPhrase(phrase);
  });
};

const handleAgent = async (): Promise<void> => {
  const field = document.querySelector<HTMLInputElement>("#agent-input");
  const text = field?.value.trim();
  if (!text) return;
  if (field) field.value = "";
  messages.push({ role: "user", text });
  renderMessages();
  await ensureAudio();
  const reply = await runAgentTurn(text);
  messages.push({ role: "agent", text: reply });
  renderMessages();
};

/* ---- segmented LED VU meter ---- */

const METER_W = 26;
const METER_H = 66;
const SEGMENTS = 11;
const SEG_GAP = 1.6;

/* Top two segments read red, the three below them amber — expressed relative to
   SEGMENTS so the scale survives a resize of the meter. */
const RED_FROM = SEGMENTS - 2;
const AMBER_FROM = SEGMENTS - 5;

const segColor = (index: number, lit: boolean): string => {
  if (!lit) return index >= RED_FROM ? "#2a1410" : index >= AMBER_FROM ? "#2b2413" : "#12280f";
  return index >= RED_FROM ? "#ff5a3c" : index >= AMBER_FROM ? "#ffd23f" : "#9dff6a";
};

const drawMeterColumn = (
  ctx2: CanvasRenderingContext2D,
  x: number,
  width: number,
  level: number,
  peak: number,
): void => {
  const segH = (METER_H - SEG_GAP * (SEGMENTS - 1)) / SEGMENTS;
  const lit = Math.round(level * SEGMENTS);
  const peakIndex = Math.min(SEGMENTS - 1, Math.round(peak * SEGMENTS) - 1);
  for (let i = 0; i < SEGMENTS; i += 1) {
    ctx2.fillStyle = segColor(i, i < lit || i === peakIndex);
    ctx2.fillRect(x, METER_H - (i + 1) * segH - i * SEG_GAP, width, segH);
  }
};

const armEverything = (): void => {
  void ensureAudio().then(() => connectMidi());
  // Covers the visitor who left the voice on last time: iOS only accepts a first
  // utterance from a gesture, and this is the gesture.
  primeSpeech();
};

export const mountApp = (): void => {
  mountIntro(armEverything);
  mountVoice();
  renderKeys();
  renderMessages();
  updateView();
  let viewFrame: number | null = null;
  subscribe(() => {
    if (viewFrame !== null) return;
    viewFrame = requestAnimationFrame(() => {
      viewFrame = null;
      updateView();
    });
  });

  document.querySelector("#arm")?.addEventListener("click", armEverything);
  document.querySelector("#lcd")?.addEventListener("click", () => {
    patchState({ lcdPage: state.lcdPage === "browse" ? "envelope" : "browse" });
  });
  const handleCycle = (layer: LayerId, direction: 1 | -1): void => {
    cycleSample(layer, direction);
    void ensureAudio().then(() => warmCurrentPatches());
  };
  document.querySelector("#prev-preset")?.addEventListener("click", () => handleCycle("A", -1));
  document.querySelector("#next-preset")?.addEventListener("click", () => handleCycle("A", 1));
  document.querySelector("#prev-b")?.addEventListener("click", () => handleCycle("B", -1));
  document.querySelector("#next-b")?.addEventListener("click", () => handleCycle("B", 1));
  document.querySelector("#lock-a")?.addEventListener("click", () => patchLayer("A", { locked: !state.layerA.locked }));
  document.querySelector("#lock-b")?.addEventListener("click", () => patchLayer("B", { locked: !state.layerB.locked }));
  document.querySelector("#generate")?.addEventListener("click", handleGenerate);
  document.querySelector("#export")?.addEventListener("click", () => {
    if (!state.phrase.length) handleGenerate();
    window.setTimeout(() => {
      downloadBytes(writeMidiFile(state.phrase, state.bpm), "keybed-phrase.mid", "audio/midi");
    }, 40);
  });
  document.querySelector("#restore")?.addEventListener("click", () => {
    void resetSound();
  });
  document.querySelector("#style")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value as PhraseStyle;
    patchState({ style: value });
  });
  document.querySelector("#note-names")?.addEventListener("click", () => {
    patchState({ noteNames: !state.noteNames });
  });
  document.querySelector("#pan-left")?.addEventListener("click", () => panKeybed(-1));
  document.querySelector("#pan-right")?.addEventListener("click", () => panKeybed(1));
  const bed = keybed();
  // Fires once on observe, so it also covers first layout — the bed's width is
  // not known until the chassis has been laid out.
  if (bed) new ResizeObserver(syncPanButtons).observe(bed);
  else window.addEventListener("resize", syncPanButtons);
  document.querySelector("#bars")?.addEventListener("click", () => {
    patchState({ bars: state.bars === 4 ? 8 : 4 });
  });
  document.querySelectorAll<HTMLInputElement>("[data-knob]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.knob;
      const value = Number(input.value);
      if (key === "master") {
        patchState({ master: value });
        applyMaster();
        return;
      }
      if (key === "volA") {
        patchLayer("A", { volume: value });
        if (value >= 0.02) void warmCurrentPatches();
        return;
      }
      if (key === "volB") {
        patchLayer("B", { volume: value });
        if (value >= 0.02) void warmCurrentPatches();
        return;
      }
      if (key && key in state.fx) {
        patchState({ fx: { ...state.fx, [key]: value } });
        applyFx();
      }
    });
  });
  document.querySelector("#user-sample")?.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    const ctx = getContext() ?? (await initAudio(), getContext());
    if (!file || !ctx) return;
    const buffer = normalizeAndTrim(await ctx.decodeAudioData(await file.arrayBuffer()), ctx);
    const id = `user-${file.name.replace(/\W+/g, "").slice(0, 12)}`;
    storeUserSample(id, buffer);
    const layer = (document.querySelector<HTMLSelectElement>("#user-layer")?.value ?? "A") as LayerId;
    patchLayer(layer, { sampleId: id, kind: "user" });
    patchState({ ready: true, presetName: "USER LAYER" });
  });
  document.querySelector("#agent-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleAgent();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-recipe]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = document.querySelector<HTMLInputElement>("#agent-input");
      if (field) field.value = button.dataset.recipe ?? "";
      void handleAgent();
    });
  });

  const celebrationModal = document.querySelector<HTMLElement>("#celebration-modal");
  document.querySelector("#celebration-replay")?.addEventListener("click", () => {
    celebrationModal?.classList.add("hidden");
    const field = document.querySelector<HTMLInputElement>("#agent-input");
    if (field && state.lesson) {
      field.value = state.lesson.title;
      void handleAgent();
    }
  });

  document.querySelector("#celebration-next")?.addEventListener("click", () => {
    celebrationModal?.classList.add("hidden");
    const recipes = [
      "teach me",
      "first keys",
      "finger numbers",
      "left hand",
      "both hands",
      "C scale",
      "C chord",
      "Twinkle",
      "Ode to Joy",
      "Happy Birthday",
    ];
    const currentTitle = state.lesson?.title.toLowerCase() || "";
    const idx = recipes.findIndex((r) => currentTitle.includes(r.toLowerCase()));
    const nextRecipe = idx >= 0 && idx < recipes.length - 1 ? recipes[idx + 1] : "Twinkle";
    const field = document.querySelector<HTMLInputElement>("#agent-input");
    if (field) {
      field.value = nextRecipe;
      void handleAgent();
    }
  });

  celebrationModal?.addEventListener("click", (e) => {
    if (e.target === celebrationModal) celebrationModal.classList.add("hidden");
  });

  const piano = document.querySelector<HTMLElement>("#piano");
  const activePointers = new Map<number, number>();
  const pointerStillHolds = (midi: number): boolean => [...activePointers.values()].includes(midi);
  const keyAtPoint = (pointer: PointerEvent): HTMLElement | null => {
    const hit = document.elementFromPoint(pointer.clientX, pointer.clientY);
    const key = hit?.closest<HTMLElement>(".key") ?? null;
    return key && piano?.contains(key) ? key : null;
  };
  const pointerVelocity = (pointer: PointerEvent, key: HTMLElement): number => {
    const rect = key.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (pointer.clientY - rect.top) / rect.height));
    return Math.round((1 - position) * 50 + 70);
  };
  const releasePointer = (pointer: PointerEvent): void => {
    const midi = activePointers.get(pointer.pointerId);
    if (midi === undefined) return;
    activePointers.delete(pointer.pointerId);
    if (!pointerStillHolds(midi)) handleReleaseMidi(midi);
  };

  piano?.addEventListener("pointerdown", (event) => {
    const pointer = event as PointerEvent;
    const target = (pointer.target as HTMLElement).closest<HTMLElement>(".key");
    if (!target) return;
    pointer.preventDefault();
    const midi = Number(target.dataset.midi);
    const alreadyHeld = pointerStillHolds(midi);
    activePointers.set(pointer.pointerId, midi);
    try {
      piano.setPointerCapture(pointer.pointerId);
    } catch {
      // Some older Safari builds can reject capture during a synthetic or
      // interrupted touch. Window-level cancel handling still releases it.
    }
    if (!alreadyHeld) handlePlayMidi(midi, pointerVelocity(pointer, target));
  });
  piano?.addEventListener("pointermove", (event) => {
    const pointer = event as PointerEvent;
    const previous = activePointers.get(pointer.pointerId);
    if (previous === undefined) return;
    pointer.preventDefault();
    const target = keyAtPoint(pointer);
    if (!target) return;
    const midi = Number(target.dataset.midi);
    if (midi === previous) return;
    activePointers.set(pointer.pointerId, midi);
    if (!pointerStillHolds(previous)) handleReleaseMidi(previous);
    const heldByAnotherPointer = [...activePointers.entries()].some(
      ([pointerId, held]) => pointerId !== pointer.pointerId && held === midi,
    );
    if (!heldByAnotherPointer) handlePlayMidi(midi, pointerVelocity(pointer, target));
  });
  piano?.addEventListener("pointerup", (event) => releasePointer(event as PointerEvent));
  piano?.addEventListener("pointercancel", (event) => releasePointer(event as PointerEvent));
  piano?.addEventListener("lostpointercapture", (event) => releasePointer(event as PointerEvent));
  piano?.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("pointerup", (event) => releasePointer(event));
  window.addEventListener("pointercancel", (event) => releasePointer(event));

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const midi = qwertyToMidi(event.key);
    if (midi === null) return;
    event.preventDefault();
    handlePlayMidi(midi);
  });
  window.addEventListener("keyup", (event) => {
    const midi = qwertyToMidi(event.key);
    if (midi === null) return;
    handleReleaseMidi(midi);
  });

  const meter = document.querySelector<HTMLCanvasElement>("#meter");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (meter) {
    meter.width = METER_W * dpr;
    meter.height = METER_H * dpr;
  }
  const meterContext = meter?.getContext("2d") ?? null;
  if (meterContext) meterContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  const meterData = new Uint8Array(128);
  let peakL = 0;
  let peakR = 0;
  let lastMeterFrame = 0;
  const draw = (now: number) => {
    requestAnimationFrame(draw);
    if (document.hidden || now - lastMeterFrame < 32) return;
    lastMeterFrame = now;
    const analyser = getAnalyser();
    if (!meterContext || !analyser) return;
    analyser.getByteFrequencyData(meterData);
    meterContext.clearRect(0, 0, METER_W, METER_H);
    const half = meterData.length / 2;
    let leftSum = 0;
    let rightSum = 0;
    for (let i = 0; i < half; i += 1) leftSum += meterData[i];
    for (let i = half; i < meterData.length; i += 1) rightSum += meterData[i];
    // /192 reproduces the previous avg/3-of-64px scaling as a 0..1 level.
    const left = Math.min(1, leftSum / half / 192);
    const right = Math.min(1, rightSum / half / 192);
    peakL = Math.max(peakL - 0.024, left);
    peakR = Math.max(peakR - 0.024, right);
    drawMeterColumn(meterContext, 2, 9, left, peakL);
    drawMeterColumn(meterContext, 15, 9, right, peakR);
  };
  requestAnimationFrame(draw);
};
