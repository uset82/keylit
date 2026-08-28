/**
 * Every step of every lesson must say which hand and which finger.
 *
 * The hand map is the only part of the page a child who cannot read yet can
 * follow, and it hides itself when a step carries no fingering — so a lesson
 * with one bare step silently drops the guide mid-song, which is worse than
 * never showing it. This walks all sixteen lessons and fails on the first gap,
 * so adding a step without a finger is caught here rather than by a six-year-old.
 *
 * It also checks the fingering is playable: parallel arrays, fingers 1-5, and no
 * single-hand step reaching further than a hand can span.
 */
import jitiPkg from "jiti";

const createJiti = jitiPkg.createJiti ?? jitiPkg;
// lessons.ts pulls in the transport, which arms a timer on start. Nothing here
// listens to it; this stub only keeps the import from throwing under node.
globalThis.window = { setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0 };

const lessons = await createJiti(import.meta.url, { interopDefault: true }).import("../src/engine/lessons.ts");

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : `  (got ${actual}, wanted ${expected})`}`);
};

/** A hand covers about an octave; anything wider is two positions, not one step. */
const MAX_SPAN = 12;

const ids = lessons.listLessons().map((entry) => entry.id);
check("every lesson is listed", ids.length, 16);

let steps = 0;
const noFingers = [];
const misaligned = [];
const outOfRange = [];
const overStretched = [];

for (const id of ids) {
  for (const [index, step] of lessons.startLesson(id).steps.entries()) {
    steps += 1;
    const fingers = step.fingers ?? [];
    const hands = step.hands ?? [];
    const at = `${id}#${index}`;
    if (!fingers.length) {
      noFingers.push(at);
      continue;
    }
    // fingerBadge() reads fingers[step.midi.indexOf(midi)], so a short array
    // silently mislabels the keys rather than throwing.
    if (fingers.length !== step.midi.length || hands.length !== step.midi.length) misaligned.push(at);
    if (fingers.some((finger) => !Number.isInteger(finger) || finger < 1 || finger > 5)) outOfRange.push(at);

    const byHand = new Map();
    step.midi.forEach((midi, slot) => {
      const hand = hands[slot] ?? hands[0];
      byHand.set(hand, [...(byHand.get(hand) ?? []), midi]);
    });
    for (const notes of byHand.values()) {
      if (Math.max(...notes) - Math.min(...notes) > MAX_SPAN) overStretched.push(at);
    }
  }
}

check("every step names a finger", noFingers.join(" ") || "none", "none");
check("fingers and hands run parallel to midi", misaligned.join(" ") || "none", "none");
check("every finger is 1-5", outOfRange.join(" ") || "none", "none");
check("no step out-reaches one hand", overStretched.join(" ") || "none", "none");
check("all lessons walked", steps > 200, true);

console.log(failures ? `\n${failures} failing` : `\nall green (${steps} steps)`);
process.exit(failures ? 1 : 0);
