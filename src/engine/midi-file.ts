import type { PhraseNote } from "../types";

const writeVarLen = (value: number): number[] => {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
};

export const writeMidiFile = (phrase: PhraseNote[], bpm: number): Uint8Array => {
  const ticks = 480;
  const tempo = Math.round(60_000_000 / bpm);
  const events: { tick: number; bytes: number[] }[] = [
    { tick: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] },
  ];
  phrase.forEach((note) => {
    const start = Math.round(note.startBeat * ticks);
    const end = Math.round((note.startBeat + note.durationBeats) * ticks);
    events.push({ tick: start, bytes: [0x90, note.midi, note.velocity] });
    events.push({ tick: end, bytes: [0x80, note.midi, 0] });
  });
  events.sort((a, b) => a.tick - b.tick);
  const track: number[] = [];
  let last = 0;
  events.forEach((event) => {
    track.push(...writeVarLen(event.tick - last), ...event.bytes);
    last = event.tick;
  });
  track.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ticks >> 8) & 0xff, ticks & 0xff,
  ];
  const body = [
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff,
    (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff,
    track.length & 0xff,
    ...track,
  ];
  return Uint8Array.from([...header, ...body]);
};

export const downloadBytes = (bytes: Uint8Array, filename: string, type: string): void => {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
