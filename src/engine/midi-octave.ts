/**
 * Which register is the MIDI controller in?
 *
 * Web MIDI reports a device name and nothing else — not the key count, and not
 * the position of the OCT buttons that decide which notes a small controller
 * transmits. A 25-key board two octaves down sends note 36 where a lesson wants
 * 60, and every consumer of that note then misbehaves at once: the key that
 * lights up is off the visible bed, the pitch is a bass rumble instead of the
 * melody, and the child is marked wrong with no explanation.
 *
 * So the register is inferred from what arrives and corrected at the input
 * boundary. Offsets here are absolute, never relative to the shift already in
 * force: every observation recomputes the whole answer from the raw note, so a
 * wrong guess is overwritten by the next note instead of compounding.
 */
import { patchState, state } from "../store";
import { KEY_COUNT, START_MIDI } from "../ui/keyboard";
import { nextMidi } from "./lessons";

/** The bed the student can actually see and aim at. */
const BED_LOW = START_MIDI;
const BED_HIGH = START_MIDI + KEY_COUNT - 1;

/** No controller's octave buttons reach further than three octaves. */
const MAX_SHIFT = 36;

/** Consecutive agreeing notes needed before shifting on an on-screen key. */
const CONFIRMATIONS = 2;

/**
 * The shift that would turn `received` into `expected`, or null when the two
 * differ by something other than whole octaves.
 */
export const octaveOffset = (received: number, expected: number): number | null => {
  const delta = expected - received;
  // One semitone out is a wrong note, not a wrong register.
  if (delta === 0 || delta % 12 !== 0) return null;
  if (Math.abs(delta) > MAX_SHIFT) return null;
  return delta;
};

