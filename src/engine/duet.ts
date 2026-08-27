import { state } from "../store";
import type { PhraseNote, TakeEvent } from "../types";
import { nameList } from "./notes";

export { midiName, nameList } from "./notes";

export const duetLine = (): string => {
  const you = nameList(state.humanHeld);
  const agent = nameList(state.agentHeld);
  if (state.duetMode === "follow") return `FOLLOW · YOU ${you} · I SHADOW +8VA`;
  if (state.humanHeld.length && state.agentHeld.length) return `DUET · YOU ${you} · AGENT ${agent}`;
  if (state.humanHeld.length) return `YOU HOLD ${you} · ASK ME TO HARMONIZE`;
  if (state.agentHeld.length) return `AGENT ${agent} · YOUR TURN`;
  if (state.humanTake.length) return `TAKE ${state.humanTake.length} NOTES · ASK ME TO ANSWER`;
  return "PLAY FIRST · I LISTEN ON THESE KEYS";
};

export const recentTake = (windowMs = 8000): TakeEvent[] => {
  const now = performance.now();
  return state.humanTake.filter((event) => now - event.atMs <= windowMs);
};

export const harmonyForHeld = (held: number[]): number[] => {
  if (!held.length) return [];
  const sorted = [...held].sort((a, b) => a - b);
  const root = sorted[0];
  const pcs = new Set(sorted.map((note) => note % 12));
  const intervals = held.length === 1 ? [7, 16] : held.length === 2 ? [4, 7, 11] : [11, 14];
  const extras: number[] = [];
  for (const interval of intervals) {
    const midi = root + interval;
    if (midi > 96 || midi < 0) continue;
    if (pcs.has(midi % 12) || held.includes(midi)) continue;
    extras.push(midi);
    pcs.add(midi % 12);
    if (extras.length >= 2) break;
  }
  return extras;
};

export const answerFromTake = (take: TakeEvent[]): number[] => {
  const unique = [...new Set(take.map((event) => event.midi))];
  if (!unique.length) return [];
  return unique
    .slice(-6)
    .map((midi) => Math.min(127, midi + 7))
    .reverse();
};

export const takeToPhrase = (take: TakeEvent[], bpm: number): PhraseNote[] => {
  if (!take.length) return [];
  const origin = take[0].atMs;
  const beatMs = 60000 / bpm;
  return take.map((event, index) => {
    const next = take[index + 1];
    const span = next ? Math.max(80, next.atMs - event.atMs) : 400;
    return {
      midi: event.midi,
      startBeat: (event.atMs - origin) / beatMs,
      durationBeats: Math.min(2, span / beatMs),
      velocity: event.velocity,
    };
  });
};

export const followShadow = (humanMidi: number): number => Math.min(127, humanMidi + 12);
