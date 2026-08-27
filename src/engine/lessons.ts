import { patchState, state } from "../store";
import type { LessonId, LessonState, LessonStep } from "../types";
import { midiName, nameList } from "./notes";
import { midiToComputerKey } from "../ui/keyboard";

type LessonDef = {
  id: LessonId;
  title: string;
  coach: string;
  steps: LessonStep[];
};

const note = (midi: number, coach: string): LessonStep => ({ midi: [midi], coach });

const LESSONS: LessonDef[] = [
  {
    id: "first-keys",
    title: "Find C D E",
    coach: "Three white keys. I light the next one. You press it on this piano.",
    steps: [
      note(60, "Middle C. Press Q, or click the glowing key."),
      note(62, "D is the next white key to the right. Press W."),
      note(64, "E is one more white key. Press E."),
      { midi: [60, 64], hold: true, coach: "Hold C and E together — Q and E at the same time." },
    ],
  },
  {
    id: "c-scale",
    title: "C major scale",
    coach: "Eight white keys up from middle C. I light one. You play it. I hear you.",
    steps: [
      note(60, "C — start here. Q."),
      note(62, "D — next white key. W."),
      note(64, "E — next white key. E."),
      note(65, "F — next white key. R."),
      note(67, "G — next white key. T."),
      note(69, "A — next white key. Y."),
      note(71, "B — next white key. U."),
      note(72, "C an octave up. I."),
    ],
  },
  {
    id: "c-chord",
    title: "C major chord",
    coach: "Build the triad. I show each note, then you hold all three.",
    steps: [
      note(60, "Root: C. Q."),
      note(64, "Third: E. E."),
      note(67, "Fifth: G. T."),
      { midi: [60, 64, 67], hold: true, coach: "Hold C E G together — Q E T. That is C major." },
    ],
  },
  {
    id: "twinkle",
    title: "Twinkle Twinkle",
    coach: "I light the next note of the tune. Play only that key.",
    steps: [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60].map((midi, index) =>
      note(midi, `Twinkle · note ${index + 1}. Press ${midiToComputerKey(midi) ?? midiName(midi)}.`),
    ),
  },
  {
    id: "ode",
    title: "Ode to Joy",
    coach: "Beethoven’s first phrase. I light it. You copy it on these keys.",
    steps: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62].map((midi, index) =>
      note(midi, `Ode to Joy · note ${index + 1}. Press ${midiToComputerKey(midi) ?? midiName(midi)}.`),
    ),
  },
];

export const listLessons = (): Array<{ id: string; title: string; steps: number; coach: string }> =>
  LESSONS.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    steps: lesson.steps.length,
    coach: lesson.coach,
  }));

export const resolveLessonId = (raw: string): LessonId | null => {
  const text = raw.trim().toLowerCase();
  if (["first-keys", "first", "beginner", "cde", "find"].some((key) => text.includes(key))) return "first-keys";
  if (["c-scale", "scale", "c major scale"].some((key) => text.includes(key))) return "c-scale";
  if (["c-chord", "chord", "triad"].some((key) => text.includes(key))) return "c-chord";
  if (["twinkle", "star"].some((key) => text.includes(key))) return "twinkle";
  if (["ode", "joy", "beethoven"].some((key) => text.includes(key))) return "ode";
  return LESSONS.some((lesson) => lesson.id === text) ? (text as LessonId) : null;
};

const makeRuntime = (id: LessonState["id"], title: string, coach: string, steps: LessonStep[]): LessonState => ({
  id,
  title,
  coach,
  steps,
  stepIndex: 0,
  hits: 0,
  misses: 0,
  lastGrade: "wait",
  lastPlayed: null,
});

export const currentStep = (): LessonStep | null => {
  const lesson = state.lesson;
  if (!lesson || lesson.lastGrade === "done") return null;
  return lesson.steps[lesson.stepIndex] ?? null;
};

export const nextMidi = (): number[] => currentStep()?.midi ?? [];

export const keyHint = (midi: number): string => {
  const letter = midiToComputerKey(midi);
  return letter ? `${midiName(midi)} · ${letter}` : midiName(midi);
};

export const nextHints = (): string[] => nextMidi().map(keyHint);

