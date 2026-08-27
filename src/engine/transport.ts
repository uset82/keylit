import { getContext, noteOn } from "./audio";
import { state } from "../store";
import { holdNote, releaseNote } from "../ui/keyboard";
import type { PhraseNote } from "../types";

/**
 * The clock behind timed lessons: a metronome, and the looping backing part for a
 * duet lesson.
 *
 * Everything audible is scheduled against `AudioContext.currentTime`, never
 * `setTimeout`, because a timer that drifts by 20ms is a timer a child can hear.
 * The interval below only decides *when to schedule*, so its own jitter never
 * reaches the speakers.
 *
 * Deliberately not the source of truth for lesson grading. A lesson waits
 * indefinitely for the right note, so absolute position in a piece is meaningless
 * — `gradeHumanNote` measures the gap between consecutive notes instead. This
 * module supplies the tempo that gap is compared against.
 */

/**
 * How far ahead of the playhead notes are scheduled. Short on purpose: anything
 * already committed to the audio clock keeps sounding after `stopTransport`, so
 * this is also the longest a stopped lesson can keep making noise.
 */
const LOOKAHEAD_S = 0.3;

/** How often the scheduler wakes up. Must be well under LOOKAHEAD_S. */
const TICK_MS = 70;

type Loop = { notes: PhraseNote[]; loopBeats: number };

let anchor: number | null = null;
let metronome = false;
let loop: Loop | null = null;
let nextClickBeat = 0;
/** Index of the next loop note to schedule, and the beat its pass started on. */
let loopIndex = 0;
let loopBase = 0;
let timer: number | null = null;
/** Key highlights queued ahead of the audio, cleared on stop. */
let pending: number[] = [];

export const beatSeconds = (): number => 60 / Math.max(20, state.bpm);

const timeOfBeat = (beat: number): number => (anchor ?? 0) + beat * beatSeconds();

/**
 * A dry click straight to the destination. It deliberately bypasses the FX chain:
 * a metronome smeared with reverb and delay is no longer a metronome, and DJ mode
 * is free to crush the instrument without making the click unusable.
 */
const click = (ctx: AudioContext, when: number, downbeat: boolean): void => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = downbeat ? 1600 : 1050;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(downbeat ? 0.16 : 0.09, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.07);
};

/** One backing note: audio on the clock, the green key on a plain timer. */
const scheduleNote = (ctx: AudioContext, item: PhraseNote, when: number): void => {
  const duration = Math.max(0.08, item.durationBeats * beatSeconds());
  noteOn(item.midi, item.velocity, when, duration);
  // The green key is cosmetic, so a millisecond of timer drift is invisible —
  // unlike the note itself, which is on the audio clock above.
  const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
  pending.push(
    window.setTimeout(() => {
      holdNote(item.midi, item.velocity, "agent");
      pending.push(window.setTimeout(() => releaseNote(item.midi, "agent"), duration * 1000));
    }, delayMs),
  );
};

const pump = (): void => {
  const ctx = getContext();
  if (!ctx || ctx.state !== "running") return;
  // Audio can arm after the lesson starts — on iOS it usually does — so beat 0 is
  // claimed on the first tick that finds a live context rather than at start time.
  if (anchor === null) anchor = ctx.currentTime + 0.12;
  const horizon = ctx.currentTime + LOOKAHEAD_S;
  while (metronome && timeOfBeat(nextClickBeat) < horizon) {
    click(ctx, timeOfBeat(nextClickBeat), nextClickBeat % 4 === 0);
    nextClickBeat += 1;
  }
  while (loop?.notes.length) {
    const item = loop.notes[loopIndex];
    const when = timeOfBeat(loopBase + item.startBeat);
    if (when >= horizon) break;
    scheduleNote(ctx, item, when);
    loopIndex += 1;
    if (loopIndex >= loop.notes.length) {
      loopIndex = 0;
      loopBase += loop.loopBeats;
    }
  }
};

const clearPending = (): void => {
  pending.forEach((id) => window.clearTimeout(id));
  pending = [];
};

const reset = (): void => {
  anchor = null;
  nextClickBeat = 0;
  loopIndex = 0;
  loopBase = 0;
};

export const isTransportRunning = (): boolean => timer !== null;

/** Start clicking, looping, or both. Notes must be sorted by `startBeat`. */
export const startTransport = (options: { metronome?: boolean; loop?: Loop | null } = {}): void => {
  const hadLoop = Boolean(loop);
  stopTransport();
  metronome = Boolean(options.metronome);
  loop = options.loop ?? null;
  if (!metronome && !loop) return;
  reset();
  if (hadLoop) clearPending();
  timer = window.setInterval(pump, TICK_MS);
  pump();
};

export const stopTransport = (): void => {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  clearPending();
  // Anything the loop lit and never got to release. Scoped to loop mode so this
  // cannot steal keys that follow-the-human is holding.
  if (loop) [...state.agentHeld].forEach((midi) => releaseNote(midi, "agent"));
  metronome = false;
  loop = null;
  reset();
};

/**
 * Restart the bar at the current tempo. Called by `set-bpm`, which is how a child
 * asks to practise a piece at half speed.
 *
 * Chasing the exact beat position across a tempo change would need the old tempo,
 * and the store has already overwritten it by the time this runs — so a clean
 * downbeat is both simpler and easier to play along with.
 */
export const retimeTransport = (): void => {
  const ctx = getContext();
  if (timer === null || !ctx) return;
  clearPending();
  reset();
  anchor = ctx.currentTime + 0.12;
  pump();
};
