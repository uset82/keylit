import { runAgentTurn, runLessonTurn, type AgentMessage } from "../agent/studio-agent";
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
  lessonSpan,
  lessonTitle,
  nextFingers,
  nextHands,
  nextLessonAfter,
  nextMidi,
  peekFingers,
  peekHands,
  scaffold,
  teacherLine,
  timingAccuracy,
} from "../engine/lessons";
import { playHuman, releaseHuman } from "../engine/perform";
import { retimeTransport, setDrumLoop } from "../engine/transport";
import { drumLoop, isDrumPattern } from "../engine/drums";
import { generatePhrase } from "../engine/generate";
import { downloadBytes, writeMidiFile } from "../engine/midi-file";
import { connectMidi } from "../engine/midi-input";
import { normalizeAndTrim, storeUserSample } from "../engine/samples";
import {
  FACTORY_SAMPLES,
  factoryLabel,
  factorySource,
  patchLayer,
  patchState,
  setPhrase,
  state,
  subscribe,
} from "../store";
import type { Finger, Hand, LayerId, LessonId, PhraseNote, PhraseStyle } from "../types";
import { mountIntro } from "./intro";
import { mountMode } from "./mode";
import { renderNotefall } from "./notefall";
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

const dressKey = (key: HTMLButtonElement, midi: number, rangeStart: number): void => {
  key.dataset.midi = String(midi);
  key.dataset.note = String(midi % 12);
  key.style.setProperty("--i", String(midi - rangeStart));
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

/** Family headings for the instrument pickers, in the order they appear. */
const KIND_LABELS: Record<string, string> = {
  piano: "Pianos",
  synth: "Electric keys",
  organ: "Organs",
  orchestra: "Strings",
  bass: "Bass",
  drums: "Drum kits",
  multi: "Layered",
};

/**
 * Fill a layer picker from FACTORY_SAMPLES, grouped by family.
 *
 * Built from the data rather than written into index.html so the list cannot
 * drift from what the rompler can actually load — the old -/+ buttons cycled an
 * invisible list, which is why nobody could tell what instruments existed.
 */
const fillPicker = (select: HTMLSelectElement): void => {
  if (select.childElementCount) return;
  const byKind = new Map<string, typeof FACTORY_SAMPLES>();
  FACTORY_SAMPLES.forEach((sample) => {
    const group = byKind.get(sample.kind) ?? [];
    group.push(sample);
    byKind.set(sample.kind, group);
  });
  const fragment = document.createDocumentFragment();
  Object.keys(KIND_LABELS).forEach((kind) => {
    const samples = byKind.get(kind);
    if (!samples?.length) return;
    const group = document.createElement("optgroup");
    group.label = KIND_LABELS[kind];
    samples.forEach((sample) => {
      const option = document.createElement("option");
      option.value = sample.id;
      option.textContent = sample.name;
      group.appendChild(option);
    });
    fragment.appendChild(group);
  });
  select.appendChild(fragment);
};

const layerPicker = (layer: LayerId): HTMLSelectElement | null =>
  document.querySelector<HTMLSelectElement>(layer === "A" ? "#layer-a-pick" : "#layer-b-pick");

/** Keep each picker showing the layer it controls, unless the user is in it. */
const syncPickers = (): void => {
  ([["A", state.layerA], ["B", state.layerB]] as const).forEach(([layer, value]) => {
    const select = layerPicker(layer);
    if (!select) return;
    fillPicker(select);
    // A user-imported sample has no option, so leave the box alone rather than
    // silently snapping it back to a factory instrument.
    const known = [...select.options].some((option) => option.value === value.sampleId);
    if (known && document.activeElement !== select && select.value !== value.sampleId) {
      select.value = value.sampleId;
    }
  });
};

const LAST_MIDI = START_MIDI + KEY_COUNT - 1;

/** Round down to the C at or below `midi`, staying inside the built range. */
const octaveFloor = (midi: number): number =>
  Math.max(START_MIDI, midi - ((midi - START_MIDI) % 12));

/**
 * How much of the keyboard to draw.
 *
 * A full three octaves at a finger-width key is ~1350px. On a phone that is five
 * visible keys and constant panning — so instead of shrinking keys below a
 * fingertip, we draw fewer of them: only the octaves the running lesson can
 * actually ask for. "Find any C" is the exception; it teaches that the black-key
 * groups repeat, which needs at least two octaves on screen to be visible at all.
 */
const keyRange = (): { start: number; count: number } => {
  const full = { start: START_MIDI, count: KEY_COUNT };
  // Only phones trade range for key size. A desktop has room for all three
  // octaves at a comfortable width, so it keeps them — narrowing there would
  // change behaviour nobody asked to change.
  const compact =
    window.matchMedia("(max-width: 640px)").matches ||
    window.matchMedia("(pointer: coarse) and (max-height: 500px) and (orientation: landscape)").matches;
  if (!compact) return full;

  const span = lessonSpan();
  if (!span) {
    // Idle on a phone: one big octave from middle C.
    return { start: 60, count: 12 };
  }
  const start = octaveFloor(span.lo);
  // At least one whole octave so the black-key groups read as a pattern, then
  // extended to whatever the lesson actually reaches. "Find any C" needs two,
  // because a pattern you only see once is not visibly a pattern.
  const end = span.repeating ? start + 23 : Math.max(span.hi, start + 11);
  const count = Math.min(end - start + 1, LAST_MIDI - start + 1);
  return { start, count };
};

let renderedRange = "";

const renderKeys = (): void => {
  const board = document.querySelector("#piano");
  if (!board) return;
  const { start, count } = keyRange();
  const signature = `${start}:${count}`;
  if (signature === renderedRange) return;
  renderedRange = signature;

  const whites: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const midi = start + i;
    if (!isBlack(midi)) whites.push(midi);
  }
  const fragment = document.createDocumentFragment();
  whites.forEach((midi, index) => {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "key white";
    key.style.left = `${(index / whites.length) * 100}%`;
    key.style.width = `${100 / whites.length}%`;
    dressKey(key, midi, start);
    fragment.appendChild(key);
  });
  for (let i = 0; i < count; i += 1) {
    const midi = start + i;
    if (!isBlack(midi)) continue;
    const prevWhite = whites.filter((value) => value < midi).length - 1;
    // A black key below the first white key of the range has nothing to hang off.
    if (prevWhite < 0) continue;
    const key = document.createElement("button");
    key.type = "button";
    key.className = "key black";
    key.style.left = `${((prevWhite + (BLACK_LEFT[midi % 12] ?? 0.68)) / whites.length) * 100}%`;
    key.style.width = `${(100 / whites.length) * 0.62}%`;
    dressKey(key, midi, start);
    fragment.appendChild(key);
  }
  board.replaceChildren(fragment);
  // The bed's minimum width is a function of how many keys it actually holds,
  // not a fixed three octaves — otherwise a one-octave lesson still reserves
  // 1008px and pans for no reason.
  //
  // Set on the scroll container, not the board: the note highway sizes itself off
  // the same variable, and the two must stay the same width or every falling bar
  // lands over the wrong key.
  const bed = (board.parentElement as HTMLElement | null) ?? (board as HTMLElement);
  bed.style.setProperty("--whites", String(whites.length));
  // The bed just changed width; the pan affordances have to catch up.
  syncPanButtons();
  revealedMidi = -1;
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
  const bed = keybed();
  if (!bed) return;
  const overflow = bedOverflow(bed);
  // Checked before the target is recorded: a bed that fits has nothing to pan,
  // and marking the key revealed anyway would suppress the pan it needs the
  // moment the window shrinks.
  if (overflow <= 1) return;
  const midi = Number(key.dataset.midi);
  const offset = key.offsetLeft - bed.scrollLeft;
  const onScreen = offset >= 0 && offset + key.offsetWidth <= bed.clientWidth;
  // Re-centre on a new target, and on the old one whenever it has drifted out of
  // the window — replaying a song whose first note was the last one revealed, or
  // panning away by hand, otherwise leaves the answer off screen with nothing to
  // bring it back. At Advanced there is no glow either, so the app looks dead.
  if (midi === revealedMidi && onScreen) return;
  revealedMidi = midi;
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
  // Step by most of a screenful, not a third of the whole bed. scrollWidth/3 is
  // ~7 keys on a phone — more than is visible — so it skipped past keys you had
  // never seen. Overlapping by 20% keeps your place.
  bed.scrollBy({ left: direction * bed.clientWidth * 0.8, behavior: "smooth" });
};

