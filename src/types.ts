export type SampleKind = "piano" | "organ" | "synth" | "orchestra" | "bass" | "multi" | "user";

export type LcdPage = "browse" | "envelope";

export type PhraseStyle = "rave" | "house" | "techno" | "piano" | "garage";

export type LayerId = "A" | "B";

export type Player = "human" | "agent";

export type DuetMode = "idle" | "follow";

export type LessonId = "first-keys" | "c-scale" | "c-chord" | "twinkle" | "ode";

export type LessonStep = {
  midi: number[];
  hold?: boolean;
  coach: string;
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
