import type { PhraseNote } from "../types";

/**
 * The narrow, validated shape that can cross from a language model into the
 * sequencer. The model can suggest notes, but it never gets to address a key
 * outside KEYLIT's visible three octaves or create an unbounded event list.
 */
export type GeneratedPhrase = {
  notes: PhraseNote[];
  bpm?: number;
  bars: 4 | 8;
};

const MIN_MIDI = 48;
const MAX_MIDI = 83;
const MAX_NOTES = 96;
const MAX_BEAT = 31.95;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Drop, rather than clamp, malformed notes. Turning an invalid request into an
 * arbitrary nearby pitch would make a model error sound intentional.
 */
const noteFrom = (value: unknown): PhraseNote | null => {
  if (!isRecord(value)) return null;
  const midi = finite(value.midi);
  const startBeat = finite(value.startBeat);
  const durationBeats = finite(value.durationBeats);
  const velocity = finite(value.velocity);
  if (
    midi === null ||
    startBeat === null ||
    durationBeats === null ||
    velocity === null ||
    !Number.isInteger(midi) ||
    midi < MIN_MIDI ||
    midi > MAX_MIDI ||
    startBeat < 0 ||
    startBeat > MAX_BEAT ||
    durationBeats < 0.05 ||
    durationBeats > 8 ||
    velocity < 1 ||
    velocity > 127
  ) {
    return null;
  }
  return { midi, startBeat, durationBeats, velocity: Math.round(velocity) };
};

export const clampGeneratedPhrase = (raw: unknown): GeneratedPhrase | null => {
  if (!isRecord(raw) || !Array.isArray(raw.notes)) return null;
  const notes = raw.notes
    .slice(0, MAX_NOTES)
    .map(noteFrom)
    .filter((note): note is PhraseNote => note !== null)
    .sort((first, second) => first.startBeat - second.startBeat || first.midi - second.midi);
  if (!notes.length) return null;

  const requestedBpm = finite(raw.bpm);
  const bpm = requestedBpm !== null && requestedBpm >= 40 && requestedBpm <= 200 ? Math.round(requestedBpm) : undefined;
  const finalBeat = Math.max(...notes.map((note) => note.startBeat + note.durationBeats));
  const bars: 4 | 8 = raw.bars === 8 || finalBeat > 16 ? 8 : 4;
  return { notes, ...(bpm ? { bpm } : {}), bars };
};
