import type { PhraseNote, PhraseStyle } from "../types";

/**
 * Style-driven phrase generation.
 *
 * The shape here — a key, a scale, one chord progression shared across the whole
 * loop, and a 16-step rhythm mask per style — is the one every rule-based MIDI
 * generator converges on. It replaced a table of four unrelated chord voicings
 * picked by `bar % 4`, which had no key and no progression, so consecutive bars
 * had nothing to do with each other and the result read as random notes.
 */

/** Semitones from the tonic. Seven-note modes only: `chordTones` walks them by index. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

/** The visible keybed, from ui/keyboard. Every generated note is folded into it. */
const LOW_KEY = 48;
const HIGH_KEY = 83;

const STEPS_PER_BAR = 16;
const BEATS_PER_STEP = 4 / STEPS_PER_BAR;

type StyleProfile = {
  /** MIDI of the tonic. */
  tonic: number;
  scale: number[];
  /** One scale degree per bar, cycled — so an 8-bar phrase is the loop twice. */
  progression: number[];
  /**
   * Sixteen steps of one bar. Zero rests; anything else is the velocity of the
   * stab. Because a step index can never reach 16, a hit can never land in the
   * next bar — which is exactly how the old hit list piled two chords onto the
   * same beat.
   */
  mask: number[];
  /** Which tones of the 1-3-5-7 stack to sound, bottom-up. */
  voices: number[];
  /** Note length, in sixteenths. */
  gateSteps: number;
  bpm: number;
};

const PROFILES: Record<PhraseStyle, StyleProfile> = {
  // A minor i-VI-III-VII on offbeat eighths, root and fifth only: the stab that
  // leaves room for the kick that a rompler has no way to play.
  techno: {
    tonic: 57,
    scale: MINOR,
    progression: [0, 5, 2, 6],
    mask: [0, 0, 100, 0, 0, 0, 92, 0, 0, 0, 100, 0, 0, 0, 92, 0],
    voices: [0, 2],
    gateSteps: 2,
    bpm: 130,
  },
  // F major I-vi-IV-V, the progression under most of house, comped on the
  // downbeat and the two offbeats that give it its push.
  house: {
    tonic: 53,
    scale: MAJOR,
    progression: [0, 5, 3, 4],
    mask: [96, 0, 0, 0, 0, 0, 92, 0, 0, 0, 0, 0, 0, 0, 88, 0],
    voices: [0, 1, 2],
    gateSteps: 3,
    bpm: 124,
  },
  // C minor i-VII-VI-VII, hit twice fast off the downbeat: the rave stab.
  rave: {
    tonic: 60,
    scale: MINOR,
    progression: [0, 6, 5, 6],
    mask: [104, 0, 0, 96, 0, 0, 0, 0, 0, 0, 96, 0, 0, 0, 0, 0],
    voices: [0, 1, 2],
    gateSteps: 2,
    bpm: 138,
  },
  // Dorian, for the major IV over a minor tonic that gives garage its lift.
  garage: {
    tonic: 57,
    scale: DORIAN,
    progression: [0, 6, 3, 4],
    mask: [100, 0, 0, 0, 0, 0, 92, 0, 0, 0, 96, 0, 0, 0, 0, 0],
    voices: [0, 1, 2],
    gateSteps: 3,
    bpm: 132,
  },
  // Held sevenths, two to a bar. The one profile that is not a stab.
  piano: {
    tonic: 60,
    scale: MAJOR,
    progression: [0, 5, 3, 4],
    mask: [92, 0, 0, 0, 0, 0, 0, 0, 84, 0, 0, 0, 0, 0, 0, 0],
    voices: [0, 1, 2, 3],
    gateSteps: 14,
    bpm: 96,
  },
};

/**
 * The 1-3-5-7 stack on a scale degree, as semitones from the tonic.
 *
 * Stacking by scale index rather than by fixed semitones is what keeps every
 * chord in key: the third is whatever the scale puts two steps up, so a minor
 * scale yields minor and major chords in the right places without a table.
 */
const chordTones = (scale: number[], degree: number): number[] =>
  [0, 2, 4, 6].map((offset) => {
    const index = degree + offset;
    return scale[index % scale.length] + 12 * Math.floor(index / scale.length);
  });

/** Fold a pitch into the visible keybed by octaves, so a lit key always exists. */
const intoRange = (midi: number): number => {
  let folded = midi;
  while (folded > HIGH_KEY) folded -= 12;
  while (folded < LOW_KEY) folded += 12;
  return folded;
};

export const generatePhrase = (style: PhraseStyle, bars: 4 | 8): PhraseNote[] => {
  const profile = PROFILES[style] ?? PROFILES.piano;
  const notes: PhraseNote[] = [];
  // Two notes of the same pitch at the same instant are not a chord, they are
  // one note at double the level — which is what fed the distortion stage.
  const placed = new Set<string>();

  for (let bar = 0; bar < bars; bar += 1) {
    const degree = profile.progression[bar % profile.progression.length];
    const tones = chordTones(profile.scale, degree);
    for (let step = 0; step < STEPS_PER_BAR; step += 1) {
      const velocity = profile.mask[step];
      if (!velocity) continue;
      const startBeat = bar * 4 + step * BEATS_PER_STEP;
      profile.voices.forEach((voice, index) => {
        const midi = intoRange(profile.tonic + tones[voice]);
        const key = `${midi}@${startBeat}`;
        if (placed.has(key)) return;
        placed.add(key);
        notes.push({
          midi,
          startBeat,
          durationBeats: profile.gateSteps * BEATS_PER_STEP,
          velocity: Math.max(32, Math.min(127, velocity - index * 6)),
        });
      });
    }
  }
  return notes;
};

/** The tempo a style is written at, so a techno loop does not play at 96 BPM. */
export const styleBpm = (style: PhraseStyle): number => (PROFILES[style] ?? PROFILES.piano).bpm;
