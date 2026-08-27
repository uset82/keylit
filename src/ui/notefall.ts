import { state } from "../store";

/**
 * A short note highway above the keys, for strict-timing lessons.
 *
 * Deliberately *not* animated against a free-running clock. A KEYLIT lesson waits
 * indefinitely for the right key, so bars falling on a wall clock would sail past
 * the keybed while the student is still hunting for the first note. Instead the
 * bars are laid out by beat distance from the step you are on, and CSS slides
 * them down when that step advances — so the highway shows the shape of what is
 * coming (which notes are quick, which are held) and can never desync.
 */

/** Vertical scale. 26px a beat keeps two bars legible inside a phone-sized rail. */
const PX_PER_BEAT = 26;

/** A note with no successor to measure against still needs a length. */
const DEFAULT_BEATS = 1;

let signature = "";

const keyGeometry = (midi: number): { left: string; width: string } | null => {
  const key = document.querySelector<HTMLElement>(`#piano .key[data-midi="${midi}"]`);
  if (!key?.style.left || !key.style.width) return null;
  return { left: key.style.left, width: key.style.width };
};

export const renderNotefall = (): void => {
  const rail = document.querySelector<HTMLElement>("#notefall");
  if (!rail) return;
  const lesson = state.lesson;
  const live = Boolean(lesson) && lesson?.timing === "strict" && lesson.lastGrade !== "done";
  rail.classList.toggle("hidden", !live);
  if (!live || !lesson) {
    if (signature) {
      rail.replaceChildren();
      signature = "";
    }
    return;
  }

  // The keybed range is part of the signature because a key's `left` is a
  // percentage of the *visible* range: shifting an octave silently rewrites every
  // one of them, and bars kept from the previous range point at the wrong keys.
  const keys = document.querySelectorAll("#piano .key");
  const sig = `${lesson.id}:${lesson.stepIndex}:${keys.length}:${(keys[0] as HTMLElement | undefined)?.dataset.midi ?? ""}`;
  if (sig === signature) return;
  signature = sig;

  const current = lesson.steps[lesson.stepIndex];
  const origin = current?.beat ?? 0;
  const visibleBeats = Math.max(2, rail.clientHeight / PX_PER_BEAT);
  const bars: HTMLElement[] = [];

  for (let index = lesson.stepIndex; index < lesson.steps.length; index += 1) {
    const step = lesson.steps[index];
    if (step.beat === undefined) break;
    const offset = step.beat - origin;
    if (offset > visibleBeats) break;
    const length = (lesson.steps[index + 1]?.beat ?? step.beat + DEFAULT_BEATS) - step.beat;
    step.midi.forEach((midi) => {
      const geometry = keyGeometry(midi);
      if (!geometry) return;
      const bar = document.createElement("span");
      bar.className = index === lesson.stepIndex ? "notefall-bar now" : "notefall-bar";
      bar.style.left = geometry.left;
      bar.style.width = geometry.width;
      bar.style.bottom = `${offset * PX_PER_BEAT}px`;
      bar.style.height = `${Math.max(8, length * PX_PER_BEAT - 4)}px`;
      bars.push(bar);
    });
  }

  rail.replaceChildren(...bars);
};