const syncPanButtons = (): void => {
  const bed = keybed();
  const idle = !bed || bedOverflow(bed) <= 1;
  document.querySelector("#pan-left")?.classList.toggle("hidden-pan", idle);
  document.querySelector("#pan-right")?.classList.toggle("hidden-pan", idle);
  // The scrollbar is hidden by design, so the edge fades are the only cue that
  // more keys exist off-screen.
  if (!bed) return;
  bed.classList.toggle("can-pan-left", !idle && bed.scrollLeft > 2);
  bed.classList.toggle("can-pan-right", !idle && bed.scrollLeft < bedOverflow(bed) - 2);
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Replies used to be our own fixed strings, so dropping them into innerHTML was
 * harmless. They can now come from a language model, and a reply carrying
 * `<img onerror=...>` would run on this page — with the audio graph, the saved
 * presets and localStorage in reach. Model output is untrusted text, so it is
 * escaped like any other.
 */
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

/** Set while a turn is in flight, so the wait shows something other than nothing. */
let agentPending = false;

const renderMessages = (): void => {
  const log = document.querySelector("#agent-log");
  if (!log) return;
  const bubbles = messages
    .map(
      (message, idx) =>
        `<div class="bubble ${message.role}" data-bubble-idx="${idx}">
          <div class="bubble-head">
            <span>${message.role}</span>
            <button class="bubble-copy" type="button" title="Copy message text" data-copy-text="${escapeHtml(message.text)}">Copy</button>
          </div>
          <div class="bubble-body">${escapeHtml(message.text)}</div>
        </div>`,
    )
    .join("");
  log.innerHTML = agentPending
    ? `${bubbles}<div class="bubble agent pending"><div class="bubble-head"><span>agent</span></div><div class="bubble-body">Thinking<i></i><i></i><i></i></div></div>`
    : bubbles;
  log.scrollTop = log.scrollHeight;

  log.querySelectorAll<HTMLButtonElement>(".bubble-copy").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const textToCopy = btn.dataset.copyText ?? "";
      try {
        await navigator.clipboard.writeText(textToCopy);
        btn.textContent = "Copied! ✓";
        btn.classList.add("copied");
        window.setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1800);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        btn.textContent = "Copied! ✓";
        btn.classList.add("copied");
        window.setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1800);
      }
    });
  });

  const panel = log.closest<HTMLElement>(".chat-transcript");
  if (panel) panel.scrollTop = panel.scrollHeight;
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

