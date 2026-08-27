const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const midiName = (midi: number): string => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

export const nameList = (notes: number[]): string =>
  notes.length ? [...notes].sort((a, b) => a - b).map(midiName).join(" ") : "—";
