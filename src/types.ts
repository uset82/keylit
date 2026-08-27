export type SampleKind = "piano" | "organ" | "synth" | "orchestra" | "bass" | "multi" | "user";

export type LcdPage = "browse" | "envelope";

export type PhraseStyle = "rave" | "house" | "techno" | "piano" | "garage";

export type LayerId = "A" | "B";

export type Player = "human" | "agent";

export type DuetMode = "idle" | "follow";

export type LessonId =
  | "landmarks"
  | "first-keys"
  | "rh-c-position"
  | "lh-c-position"
  | "hands-together"
  | "c-scale"
  | "c-chord"
  | "twinkle"
  | "ode"
  | "birthday";

/** 1 = thumb … 5 = little finger, on both hands. */
export type Finger = 1 | 2 | 3 | 4 | 5;

export type Hand = "L" | "R";

/** Black keys repeat in a group of two (C#/D#) and a group of three (F#/G#/A#). */
export type BlackGroup = "two" | "three";

export type LessonStep = {
  midi: number[];
  hold?: boolean;
  coach: string;
  /** Parallel to `midi`. Prescriptive only — MIDI carries no finger data. */
  fingers?: Finger[];
  /** Parallel to `midi`. Omit for steps with no hand guidance. */
  hands?: Hand[];
  /** Light every black-key group of this size, in every octave. */
  landmark?: BlackGroup;
  /** Grade by pitch class instead of exact MIDI — "press any C". */
  anyOctave?: boolean;
};

export type LessonGrade = "wait" | "hit" | "miss" | "done";

export type LessonState = {
  id: LessonId | "drill";
  title: string;
  coach: string;
  steps: LessonStep[];
  stepIndex: number;
  hits: number;
  misses: number;
  lastGrade: LessonGrade;
  lastPlayed: number | null;
};

export type TakeEvent = {
  midi: number;
  velocity: number;
  atMs: number;
};

export type PhraseNote = {
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
};

export type LayerState = {
  sampleId: string;
  kind: SampleKind;
  volume: number;
  transpose: number;
  locked: boolean;
};

export type AdsrState = {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

export type FxState = {
  filter: number;
  distortion: number;
  crush: number;
  delay: number;
  reverb: number;
};

export type InstrumentState = {
  ready: boolean;
  agentActing: string | null;
  lcdPage: LcdPage;
  presetName: string;
  style: PhraseStyle;
  bars: 4 | 8;
  master: number;
  octave: number;
  bpm: number;
  swing: number;
  layerA: LayerState;
  layerB: LayerState;
  adsr: AdsrState;
  fx: FxState;
  heldNotes: number[];
  humanHeld: number[];
  agentHeld: number[];
  humanTake: TakeEvent[];
  duetMode: DuetMode;
  lesson: LessonState | null;
  phrase: PhraseNote[];
  midiDevice: string;
  sampleEngine: SampleEngineStatus;
  loadProgress: LoadProgressState;
  sustain: boolean;
  /** Beginner mode: letter every white key. On by default. */
  noteNames: boolean;
  /** Context exists but is not running — iOS silent switch or a lost gesture. */
  audioBlocked: boolean;
};

export type SampleEngineStatus = "idle" | "loading" | "sampled" | "fallback";

export type LoadProgressState = {
  loaded: number;
  total: number;
  label: string;
} | null;

export type FactorySample = {
  id: string;
  name: string;
  kind: SampleKind;
  source: string;
};
