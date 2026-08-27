import type { AppMode, DuetMode, InstrumentState, LayerId, LessonState, PhraseNote, Player, TakeEvent } from "./types";

export const FACTORY_SAMPLES = [
  { id: "pn-ivory", name: "Steinway", kind: "piano" as const, source: "Splendid Grand · 4 vel" },
  { id: "pn-felt", name: "Soft Grand", kind: "piano" as const, source: "MusyngKite acoustic grand" },
  { id: "or-chapel", name: "Chapel Org", kind: "organ" as const, source: "FluidR3 church organ" },
  { id: "or-reed", name: "Drawbar", kind: "organ" as const, source: "FluidR3 drawbar organ" },
  { id: "sy-rail", name: "Yamaha CP80", kind: "synth" as const, source: "Yamaha CP80 electric grand" },
  { id: "sy-razor", name: "Wurlitzer", kind: "synth" as const, source: "Wurlitzer EP200" },
  { id: "ok-bloom", name: "Ensemble", kind: "orchestra" as const, source: "FluidR3 string ensemble" },
  { id: "bs-sub", name: "Upright Bs", kind: "bass" as const, source: "FluidR3 acoustic bass" },
  { id: "ml-stack", name: "Grand+Pad", kind: "multi" as const, source: "Steinway + strings" },
];

const listeners = new Set<() => void>();

/**
 * The sound the instrument boots with, and the only thing Restore puts back.
 *
 * `master` is deliberately not in here. It is the listener's comfort setting, it lives
 * on the rack face rather than in the STUDIO drawer, and snapping it back under a child
 * in headphones is not a favour. Nor is `lesson` or `phrase`: pressing Restore mid-song
 * must not throw the song away.
 */
export const FACTORY_SOUND: Pick<
  InstrumentState,
  "presetName" | "style" | "bars" | "bpm" | "swing" | "layerA" | "layerB" | "adsr" | "fx"
> = {
  presetName: "STEINWAY INIT",
  style: "piano",
  bars: 4,
  bpm: 96,
  swing: 0.04,
  layerA: { sampleId: "pn-ivory", kind: "piano", volume: 0.9, transpose: 0, locked: false },
  layerB: { sampleId: "ok-bloom", kind: "orchestra", volume: 0, transpose: 0, locked: false },
  adsr: { attack: 0.002, decay: 0.42, sustain: 0.72, release: 0.55 },
  fx: { filter: 0.92, distortion: 0, crush: 0, delay: 0.05, reverb: 0.16 },
};

const MODE_KEY = "keylit.mode";

/** Read at module load so the very first paint is already in the right mode. */
const storedMode = ((): AppMode => {
  try {
    return localStorage.getItem(MODE_KEY) === "dj" ? "dj" : "teach";
  } catch {
    return "teach";
  }
})();

export const state: InstrumentState = {
  ready: false,
  agentActing: null,
  appMode: storedMode,
  lcdPage: "browse",
  // Cloned, or the running state and the factory reference would be the same objects.
  ...structuredClone(FACTORY_SOUND),
  master: 0.72,
  octave: 0,
  heldNotes: [],
  humanHeld: [],
  agentHeld: [],
  humanTake: [],
  duetMode: "idle",
  lesson: null,
  phrase: [],
  midiDevice: "None",
  sampleEngine: "idle",
  loadProgress: null,
  sustain: false,
  noteNames: true,
  audioBlocked: false,
};

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notify = (): void => {
  listeners.forEach((listener) => listener());
};

export const patchState = (partial: Partial<InstrumentState>): void => {
  Object.assign(state, partial);
  notify();
};

export const patchLayer = (id: LayerId, partial: Partial<InstrumentState["layerA"]>): void => {
  const key = id === "A" ? "layerA" : "layerB";
  state[key] = { ...state[key], ...partial };
  notify();
};

const syncHeld = (humanHeld: number[], agentHeld: number[], humanTake = state.humanTake): void => {
  state.humanHeld = humanHeld;
  state.agentHeld = agentHeld;
  state.heldNotes = [...new Set([...humanHeld, ...agentHeld])];
  state.humanTake = humanTake;
  notify();
};

export const pressKey = (midi: number, velocity: number, player: Player): void => {
  const human = new Set(state.humanHeld);
  const agent = new Set(state.agentHeld);
  if (player === "human") human.add(midi);
  else agent.add(midi);
  let take = state.humanTake;
  if (player === "human") {
    const now = performance.now();
    const next: TakeEvent = { midi, velocity, atMs: now };
    take = [...state.humanTake.filter((event) => now - event.atMs < 8000), next].slice(-48);
  }
  syncHeld([...human], [...agent], take);
};

export const liftKey = (midi: number, player?: Player): void => {
  const human = new Set(state.humanHeld);
  const agent = new Set(state.agentHeld);
  if (!player || player === "human") human.delete(midi);
  if (!player || player === "agent") agent.delete(midi);
  syncHeld([...human], [...agent]);
};

export const setAppMode = (appMode: AppMode): void => {
  state.appMode = appMode;
  try {
    localStorage.setItem(MODE_KEY, appMode);
  } catch {
    // Private-mode Safari refuses writes. The mode still applies for this session.
  }
  notify();
};

export const setDuetMode = (duetMode: DuetMode): void => {
  state.duetMode = duetMode;
  notify();
};

export const setLesson = (lesson: LessonState | null): void => {
  state.lesson = lesson;
  notify();
};

export const setHeldNotes = (notes: number[]): void => {
  state.heldNotes = notes;
  notify();
};

export const setPhrase = (phrase: PhraseNote[]): void => {
  state.phrase = phrase;
  notify();
};

export const cycleSample = (id: LayerId, direction: 1 | -1): void => {
  const layer = id === "A" ? state.layerA : state.layerB;
  if (layer.kind === "user") return;
  const index = FACTORY_SAMPLES.findIndex((sample) => sample.id === layer.sampleId);
  const next = FACTORY_SAMPLES[(index + direction + FACTORY_SAMPLES.length) % FACTORY_SAMPLES.length];
  patchLayer(id, { sampleId: next.id, kind: next.kind });
};

export const factoryLabel = (id: string): string =>
  FACTORY_SAMPLES.find((sample) => sample.id === id)?.name ?? id.toUpperCase();

export const factorySource = (id: string): string =>
  FACTORY_SAMPLES.find((sample) => sample.id === id)?.source ?? "User sample";

export const snapshotState = (): InstrumentState => structuredClone(state);
