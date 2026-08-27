import { liftKey, pressKey, state } from "../store";
import type { Player } from "../types";

const QWERTY: Record<string, number> = {
  z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59,
  q: 60, "2": 61, w: 62, "3": 63, e: 64, r: 65, "5": 66, t: 67, "6": 68, y: 69, "7": 70, u: 71,
  i: 72, "9": 73, o: 74, "0": 75, p: 76,
};

export const qwertyToMidi = (key: string): number | null => {
  const base = QWERTY[key.toLowerCase()];
  if (base === undefined) return null;
  return base + state.octave * 12;
};

export const midiToComputerKey = (midi: number): string | null => {
  const base = midi - state.octave * 12;
  const entry = Object.entries(QWERTY).find(([, value]) => value === base);
  return entry ? entry[0].toUpperCase() : null;
};

export const holdNote = (midi: number, velocity = 100, player: Player = "human"): void => {
  const already = player === "human" ? state.humanHeld.includes(midi) : state.agentHeld.includes(midi);
  if (already) return;
  pressKey(midi, velocity, player);
};

export const releaseNote = (midi: number, player?: Player): void => {
  liftKey(midi, player);
};

export const START_MIDI = 48;
export const KEY_COUNT = 36;
export const isBlack = (midi: number): boolean => [1, 3, 6, 8, 10].includes(midi % 12);