export const teacherLine = (): string => {
  const lesson = state.lesson;
  if (!lesson) return "";
  if (lesson.lastGrade === "done") {
    return `DONE · ${lesson.title.toUpperCase()} · ${lesson.hits} HITS`;
  }
  const step = currentStep();
  if (!step) return `LESSON · ${lesson.title.toUpperCase()}`;
  const target = nameList(step.midi);
  const keys = step.midi.map((midi) => midiToComputerKey(midi) ?? midiName(midi)).join(" ");
  if (lesson.lastGrade === "miss") {
    const played = lesson.lastPlayed == null ? "" : midiName(lesson.lastPlayed);
    return `TRY AGAIN · WANT ${target} · YOU ${played || "—"}`;
  }
  if (step.hold) return `HOLD ${target} · ${keys}`;
  return `NEXT ${target} · PRESS ${keys}`;
};

export const lessonSnapshot = () => {
  const lesson = state.lesson;
  const step = currentStep();
  return {
    teaching: Boolean(lesson),
    lesson: lesson
      ? {
          id: lesson.id,
          title: lesson.title,
          coach: lesson.coach,
          step: lesson.stepIndex + 1,
          total: lesson.steps.length,
          hits: lesson.hits,
          misses: lesson.misses,
          lastGrade: lesson.lastGrade,
          lastPlayed: lesson.lastPlayed,
          lastPlayedName: lesson.lastPlayed == null ? null : midiName(lesson.lastPlayed),
        }
      : null,
    nextMidi: nextMidi(),
    nextNames: nameList(nextMidi()),
    nextKeys: nextHints(),
    stepCoach: step?.coach ?? (lesson?.lastGrade === "done" ? "Lesson finished. Ask me for another, or hold a chord and say harmonize." : null),
    hint: lesson
      ? lesson.lastGrade === "done"
        ? "Student finished. Offer another lesson or a duet (harmonize / answer / follow)."
        : "Light the next keys with show-next-keys. Demo with demo-next. Do not invent their hands — they must play the glowing keys."
      : "No lesson yet. Call start-lesson. Teaching only works on this live page.",
  };
};

export const startLesson = (id: LessonId): LessonState => {
  const def = LESSONS.find((lesson) => lesson.id === id);
  if (!def) throw new Error(`Unknown lesson ${id}`);
  const lesson = makeRuntime(def.id, def.title, def.coach, def.steps);
  patchState({ lesson, duetMode: "idle" });
  return lesson;
};

export const startDrill = (notes: number[], title = "Your next keys", coach = "Play the glowing keys in order."): LessonState => {
  const cleaned = [...new Set(notes.filter((midi) => midi >= 0 && midi <= 127))];
  const steps = cleaned.map((midi, index) =>
    note(midi, `${coach} Note ${index + 1}: ${keyHint(midi)}.`),
  );
  const lesson = makeRuntime("drill", title, coach, steps.length ? steps : [note(60, "I need notes to teach. Defaulting to middle C.")]);
  patchState({ lesson, duetMode: "idle" });
  return lesson;
};

export const stopLesson = (): void => {
  patchState({ lesson: null });
};

const finishLesson = (lesson: LessonState): void => {
  patchState({
    lesson: {
      ...lesson,
      lastGrade: "done",
      stepIndex: lesson.steps.length,
    },
  });
};

export const gradeHumanNote = (midi: number): void => {
  const lesson = state.lesson;
  const step = currentStep();
  if (!lesson || !step) return;

  if (step.hold) {
    const held = new Set(state.humanHeld);
    const complete = step.midi.every((noteMidi) => held.has(noteMidi));
    const extra = !step.midi.includes(midi);
    if (complete) {
      const hits = lesson.hits + 1;
      const nextIndex = lesson.stepIndex + 1;
      if (nextIndex >= lesson.steps.length) {
        finishLesson({ ...lesson, hits, lastPlayed: midi });
        return;
      }
      patchState({
        lesson: { ...lesson, stepIndex: nextIndex, hits, lastGrade: "hit", lastPlayed: midi },
      });
      return;
    }
    if (extra) {
      patchState({
        lesson: { ...lesson, misses: lesson.misses + 1, lastGrade: "miss", lastPlayed: midi },
      });
    }
    return;
  }

  const want = step.midi[0];
  if (midi === want) {
    const hits = lesson.hits + 1;
    const nextIndex = lesson.stepIndex + 1;
    if (nextIndex >= lesson.steps.length) {
      finishLesson({ ...lesson, hits, lastPlayed: midi });
      return;
    }
    patchState({
      lesson: { ...lesson, stepIndex: nextIndex, hits, lastGrade: "hit", lastPlayed: midi },
    });
    return;
  }

  patchState({
    lesson: { ...lesson, misses: lesson.misses + 1, lastGrade: "miss", lastPlayed: midi },
  });
};
