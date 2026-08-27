import { stopLesson } from "../engine/lessons";
import { setAppMode, state } from "../store";
import type { AppMode } from "../types";

/**
 * The one way the mode changes, used by the toggle, the welcome cards and the
 * `set-mode` tool alike.
 *
 * Leaving a lesson running under DJ mode would strand the cyan next-key glow:
 * it is painted on the keys themselves, not inside a `.teach-only` wrapper, so
 * it survives the switch and points at a lesson nothing on screen mentions.
 */
export const applyAppMode = (next: AppMode): void => {
  if (next === state.appMode) return;
  if (next === "dj" && state.lesson) stopLesson();
  setAppMode(next);
};

/**
 * Wires every `[data-mode-pick]` control — the two big cards in the welcome
 * overlay and the small toggle above the keys. `updateView` paints the pressed
 * state and `body[data-mode]`; this only writes the value.
 */
export const mountMode = (): void => {
  document.querySelectorAll<HTMLElement>("[data-mode-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.modePick;
      if (next === "teach" || next === "dj") applyAppMode(next);
    });
  });
};
