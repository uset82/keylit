import type { PhraseNote } from "../types";
import { getMasterBus } from "./audio";

/**
 * A synthesised drum kit and the patterns that drive it.
 *
 * Synthesised rather than sampled on purpose. smplr ships a `DrumMachine` and it
 * would sound richer, but every kit is a network download, and a beat that
 * arrives four seconds after you asked for it — or not at all on hotel wifi —
 * is worse than a plain one that starts instantly. The TR-808 this imitates was
 * itself synthesis, not samples, so the technique is period-correct rather than
 * a compromise. Swapping in a sampled kit later only needs `voiceFor` to change.
 *
 * Notes are General MIDI percussion numbers so patterns read like drum notation
 * and export straight to a .mid file that any DAW will understand.
 */

export const KICK = 36;
export const SNARE = 38;
export const CLAP = 39;
export const HAT = 42;
export const OPEN_HAT = 46;

export type DrumPatternId = "backbeat" | "house" | "techno" | "garage";

/** A hit as (note, beat) — velocity is per-voice, so patterns stay readable. */
type Hit = [midi: number, beat: number];

/**
 * One bar each, looped. Kept to a bar so a pattern reads at a glance and so the
 * loop point always lands on a downbeat whatever the bar count.
 */
const PATTERNS: Record<DrumPatternId, Hit[]> = {
  // Kick on 1 and 3, snare on 2 and 4. The first beat anyone learns.
  backbeat: [
    [KICK, 0], [HAT, 0], [HAT, 0.5],
    [SNARE, 1], [HAT, 1], [HAT, 1.5],
    [KICK, 2], [HAT, 2], [HAT, 2.5],
    [SNARE, 3], [HAT, 3], [HAT, 3.5],
  ],
  // Four on the floor, open hat on the off-beat — the whole point of house.
  house: [
    [KICK, 0], [KICK, 1], [KICK, 2], [KICK, 3],
    [OPEN_HAT, 0.5], [OPEN_HAT, 1.5], [OPEN_HAT, 2.5], [OPEN_HAT, 3.5],
    [CLAP, 1], [CLAP, 3],
  ],
  // Same kick, tighter top, no clap. Sparser on purpose.
  techno: [
    [KICK, 0], [KICK, 1], [KICK, 2], [KICK, 3],
    [HAT, 0.5], [HAT, 1.5], [HAT, 2.5], [HAT, 3.5],
    [SNARE, 2],
  ],
  // Shuffled kick and a skipping hat: the two-step feel.
  garage: [
    [KICK, 0], [KICK, 2.5],
    [SNARE, 1], [SNARE, 3],
    [HAT, 0.5], [HAT, 1.25], [HAT, 1.75], [HAT, 2.25], [HAT, 3.5], [HAT, 3.75],
  ],
};

const VELOCITY: Record<number, number> = {
  [KICK]: 118,
  [SNARE]: 104,
  [CLAP]: 96,
  [HAT]: 68,
  [OPEN_HAT]: 74,
};

export const drumPatternIds = (): DrumPatternId[] => Object.keys(PATTERNS) as DrumPatternId[];

export const isDrumPattern = (value: unknown): value is DrumPatternId =>
  typeof value === "string" && value in PATTERNS;

/** A pattern as loopable notes, in the same shape the transport already speaks. */
export const drumLoop = (id: DrumPatternId): { notes: PhraseNote[]; loopBeats: number } => ({
  notes: [...PATTERNS[id]]
    .sort((a, b) => a[1] - b[1])
    .map(([midi, startBeat]) => ({
      midi,
      startBeat,
      durationBeats: 0.25,
      velocity: VELOCITY[midi] ?? 96,
    })),
  loopBeats: 4,
});

/**
 * Master bus, not destination.
 *
 * Drums skip the filter and crush chain — those knobs belong to the keys the
 * student is playing, and a backing beat that mutates when a child turns the
 * filter down reads as broken. But they must still obey the master volume and
 * register on the meter, so they join one node downstream of the effects.
 */
const busFor = (ctx: AudioContext): AudioNode => getMasterBus() ?? ctx.destination;

/** Short burst of filtered noise — the body of every snare, hat and clap. */
const noise = (ctx: AudioContext, when: number, duration: number, gainValue: number, hz: number, q = 0.7): void => {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = hz;
  band.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(band);
  band.connect(gain);
  gain.connect(busFor(ctx));
  source.start(when);
  source.stop(when + duration);
};

/** Pitched sine with a falling envelope — the thump under a kick. */
const boom = (ctx: AudioContext, when: number, from: number, to: number, duration: number, gainValue: number): void => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(to, when + duration * 0.9);
  gain.gain.setValueAtTime(gainValue, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain);
  gain.connect(busFor(ctx));
  osc.start(when);
  osc.stop(when + duration + 0.02);
};

/**
 * Sound one drum at an exact time on the audio clock. Routing is `busFor`.
 */
export const playDrum = (ctx: AudioContext, midi: number, when: number, velocity = 100): void => {
  const level = Math.max(0.05, Math.min(1, velocity / 127));
  if (midi === KICK) {
    boom(ctx, when, 150, 45, 0.24, 0.9 * level);
    noise(ctx, when, 0.02, 0.25 * level, 1800);
    return;
  }
  if (midi === SNARE) {
    boom(ctx, when, 210, 130, 0.09, 0.32 * level);
    noise(ctx, when, 0.16, 0.5 * level, 1900, 0.5);
    return;
  }
  if (midi === CLAP) {
    // Three fast bursts is what makes a clap read as hands rather than noise.
    [0, 0.011, 0.022].forEach((offset) => noise(ctx, when + offset, 0.09, 0.36 * level, 1500, 0.9));
    return;
  }
  if (midi === OPEN_HAT) {
    noise(ctx, when, 0.28, 0.24 * level, 8200, 1.4);
    return;
  }
  // Closed hat, and the sensible default for any other percussion note.
  noise(ctx, when, 0.045, 0.26 * level, 9000, 1.4);
};
