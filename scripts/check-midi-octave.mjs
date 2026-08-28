/**
 * A MIDI controller in the wrong octave breaks three things at once — the key
 * that lights is off-screen, the pitch is a rumble, and the child is marked
 * wrong — so the register is inferred from what arrives and corrected at the
 * input boundary.
 *
 * The two failure modes worth guarding are silent: adopting a shift from a note
 * that was simply a wrong note, and failing to let go of a shift once the
 * student fixes the OCT buttons themselves. Both are checked here, along with
 * the note-on/note-off pairing that stops a shift landing mid-press from leaving
 * a note droning forever.
 */
import jitiPkg from "jiti";

const createJiti = jitiPkg.createJiti ?? jitiPkg;
// The engine arms timers and talks to the page. Nothing here listens to either.
globalThis.window = {
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  dispatchEvent: () => true,
};

const jiti = createJiti(import.meta.url, { interopDefault: true });
const octave = await jiti.import("../src/engine/midi-octave.ts");
const lessons = await jiti.import("../src/engine/lessons.ts");
const store = await jiti.import("../src/store.ts");

const { octaveOffset, bestOctaveOffset, bedOffset, createOctaveDetector, shiftSummary } = octave;

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : `  (got ${actual}, wanted ${expected})`}`);
};

/* ---- the pure offsets ---- */

check("two octaves down reads as +24", octaveOffset(36, 60), 24);
check("two octaves up reads as -24", octaveOffset(84, 60), -24);
// The whole point of the multiple-of-12 test: a child pressing the next key
// along must stay a mistake, not become a reason to transpose the instrument.
check("a semitone out is a wrong note", octaveOffset(61, 60), null);
check("the same note implies nothing", octaveOffset(60, 60), null);
check("four octaves is beyond any OCT button", octaveOffset(12, 60), null);

check("a note under the bed is pulled up", bedOffset(36), 12);
check("a note just over the bed drops one octave", bedOffset(90), -12);
// 96 - 12 is 84, still off the top of a bed that ends at 83, so one is not enough.
check("a note well over it drops two", bedOffset(96), -24);
check("a note already on the bed needs nothing", bedOffset(60), null);

check("the nearest octave wins", bestOctaveOffset(48, [60, 72]), 12);
check("a chord with no octave answer gives none", bestOctaveOffset(55, [60, 64]), null);

/* ---- how much evidence it takes ---- */

{
  const detector = createOctaveDetector();
  // Nothing is on screen at note 36 to have aimed at, so this cannot be a slip.
  check("an off-screen key shifts on the first note", detector.observe(36, [60], 0), 24);
}

{
  const detector = createOctaveDetector();
  check("an on-screen wrong octave waits", detector.observe(72, [60], 0), null);
  check("and shifts on the second", detector.observe(72, [60], 0), -12);
}

{
  const detector = createOctaveDetector();
  detector.observe(72, [60], 0);
  // Two different wrong octaves are a child hunting for the note, not a device.
  check("disagreeing notes never reach a shift", detector.observe(48, [60], 0), null);
}

{
  const detector = createOctaveDetector();
  detector.observe(72, [60], 0);
  check("a correct note drops the case", detector.observe(60, [60], 0), null);
  check("so the count starts over", detector.observe(72, [60], 0), null);
}

{
  const detector = createOctaveDetector();
  check("with no lesson it falls back to the bed", detector.observe(36, [], 0), 12);
}

{
  const detector = createOctaveDetector();
  // The student pressed OCT+ themselves. Without this the shift learned a minute
  // ago keeps displacing a controller that is now already correct.
  check("a shift is dropped once the controller is fixed", detector.observe(60, [60], 24), 0);
  check("and a working shift is left alone", detector.observe(36, [60], 24), null);
}

/* ---- the live path, through the store ---- */

{
  store.patchState({ midiShift: 0, lesson: null });
  const sounded = octave.shiftNoteOn(36);
  check("an idle controller is folded onto the bed", sounded, 48);
  check("and the shift is recorded", store.state.midiShift, 12);

  // A shift adopted between key-down and key-up must not change which note the
  // key-up stops, or the original hangs until the page reloads.
  store.patchState({ midiShift: -24 });
  check("key-up releases the note key-down started", octave.shiftNoteOff(36), 48);

  store.patchState({ midiShift: 0 });
}

{
  const first = lessons.listLessons()[0];
  store.setLesson(lessons.startLesson(first.id));
  store.patchState({ midiShift: 0 });
  const want = lessons.nextMidi()[0];
  const sounded = octave.shiftNoteOn(want - 24);
  check("in a lesson, two octaves down lands on the target", sounded, want);
  octave.shiftNoteOff(want - 24);
  store.setLesson(null);
  store.patchState({ midiShift: 0 });
}

check("the readout stays quiet when unshifted", shiftSummary(0), "");
check("and names the shift when there is one", shiftSummary(24), "2 oct down");
check("in the direction the student moved", shiftSummary(-12), "1 oct up");

/* ---- the curriculum has to fit the hardware ---- */

// A 25-key controller spans 25 semitones. A lesson wider than that cannot be
// played on one at any OCT setting, so adding one is caught here.
const spans = lessons.listLessons().map((entry) => {
  const notes = lessons.startLesson(entry.id).steps.flatMap((step) => step.midi);
  return { title: entry.title, span: Math.max(...notes) - Math.min(...notes) + 1 };
});
const tooWide = spans.filter((entry) => entry.span > 25);
check("every lesson fits a 25-key controller", tooWide.map((e) => e.title).join(" ") || "none", "none");

console.log(failures ? `\n${failures} failing` : `\nall green (${spans.length} lessons fit 25 keys)`);
process.exit(failures ? 1 : 0);
