export type SampleKind = "piano" | "organ" | "synth" | "orchestra" | "bass" | "multi" | "user";

export type LcdPage = "browse" | "envelope";

/** What the page is for right now. Teaching shows the curriculum; DJ surfaces the studio. */
export type AppMode = "teach" | "dj";

export type PhraseStyle = "rave" | "house" | "techno" | "piano" | "garage";

export type LayerId = "A" | "B";

export type Player = "human" | "agent";

export type DuetMode = "idle" | "follow";

export type LessonId =
  // First steps — find the keys. No tier, no clock.
  | "landmarks"
  | "first-keys"
  | "rh-c-position"
  | "lh-c-position"
  | "hands-together"
  | "c-chord"
  // Basic — right hand, five-finger position.
  | "hot-cross-buns"
  | "mary-lamb"
  | "twinkle"
  | "birthday-basic"
  // Intermediate — both hands, metronome.
  | "ode"
  | "birthday"
  | "heart-and-soul"
  // Advanced — hand independence at tempo.
  | "c-scale"
  | "chopsticks"
  | "fur-elise";

/** Where a lesson sits on the ladder. "steps" is the untiered find-the-keys group. */
export type LessonTier = "steps" | "basic" | "intermediate" | "advanced";

/**
 * How strictly a lesson is timed.
 * - `free` waits forever for the right note and never mentions rhythm.
 * - `metronome` clicks and grades timing, but a late note still counts.
 * - `strict` adds the falling-note highway and drops the lit key.
 */
export type LessonTiming = "free" | "metronome" | "strict";

/** How close to the beat a note landed. `none` means the lesson is not timed. */
export type TimingGrade = "none" | "perfect" | "good" | "early" | "late";

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
  /** Beat this step is due on, counted from the start of the lesson. Untimed without it. */
  beat?: number;
};

export type LessonGrade = "wait" | "hit" | "miss" | "done";

export type LessonState = {
  id: LessonId | "drill";
  title: string;
  coach: string;
  tier: LessonTier;
  timing: LessonTiming;
  steps: LessonStep[];
  stepIndex: number;
  hits: number;
  misses: number;
  lastGrade: LessonGrade;
  lastPlayed: number | null;
  /** Timing of the last correct note. `none` on an untimed lesson. */
  lastTiming: TimingGrade;
  /** Correct notes that also landed inside the good window, for the accuracy readout. */
  onBeat: number;
  /** Correct notes on a timed step, so onBeat has a denominator. */
  timedNotes: number;
  /** `performance.now()` of the last correct note, so gaps can be measured. */
  lastHitAt: number | null;
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
  appMode: AppMode;
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
  /**
   * Semitones added to every note arriving from the MIDI controller, always a
   * multiple of 12. A 25-key controller's OCT buttons decide which register it
   * transmits in, and Web MIDI never reports that, so this is learned from what
   * the student plays. Distinct from `octave`, which is the computer keyboard's.
   */
  midiShift: number;
  sampleEngine: SampleEngineStatus;
  loadProgress: LoadProgressState;
  sustain: boolean;
  /** Beginner mode: letter every white key. On by default. */
  noteNames: boolean;
  /** Backing beat pattern id, or "" for off. */
  drums: string;
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
