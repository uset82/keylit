import type { PhraseNote, PhraseStyle } from "../types";

const CHORDS: Record<PhraseStyle, number[][]> = {
  rave: [
    [0, 3, 7, 10],
    [0, 4, 7, 10],
    [5, 8, 12, 15],
    [7, 10, 14, 17],
  ],
  house: [
    [0, 4, 7],
    [5, 9, 12],
    [7, 11, 14],
    [0, 4, 7, 11],
  ],
  techno: [
    [0, 7],
    [0, 3, 7],
    [5, 12],
    [7, 10, 14],
  ],
  piano: [
    [0, 4, 7, 11],
    [2, 5, 9, 12],
    [5, 9, 12, 16],
    [7, 11, 14, 17],
  ],
  garage: [
    [0, 3, 7, 10],
    [5, 8, 12],
    [7, 10, 14, 17],
    [3, 7, 10],
  ],
};

const ROOTS: Record<PhraseStyle, number> = {
  rave: 60,
  house: 57,
  techno: 55,
  piano: 60,
  garage: 58,
};

export const generatePhrase = (style: PhraseStyle, bars: 4 | 8): PhraseNote[] => {
  const voicings = CHORDS[style];
  const root = ROOTS[style];
  const notes: PhraseNote[] = [];
  const hits = style === "techno" ? [0, 1.5, 2.5, 4, 5.5] : [0, 1, 2, 3];
  const barCount = bars;
  for (let bar = 0; bar < barCount; bar += 1) {
    const chord = voicings[bar % voicings.length];
    const lift = bar % 2 === 1 && style !== "techno" ? 1 : 0;
    hits.forEach((hit, index) => {
      if (bar * 4 + hit >= bars * 4) return;
      const duration = style === "piano" ? 1.6 : style === "techno" ? 0.35 : 0.55;
      const velocity = 88 + ((index + bar) % 3) * 8;
      chord.forEach((interval, voice) => {
        if (style === "techno" && voice > 1 && index % 2 === 1) return;
        notes.push({
          midi: root + interval + lift,
          startBeat: bar * 4 + hit,
          durationBeats: duration,
          velocity: Math.min(127, velocity - voice * 4),
        });
      });
    });
  }
  return notes;
};
