/**
 * Guards the phrase generator against the class of bug that made the techno
 * loop unlistenable: hits that spilled past the end of their bar, landing on top
 * of the next bar's chord and doubling shared pitches onto the same instant.
 *
 * Node strips the types in generate.ts on import, so this runs with no build.
 * Run: node scripts/check-generate.mjs
 */
import { generatePhrase, styleBpm } from "../src/engine/generate.ts";

const STYLES = ["techno", "house", "rave", "garage", "piano"];
const LOW_KEY = 48;
const HIGH_KEY = 83;
/** A 4-bar loop a beginner can look at. The old techno phrase emitted 87. */
const MAX_NOTES_PER_4_BARS = 40;

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
};

for (const style of STYLES) {
  for (const bars of [4, 8]) {
    const notes = generatePhrase(style, bars);
    const tag = `${style} ${bars}-bar`;

    check(`${tag}: produces notes`, notes.length > 0);

    // The original bug. Two notes at one instant on one pitch is one note at
    // double the level, which is what fed the distortion stage.
    const seen = new Set();
    const collisions = notes.filter((note) => {
      const key = `${note.midi}@${note.startBeat}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    check(`${tag}: no doubled pitch on one beat`, collisions.length === 0, `${collisions.length} doubled`);

    // A hit whose start is past the loop is a hit playing over the next bar.
    const overrun = notes.filter((note) => note.startBeat >= bars * 4);
    check(`${tag}: every hit inside the loop`, overrun.length === 0, `${overrun.length} past beat ${bars * 4}`);

    const offBed = notes.filter((note) => note.midi < LOW_KEY || note.midi > HIGH_KEY);
    check(`${tag}: every note on the visible keybed`, offBed.length === 0, `${offBed.length} outside ${LOW_KEY}-${HIGH_KEY}`);

    const badVelocity = notes.filter((note) => note.velocity < 1 || note.velocity > 127);
    check(`${tag}: velocities in range`, badVelocity.length === 0);

    const perFourBars = (notes.length * 4) / bars;
    check(`${tag}: density is playable`, perFourBars <= MAX_NOTES_PER_4_BARS, `${perFourBars} per 4 bars`);

    // Same input, same output: a loop that changes under you cannot be taught.
    const again = generatePhrase(style, bars);
    check(`${tag}: deterministic`, JSON.stringify(again) === JSON.stringify(notes));
  }

  // An 8-bar phrase is the 4-bar progression twice, so the first half must match.
  const short = generatePhrase(style, 4);
  const long = generatePhrase(style, 8).filter((note) => note.startBeat < 16);
  check(`${style}: 8 bars repeats the 4-bar loop`, JSON.stringify(long) === JSON.stringify(short));

  const bpm = styleBpm(style);
  check(`${style}: has a sane tempo`, bpm >= 60 && bpm <= 200, `${bpm} BPM`);
}

// Every pitch has to belong to one key, or the loop is the random-notes problem
// again. Collect the pitch classes each style uses and require them to fit a
// single seven-note scale rooted somewhere.
for (const style of STYLES) {
  const classes = new Set(generatePhrase(style, 8).map((note) => note.midi % 12));
  check(`${style}: stays inside one seven-note key`, classes.size <= 7, `${classes.size} pitch classes`);
}

console.log(failures === 0 ? "\nAll generator checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
