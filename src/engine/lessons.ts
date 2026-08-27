import { patchState, state } from "../store";
import type { BlackGroup, Finger, Hand, LessonId, LessonState, LessonStep } from "../types";
import { midiName, nameList } from "./notes";
import { midiToComputerKey } from "../ui/keyboard";

type LessonDef = {
  id: LessonId;
  title: string;
  coach: string;
  steps: LessonStep[];
};

const note = (midi: number, coach: string): LessonStep => ({ midi: [midi], coach });

/** A "find it yourself" step: any octave counts, and the black-key group is lit as the clue. */
const find = (midi: number, landmark: BlackGroup, coach: string): LessonStep => ({
  midi: [midi],
  coach,
  landmark,
  anyOctave: true,
});

/** A single-note step that also prescribes a hand and finger. */
const play = (midi: number, hand: Hand, finger: Finger, coach: string): LessonStep => ({
  midi: [midi],
  coach,
  hands: [hand],
  fingers: [finger],
});

const LESSONS: LessonDef[] = [
  {
    id: "landmarks",
    title: "Find any C",
    coach: "The black keys are your map. They come in groups of 2 and groups of 3.",
    steps: [
      find(60, "two", "Look at the black keys. See the groups of TWO? C is the white key just to the LEFT of a group of two. Press any C."),
      find(62, "two", "D hides BETWEEN the two black keys. Press any D."),
      find(64, "two", "E is just to the RIGHT of the two black keys. Press any E."),
      find(65, "three", "Now the groups of THREE. F is just to the LEFT of a group of three. Press any F."),
      find(67, "three", "G is between the 1st and 2nd black key. Press any G."),
      find(69, "three", "A is between the 2nd and 3rd black key. Press any A."),
      find(71, "three", "B is just to the RIGHT of the three black keys. Press any B."),
      find(60, "two", "Last one. Find a C anywhere on the piano — left of any group of two."),
    ],
  },
  {
    id: "first-keys",
    title: "Play C D E",
    coach: "You can find C now. Play the first three white keys in a row.",
    steps: [
      note(60, "This is middle C — the C nearest the middle of the piano. Press Q, or click the glowing key."),
      note(62, "D, right next door. Press W."),
      note(64, "E, one more white key to the right. Press E."),
      { midi: [60, 64], hold: true, coach: "Now hold C and E together — Q and E at the same time." },
    ],
  },
  {
    id: "rh-c-position",
    title: "Right hand, five fingers",
    coach: "Your thumb is finger 1. Then 2, 3, 4, and your little finger is 5.",
    steps: [
      play(60, "R", 1, "Right hand. Put your THUMB on middle C. Your thumb is finger 1."),
      play(62, "R", 2, "Finger 2 on D. Keep your thumb resting on C."),
      play(64, "R", 3, "Finger 3 — your longest finger — on E."),
      play(65, "R", 4, "Finger 4 on F."),
      play(67, "R", 5, "Finger 5, your little finger, on G. All five fingers have a key now."),
      play(65, "R", 4, "Now walk back down. Finger 4 on F."),
      play(64, "R", 3, "Finger 3 on E."),
      play(62, "R", 2, "Finger 2 on D."),
      play(60, "R", 1, "Thumb back on C. You played all five, up and down."),
      {
        midi: [60, 64, 67],
        hold: true,
        hands: ["R", "R", "R"],
        fingers: [1, 3, 5],
        coach: "Last one. Press C, E and G together with fingers 1, 3 and 5.",
      },
    ],
  },
  {
    id: "lh-c-position",
    title: "Left hand, five fingers",
    coach: "Same five fingers, other hand. In your left hand the thumb points to the right.",
    steps: [
      play(48, "L", 5, "Left hand now, lower down. Put your LITTLE finger — finger 5 — on this C."),
      play(50, "L", 4, "Finger 4 on D."),
      play(52, "L", 3, "Finger 3 on E."),
      play(53, "L", 2, "Finger 2 on F."),
      play(55, "L", 1, "Thumb on G. In your left hand the thumb is on the RIGHT side."),
      play(53, "L", 2, "Back down. Finger 2 on F."),
      play(52, "L", 3, "Finger 3 on E."),
      play(50, "L", 4, "Finger 4 on D."),
      play(48, "L", 5, "Little finger back on C. Both hands know their five keys now."),
      {
        midi: [48, 52, 55],
        hold: true,
        hands: ["L", "L", "L"],
        fingers: [5, 3, 1],
        coach: "Hold C, E and G with fingers 5, 3 and 1.",
      },
    ],
  },
  {
    id: "hands-together",
    title: "Both hands",
    coach: "Left hand low, right hand high. Same letters, one octave apart.",
    steps: [
      {
        midi: [48, 60],
        hold: true,
        hands: ["L", "R"],
        fingers: [5, 1],
        coach: "Both hands. Left little finger on the low C, right thumb on middle C. Press them together.",
      },
      {
        midi: [52, 64],
        hold: true,
        hands: ["L", "R"],
        fingers: [3, 3],
        coach: "Both finger 3 now, on both E keys.",
      },
      {
        midi: [55, 67],
        hold: true,
        hands: ["L", "R"],
        fingers: [1, 5],
        coach: "Left thumb and right little finger, both on G.",
      },
      {
        midi: [48, 60],
        hold: true,
        hands: ["L", "R"],
        fingers: [5, 1],
        coach: "Home to C. That is both hands together — your first real piano position.",
      },
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
  {
    id: "birthday",
    title: "Happy Birthday",
    coach: "The whole song, one glowing key at a time. I hear you on this piano.",
    steps: [
      60, 60, 62, 60, 65, 64, 60, 60, 62, 60, 67, 65, 60, 60, 72, 69, 65, 64, 62, 70, 70, 69, 65, 67, 65,
    ].map((midi, index) => {
      const line =
        index < 6
          ? "Happy birthday to you"
          : index < 12
            ? "Happy birthday to you"
            : index < 19
              ? "Happy birthday dear friend"
              : "Happy birthday to you";
      return note(midi, `${line} · note ${index + 1}. Press ${midiToComputerKey(midi) ?? midiName(midi)}.`);
    }),
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
  // Order matters: these must sit above the older branches, whose loose keys
  // ("find", "chord", "first") would otherwise swallow the phrases below.
  if (["hands-together", "both hands", "two hands", "together"].some((key) => text.includes(key))) return "hands-together";
  if (["lh-c-position", "left hand", "left-hand"].some((key) => text.includes(key))) return "lh-c-position";
  if (["rh-c-position", "right hand", "finger", "thumb", "hand position", "five finger"].some((key) => text.includes(key)))
    return "rh-c-position";
  // Deliberately no "find c" key here — the first-keys branch below owns the
  // substring "find", and "find c d e" must still reach it.
  if (["landmarks", "landmark", "black key", "black keys", "group of two", "group of three", "where is c", "orient"].some((key) => text.includes(key)))
    return "landmarks";
  if (["first-keys", "first", "beginner", "cde", "find"].some((key) => text.includes(key))) return "first-keys";
  if (["c-scale", "scale", "c major scale"].some((key) => text.includes(key))) return "c-scale";
  if (["c-chord", "chord", "triad"].some((key) => text.includes(key))) return "c-chord";
  if (["twinkle", "star"].some((key) => text.includes(key))) return "twinkle";
  if (["ode", "joy", "beethoven"].some((key) => text.includes(key))) return "ode";
  if (["birthday", "happy birthday", "cumple"].some((key) => text.includes(key))) return "birthday";
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

export const nextFingers = (): Finger[] => currentStep()?.fingers ?? [];

export const nextHands = (): Hand[] => currentStep()?.hands ?? [];

export const nextLandmark = (): BlackGroup | null => currentStep()?.landmark ?? null;

/** Pitch classes of the black-key group being pointed at, or [] when none. */
export const landmarkPitchClasses = (): number[] => {
  const group = nextLandmark();
  if (group === "two") return [1, 3];
  if (group === "three") return [6, 8, 10];
  return [];
};

/** Should this key glow as "play me"? Honours `anyOctave`, so every C lights up. */
export const isNextTarget = (midi: number): boolean => {
  const step = currentStep();
  if (!step) return false;
  return step.anyOctave
    ? step.midi.some((want) => want % 12 === midi % 12)
    : step.midi.includes(midi);
};

/** Badge text for a key in the current step: "3", or "L5" when both hands are in play. */
export const fingerBadge = (midi: number): string => {
  const step = currentStep();
  if (!step?.fingers?.length) return "";
  const index = step.midi.indexOf(midi);
  const finger = index < 0 ? undefined : step.fingers[index];
  if (finger === undefined) return "";
  const hands = step.hands ?? [];
  return new Set(hands).size > 1 ? `${hands[index] ?? ""}${finger}` : String(finger);
};

/** "RH 1" for one hand, "L5 R1" when a step uses both. Empty when a step has no fingering. */
export const fingerLine = (): string => {
  const step = currentStep();
  if (!step?.fingers?.length) return "";
  const hands = step.hands ?? [];
  const bothHands = new Set(hands).size > 1;
  if (bothHands) {
    return step.fingers.map((finger, index) => `${hands[index] ?? ""}${finger}`).join(" ");
  }
  const hand = hands[0] ? `${hands[0]}H ` : "";
  return `${hand}${step.fingers.join(" ")}`;
};

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
  const fingers = fingerLine();
  const finger = fingers ? ` · ${fingers}` : "";
  if (step.landmark) {
    const group = step.landmark === "two" ? "GROUP OF 2" : "GROUP OF 3";
    return `FIND ${target} · ANY OCTAVE · ${group}`;
  }
  if (step.hold) return `HOLD ${target}${finger} · ${keys}`;
  return `NEXT ${target}${finger} · PRESS ${keys}`;
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
    nextFingers: nextFingers(),
    nextHands: nextHands(),
    fingering: fingerLine() || null,
    landmark: nextLandmark(),
    anyOctave: Boolean(step?.anyOctave),
    stepCoach: step?.coach ?? (lesson?.lastGrade === "done" ? "Lesson finished. Ask me for another, or hold a chord and say harmonize." : null),
    hint: lesson
      ? lesson.lastGrade === "done"
        ? "Student finished. Offer another lesson or a duet (harmonize / answer / follow)."
        : "Light the next keys with show-next-keys. Demo with demo-next. Do not invent their hands — they must play the glowing keys. Finger numbers are DISPLAY ONLY: this page receives note events with no finger information, so never tell the student they used the wrong finger."
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
  // `anyOctave` steps accept the right letter in any octave — that is the whole
  // point of "find a C anywhere". Every pre-existing step leaves it undefined.
  if (step.anyOctave ? midi % 12 === want % 12 : midi === want) {
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
