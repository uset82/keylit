import { holdNote, releaseNote } from "../ui/keyboard";
import { state } from "../store";
import { noteOff, noteOn } from "./audio";
import { followShadow } from "./duet";
import { gradeHumanNote } from "./lessons";

export const playHuman = (midi: number, velocity = 108): void => {
  holdNote(midi, velocity, "human");
  noteOn(midi, velocity);
  gradeHumanNote(midi);
  if (state.duetMode !== "follow") return;
  const shadow = followShadow(midi);
  holdNote(shadow, velocity, "agent");
  noteOn(shadow, Math.max(40, velocity - 12));
};

export const releaseHuman = (midi: number): void => {
  if (state.duetMode === "follow") {
    const shadow = followShadow(midi);
    releaseNote(shadow, "agent");
    noteOff(shadow);
  }
  releaseNote(midi, "human");
  noteOff(midi);
};

export const playAgentNotes = (
  notes: number[],
  velocity = 98,
  durationMs = 900,
  staggerMs = 0,
): void => {
  notes.forEach((midi, index) => {
    window.setTimeout(() => {
      holdNote(midi, velocity, "agent");
      noteOn(midi, velocity);
      window.setTimeout(() => {
        releaseNote(midi, "agent");
        noteOff(midi);
      }, durationMs);
    }, index * staggerMs);
  });
};