/**
 * Kid-facing names for the five fingers. "Finger 4" is a number a child has to
 * look up; "your ring finger" is one they can already find without looking at
 * the screen — which is the whole point, because their eyes are on the keys.
 */
const FINGER_NAMES: Record<number, string> = {
  1: "thumb",
  2: "pointer",
  3: "tall finger",
  4: "ring finger",
  5: "pinky",
};

const HAND_WORDS: Record<Hand, string> = { L: "LEFT HAND", R: "RIGHT HAND" };

/** Which hand the finger at `index` belongs to; steps default to a single hand. */
const handAt = (hands: Hand[], index: number): Hand => hands[index] ?? hands[0] ?? "R";

/**
 * "finger 3 · your tall finger", or "fingers 1 + 3 + 5" for a chord. Named
 * fingers are dropped past two, where the list stops being readable at a glance
 * and the lit shapes on the hand carry it instead.
 */
const fingerPhrase = (fingers: Finger[]): string => {
  if (fingers.length === 1) return `finger ${fingers[0]} · your ${FINGER_NAMES[fingers[0]]}`;
  return `fingers ${fingers.join(" + ")}`;
};

/** Light the finger(s) the current step asks for, and hide the map when none. */
const renderHands = (): void => {
  const map = document.querySelector<HTMLElement>("#hand-map");
  if (!map) return;
  const fingers = nextFingers();
  const hands = nextHands();
  const ready = peekFingers();
  const readyHands = peekHands();
  map.classList.toggle("hidden", fingers.length === 0);

  map.querySelectorAll<HTMLElement>("[data-hand]").forEach((hand) => {
    const side = hand.dataset.hand as Hand;
    hand.classList.toggle("active", hands.includes(side));
    hand.querySelectorAll<HTMLElement>(".digit").forEach((digit) => {
      const finger = Number(digit.dataset.finger);
      const lit = fingers.some((value, index) => value === finger && handAt(hands, index) === side);
      // A finger already burning is never also dashed: two states on one digit
      // reads as neither.
      const soon =
        !lit && ready.some((value, index) => value === finger && handAt(readyHands, index) === side);
      digit.classList.toggle("lit", lit);
      digit.classList.toggle("ready", soon);
    });
  });

  if (!fingers.length) return;
  const sides = [...new Set(hands)];
  const bothHands = sides.length > 1;
  const setText = (id: string, text: string) => {
    const el = map.querySelector(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  setText("#hand-cue-side", bothHands ? "BOTH HANDS" : HAND_WORDS[sides[0] ?? "R"]);
  setText(
    "#hand-cue-detail",
    bothHands
      ? sides
          .map((side) => {
            const own = fingers.filter((_, index) => handAt(hands, index) === side);
            return `${side === "L" ? "left" : "right"} ${own.join(" + ")}`;
          })
          .join("  ·  ")
      : fingerPhrase(fingers),
  );
};

let celebratedLessonId: string | null = null;

const updateView = (): void => {
  const set = (id: string, text: string) => {
    const el = document.querySelector(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  const together = state.humanHeld.length > 0 && state.agentHeld.length > 0;
  const teaching = Boolean(state.lesson) && state.lesson?.lastGrade !== "done";
  // One attribute; CSS hides .teach-only / .dj-only off the back of it.
  if (document.body.dataset.mode !== state.appMode) {
    document.body.dataset.mode = state.appMode;
    const studio = document.querySelector<HTMLDetailsElement>(".studio");
    if (studio) studio.open = state.appMode === "dj";
  }
  document.querySelectorAll<HTMLElement>("[data-mode-pick]").forEach((button) => {
    const picked = button.dataset.modePick === state.appMode;
    button.classList.toggle("live", picked);
    button.setAttribute("aria-pressed", String(picked));
  });

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
      // Only timed lessons have a rhythm score, so the tile hides itself on Basic.
      const beat = timingAccuracy();
      const beatTile = document.querySelector<HTMLElement>("#celebration-beat-tile");
      const beatEl = document.querySelector("#celebration-beat");
      beatTile?.classList.toggle("hidden", beat === null);
      if (beatEl && beat !== null) beatEl.textContent = `${beat}%`;
      const upNext = nextLessonAfter(state.lesson.id);
      const nextBtn = document.querySelector("#celebration-next");
      if (nextBtn) nextBtn.textContent = upNext ? `${lessonTitle(upNext)} ➔` : "You finished the ladder";
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
  const take = recentTake();
  set("#take-notes", nameList(take.map((event) => event.midi)));
  // "Last take —" before anyone has played reads as a field that failed to fill.
  document.querySelector(".chat-take")?.classList.toggle("is-empty", take.length === 0);
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
  set("#bpm-label", `${state.bpm} BPM`);
  const bpmInput = document.querySelector<HTMLInputElement>("#bpm");
  if (bpmInput && document.activeElement !== bpmInput && Number(bpmInput.value) !== state.bpm) {
    bpmInput.value = String(state.bpm);
  }
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
  // Only while there is something to quit. A permanent one would be the biggest
  // button on a landscape phone with nothing to do most of the time.
  document.querySelector("#quit-lesson")?.classList.toggle("hidden", !state.lesson);
  document.querySelector("#piano")?.classList.toggle("show-names", state.noteNames);
  document.querySelector("#note-names")?.classList.toggle("live", state.noteNames);
  syncPickers();
  const drumPick = document.querySelector<HTMLSelectElement>("#drum-pick");
  // The agent can change the beat too, so the select follows state.
  if (drumPick && document.activeElement !== drumPick && drumPick.value !== state.drums) {
    drumPick.value = state.drums;
  }
  document.querySelector("#audio-blocked")?.classList.toggle("hidden", !state.audioBlocked);
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
  // Draw only the octaves this lesson needs — a no-op unless the range changed.
  //
  // Must come before anything below reads or pans the keys: it replaces every key
  // element, which resets the bed's scroll position, so panning first meant a
  // lesson start scrolled to its target and was immediately yanked back to zero.
  renderKeys();
  let firstNextKey: HTMLElement | null = null;
  const help = scaffold();
  document.querySelectorAll<HTMLElement>(".key").forEach((key) => {
    const midi = Number(key.dataset.midi);
    const you = state.humanHeld.includes(midi);
    const agent = state.agentHeld.includes(midi);
    const next = isNextTarget(midi) && !you;
    key.classList.toggle("on-human", you && !agent);
    key.classList.toggle("on-agent", agent && !you);
    key.classList.toggle("on-both", you && agent);
    key.classList.toggle("on-next", next && help.glow);
    // Violet "look here" cue on the black-key group that locates the target.
    key.classList.toggle("on-landmark", landmarks.includes(midi % 12));
    setKeyTag(key, "key-badge", next && help.badges ? midiToComputerKey(midi) ?? "" : "");
    setKeyTag(key, "key-finger", next && help.badges ? fingerBadge(midi) : "");
    // Panning follows the target even when it is not lit, or an advanced lesson
    // would scroll the answer off screen.
    if (next && !firstNextKey) firstNextKey = key;
  });
  revealKey(firstNextKey);
  revealKeybed();
  renderHands();
  renderNotefall();
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
  agentPending = true;
  renderMessages();
  await ensureAudio();
  try {
    const reply = await runAgentTurn(text);
    messages.push({ role: "agent", text: reply });
  } catch (error) {
    // A turn that throws used to leave the transcript stuck on the user's own
    // message with no explanation, which is indistinguishable from a dead app.
    messages.push({ role: "agent", text: `That one broke: ${error instanceof Error ? error.message : "error"}` });
  } finally {
    agentPending = false;
  }
  renderMessages();
};

/** Start a known lesson without going through phrase matching. */
const handleLesson = async (id: LessonId): Promise<void> => {
  messages.push({ role: "user", text: lessonTitle(id) });
  renderMessages();
  await ensureAudio();
  const reply = await runLessonTurn(id);
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

/**
 * The transcript stays a <details> so a phone can fold it away, where every row
 * it takes is a row off the keybed. From 1024px up the stylesheet gives it a
 * column of its own, and a conversation you have to unfold to read is one nobody
 * reads — so pin it open there. Open is a DOM attribute, not something the
 * stylesheet that owns the rest of this layout can set.
 */
const mountTranscript = (): void => {
  const transcript = document.querySelector<HTMLDetailsElement>(".chat-transcript");
  if (!transcript) return;
  const wide = window.matchMedia("(min-width: 1024px)");
  const sync = (): void => {
    transcript.open = wide.matches;
  };
  sync();
  wide.addEventListener("change", sync);
};

export const mountApp = (): void => {
  mountIntro(armEverything);
  mountMode();
  mountVoice();
  mountTranscript();
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
  // Same two calls handleCycle makes, so the picker and the agent's set-layer
  // tool take identical paths into the rompler.
  ([["A", "#layer-a-pick"], ["B", "#layer-b-pick"]] as const).forEach(([layer, selector]) => {
    document.querySelector<HTMLSelectElement>(selector)?.addEventListener("change", (event) => {
      const sampleId = (event.target as HTMLSelectElement).value;
      const sample = FACTORY_SAMPLES.find((entry) => entry.id === sampleId);
      if (!sample) return;
      patchLayer(layer, { sampleId: sample.id, kind: sample.kind });
      void ensureAudio().then(() => warmCurrentPatches());
    });
  });
  document.querySelector("#lock-a")?.addEventListener("click", () => patchLayer("A", { locked: !state.layerA.locked }));
  document.querySelector("#lock-b")?.addEventListener("click", () => patchLayer("B", { locked: !state.layerB.locked }));
  const setBpm = (next: number): void => {
    const clamped = Math.round(Math.min(200, Math.max(40, next)));
    if (clamped === state.bpm) return;
    patchState({ bpm: clamped });
    retimeTransport();
  };
  document.querySelector("#bpm-down")?.addEventListener("click", () => setBpm(state.bpm - 4));
  document.querySelector("#bpm-up")?.addEventListener("click", () => setBpm(state.bpm + 4));
  document.querySelector("#bpm")?.addEventListener("input", (event) => {
    setBpm(Number((event.target as HTMLInputElement).value));
  });
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
  // Tapping the banner is itself a fresh user gesture, which is exactly what a
  // suspended iOS context needs to resume.
  document.querySelector("#audio-blocked")?.addEventListener("click", () => {
    void ensureAudio();
  });
  document.querySelector<HTMLSelectElement>("#drum-pick")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    // Arming audio first: the beat is scheduled on the audio clock, so without a
    // running context the first bar is silently dropped.
    patchState({ drums: isDrumPattern(value) ? value : "" });
    void ensureAudio().then(() => {
      setDrumLoop(isDrumPattern(value) ? drumLoop(value) : null);
    });
  });
  document.querySelector("#note-names")?.addEventListener("click", () => {
    patchState({ noteNames: !state.noteNames });
  });
  document.querySelector("#pan-left")?.addEventListener("click", () => panKeybed(-1));
  document.querySelector("#pan-right")?.addEventListener("click", () => panKeybed(1));
  const bed = keybed();
  // Fires once on observe, so it also covers first layout — the bed's width is
  // not known until the chassis has been laid out.
  if (bed) {
    // Crossing the phone breakpoint changes how many octaves fit, so the bed is
    // rebuilt as well as re-measured. renderKeys no-ops unless the range moved.
    new ResizeObserver(() => {
      renderKeys();
      syncPanButtons();
    }).observe(bed);
    // Keeps the edge fades honest as the user swipes the bed.
    bed.addEventListener("scroll", syncPanButtons, { passive: true });
  } else {
    window.addEventListener("resize", syncPanButtons);
  }
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
  document.querySelector("#chat-paste-btn")?.addEventListener("click", async () => {
    const field = document.querySelector<HTMLInputElement>("#agent-input");
    if (!field) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        field.value = (field.value ? field.value + " " : "") + text.trim();
        field.focus();
      }
    } catch {
      field.focus();
    }
  });
  document.querySelector("#music-close")?.addEventListener("click", () => {
    const player = document.querySelector<HTMLAudioElement>("#music-audio");
    player?.pause();
    player?.removeAttribute("src");
    player?.load();
    document.querySelector("#music-result")?.classList.add("hidden");
  });
  document.querySelectorAll<HTMLElement>("[data-recipe]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const field = document.querySelector<HTMLInputElement>("#agent-input");
      if (field) field.value = element.dataset.recipe ?? "";
      void handleAgent();
    });
  });

  window.addEventListener("keylit:focus-control", (event: Event) => {
    const custom = event as CustomEvent<{ target: string }>;
    const target = custom.detail?.target;
    const studio = document.querySelector<HTMLDetailsElement>(".studio");
    if (studio) studio.open = true;
    let highlightTarget: HTMLElement | null = null;
    if (target === "fx") {
      highlightTarget = document.querySelector<HTMLElement>(".fx-row");
    } else if (target === "layers") {
      highlightTarget = document.querySelector<HTMLElement>("#layer-a-pick")?.closest(".flex") ?? null;
    } else if (target === "tempo") {
      highlightTarget = document.querySelector<HTMLElement>(".tempo-slider") ?? document.querySelector<HTMLElement>(".tempo-tools");
    } else if (target === "phrase") {
      highlightTarget = document.querySelector<HTMLElement>("#phrase-roll");
    } else {
      highlightTarget = studio;
    }
    if (highlightTarget) {
      highlightTarget.classList.remove("spotlight-pulse");
      void highlightTarget.offsetWidth;
      highlightTarget.classList.add("spotlight-pulse");
      highlightTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
      window.setTimeout(() => {
        highlightTarget?.classList.remove("spotlight-pulse");
      }, 2500);
    }
  });

  const celebrationModal = document.querySelector<HTMLElement>("#celebration-modal");
  document.querySelector("#celebration-replay")?.addEventListener("click", () => {
    celebrationModal?.classList.add("hidden");
    const id = state.lesson?.id;
    if (id && id !== "drill") void handleLesson(id);
  });

  document.querySelector("#celebration-next")?.addEventListener("click", () => {
    celebrationModal?.classList.add("hidden");
    // Walks the real lesson table, so a child finishing Hot Cross Buns gets Mary
    // Had a Little Lamb and a child finishing a tier gets the top of the next one.
    const next = nextLessonAfter(state.lesson?.id ?? "hot-cross-buns");
    if (!next) {
      messages.push({
        role: "agent",
        text: "That is the whole ladder — First steps to Advanced. Ask me for any song again, or switch to DJ mode and make something of your own.",
      });
      renderMessages();
      return;
    }
    void handleLesson(next);
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
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const midi = qwertyToMidi(event.key);
    if (midi === null) return;
    event.preventDefault();
    handlePlayMidi(midi);
  });
  window.addEventListener("keyup", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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