/** The nearest whole-octave shift among every note the step will accept. */
export const bestOctaveOffset = (received: number, expected: number[]): number | null => {
  let best: number | null = null;
  for (const want of expected) {
    const offset = octaveOffset(received, want);
    if (offset === null) continue;
    if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
};

/**
 * With no lesson running there is no note to compare against, so the only
 * evidence left is the bed itself: a controller whose keys all land off-screen
 * is in the wrong register whatever the student meant to play.
 */
export const bedOffset = (received: number): number | null => {
  if (received >= BED_LOW && received <= BED_HIGH) return null;
  const octaves =
    received < BED_LOW
      ? Math.ceil((BED_LOW - received) / 12)
      : -Math.ceil((received - BED_HIGH) / 12);
  const shift = octaves * 12;
  if (Math.abs(shift) > MAX_SHIFT) return null;
  const landed = received + shift;
  return landed >= BED_LOW && landed <= BED_HIGH ? shift : null;
};

/**
 * The absolute shift this one note argues for, or null if it argues for nothing.
 *
 * Zero is a real answer, not the absence of one: a student who corrects the OCT
 * buttons themselves starts sending exactly what the lesson asked for, and
 * without this the shift learned a minute ago would keep displacing it forever.
 */
const impliedShift = (raw: number, expected: number[]): number | null => {
  if (!expected.length) return bedOffset(raw);
  if (expected.includes(raw)) return 0;
  return bestOctaveOffset(raw, expected);
};

export type OctaveDetector = {
  /**
   * Weigh one incoming note. Returns the absolute shift to adopt, or null to
   * leave the current one alone.
   *
   * @param raw       the note as the controller sent it, before any shift
   * @param expected  notes the current lesson step accepts, empty when idle
   * @param inForce   the shift currently applied to incoming notes
   */
  observe: (raw: number, expected: number[], inForce: number) => number | null;
  reset: () => void;
};

export const createOctaveDetector = (): OctaveDetector => {
  let evidence: { shift: number; count: number } | null = null;

  return {
    observe: (raw, expected, inForce) => {
      const heard = raw + inForce;

      // A note that already lands where the lesson wants it proves the shift in
      // force is right, so any half-built case against it is dropped.
      if (expected.includes(heard)) {
        evidence = null;
        return null;
      }

      const candidate = impliedShift(raw, expected);
      if (candidate === null || candidate === inForce) {
        evidence = null;
        return null;
      }

      // A key that is not on the visible bed cannot be a legitimate attempt —
      // there is nothing there to aim at — so that case needs no corroboration.
      // A wrong octave inside the bed might be a genuine mistake, which is worth
      // marking rather than silently accommodating, so it needs a second note.
      if (heard < BED_LOW || heard > BED_HIGH) {
        evidence = null;
        return candidate;
      }

      const count = evidence?.shift === candidate ? evidence.count + 1 : 1;
      if (count < CONFIRMATIONS) {
        evidence = { shift: candidate, count };
        return null;
      }
      evidence = null;
      return candidate;
    },

    reset: () => {
      evidence = null;
    },
  };
};

/* ---- the live detector, wired to the store ---- */

const detector = createOctaveDetector();

/**
 * Raw note to the note it actually sounded.
 *
 * Without this, a shift adopted between a key going down and coming up would
 * release a different note than it started, leaving the original droning until
 * the page reloads.
 */
const sounding = new Map<number, number>();

const SHIFT_KEY = "keylit.midiShift";

/** Which controller the remembered shift belongs to. */
let currentDevice: string | null = null;

/** localStorage is user-editable, so a stored shift is not trusted on sight. */
const recall = (device: string): number => {
  try {
    const stored = Number(localStorage.getItem(`${SHIFT_KEY}.${device}`));
    const usable = Number.isInteger(stored) && stored % 12 === 0 && Math.abs(stored) <= MAX_SHIFT;
    return usable ? stored : 0;
  } catch {
    return 0;
  }
};

/**
 * How far the controller sits from the lesson, phrased from the student's side:
 * the app shifts up, which means the keyboard was playing low.
 */
const describeShift = (shift: number): string => {
  // Only ever one, two or three, and spelled out: this line is read to children.
  const spans = ["", "an octave", "two octaves", "three octaves"];
  const span = spans[Math.abs(shift) / 12] ?? "several octaves";
  return `${span} ${shift > 0 ? "below" : "above"}`;
};

/** Terse form for the rack readout: "2 oct down", or nothing when unshifted. */
export const shiftSummary = (shift: number): string => {
  if (shift === 0) return "";
  return `${Math.abs(shift) / 12} oct ${shift > 0 ? "down" : "up"}`;
};

/** The last shift the student was told about, so it is said once and not per note. */
let announced: number | null = null;

const announce = (shift: number): void => {
  if (announced === shift) return;
  announced = shift;
  const text =
    shift === 0
      ? "Your keyboard is back in the lesson's own octave, so I have stopped moving it."
      : `I hear your keyboard ${describeShift(shift)} the lesson. I have matched it — keep playing.`;
  window.dispatchEvent(new CustomEvent("keylit:coach", { detail: text }));
};

const adopt = (shift: number): void => {
  patchState({ midiShift: shift });
  announce(shift);
  if (!currentDevice) return;
  try {
    localStorage.setItem(`${SHIFT_KEY}.${currentDevice}`, String(shift));
  } catch {
    // Private-mode Safari refuses writes. The shift still holds for this session.
  }
};

/**
 * A controller arrived, changed, or went away. Re-binding happens on every
 * `statechange`, so this only does work when the device is genuinely different.
 */
export const useDevice = (device: string | null): void => {
  if (device === currentDevice) return;
  currentDevice = device;
  detector.reset();
  sounding.clear();
  announced = null;
  // A remembered register spares the student teaching it to the app twice, and
  // goes unannounced: nothing has changed from their point of view.
  patchState({ midiShift: device ? recall(device) : 0 });
};

/** Fold an incoming note into the lesson's register, learning the offset as it goes. */
export const shiftNoteOn = (raw: number): number => {
  const adopted = detector.observe(raw, nextMidi(), state.midiShift);
  if (adopted !== null) adopt(adopted);
  const midi = raw + state.midiShift;
  sounding.set(raw, midi);
  return midi;
};

/** The note this key started, so it is the note that stops. */
export const shiftNoteOff = (raw: number): number => {
  const midi = sounding.get(raw) ?? raw + state.midiShift;
  sounding.delete(raw);
  return midi;
};
