import { patchState, state } from "../store";
import type {
  BlackGroup,
  Finger,
  Hand,
  LessonId,
  LessonState,
  LessonStep,
  LessonTier,
  LessonTiming,
  PhraseNote,
  TimingGrade,
} from "../types";
import { midiName, nameList } from "./notes";
import { beatSeconds, setDrumLoop, startTransport, stopTransport } from "./transport";
import { midiToComputerKey } from "../ui/keyboard";

type LessonDef = {
  id: LessonId;
  title: string;
  coach: string;
  tier: LessonTier;
  timing: LessonTiming;
  /** Tempo the lesson is graded at. Ignored while `timing` is "free". */
  bpm?: number;
  /**
   * A loop the agent plays underneath the student, for duet lessons. This is the
   * one place the agent is allowed to keep playing during a lesson, so
   * `startLesson` leaves `duetMode` alone when it is set.
   */
  accompaniment?: { notes: PhraseNote[]; loopBeats: number };
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

type FingerMap = Partial<Record<number, Finger>>;

/**
 * Right hand parked on middle C: thumb on C, little finger on G. Finger 5 also
 * covers A, which is the stretch every beginner book uses to reach the top of
 * Twinkle without moving the hand.
 */
const RH_C: FingerMap = { 60: 1, 62: 2, 64: 3, 65: 4, 67: 5, 69: 5, 71: 5, 72: 5 };

/**
 * Right hand parked a fifth lower, thumb on the G below middle C. Happy Birthday
 * starts on that G, and starting a beginner's hand there is what lets the first
 * two lines be played without moving.
 */
const RH_G: FingerMap = { 55: 1, 57: 2, 59: 3, 60: 4, 62: 5 };

/** A melody note as (midi, length in beats). */
type SongNote = [midi: number, beats: number];

/**
 * Lay a melody on the beat grid.
 *
 * Every step carries a `beat` even in an untimed lesson — the timing mode decides
 * whether anything reads it, which keeps one code path for all fifteen lessons.
 * Returns the steps plus the beat the phrase ends on, so phrases chain.
 */
const melody = (
  notes: SongNote[],
  coach: (midi: number, index: number) => string,
  options: { position?: FingerMap; hand?: Hand; startBeat?: number } = {},
): { steps: LessonStep[]; endBeat: number } => {
  const { position = RH_C, hand = "R", startBeat = 0 } = options;
  let beat = startBeat;
  const steps = notes.map(([midi, length], index) => {
    const finger = position[midi];
    const step: LessonStep = {
      midi: [midi],
      coach: coach(midi, index),
      beat,
      ...(finger ? { hands: [hand], fingers: [finger] } : {}),
    };
    beat += length;
    return step;
  });
  return { steps, endBeat: beat };
};

/**
 * A left-hand chord the student holds down before a phrase starts. Fingering is
 * root-position: outside finger on the lowest note, thumb on the highest, which
 * mirrors between the hands. Sliced so `fingers` stays parallel to `midi`.
 */
const chord = (midi: number[], coach: string, beat: number, hand: Hand = "L"): LessonStep => ({
  midi,
  hold: true,
  coach,
  beat,
  hands: midi.map(() => hand),
  fingers: (hand === "L" ? ([5, 3, 1] as Finger[]) : ([1, 3, 5] as Finger[])).slice(0, midi.length),
});

/** A melody note that carries its own fingering, for music outside a five-finger position. */
type FingeredNote = [midi: number, beats: number, finger: Finger];

const fingeredMelody = (
  notes: FingeredNote[],
  coach: (midi: number, index: number) => string,
  options: { hand?: Hand; startBeat?: number } = {},
): { steps: LessonStep[]; endBeat: number } => {
  const { hand = "R", startBeat = 0 } = options;
  let beat = startBeat;
  const steps = notes.map(([midi, length, finger], index) => {
    const step: LessonStep = { midi: [midi], coach: coach(midi, index), beat, hands: [hand], fingers: [finger] };
    beat += length;
    return step;
  });
  return { steps, endBeat: beat };
};

/** A left-hand note held under a phrase, the simplest possible accompaniment. */
const bass = (midi: number, coach: string, beat: number, finger: Finger = 5): LessonStep => ({
  midi: [midi],
  hold: true,
  coach,
  beat,
  hands: ["L"],
  fingers: [finger],
});

/**
 * Chopsticks is played in two-part harmony with one index finger per hand, palms
 * facing, striking downwards — that is where the name comes from.
 */
const chop = (low: number, high: number, coach: string, beat: number): LessonStep => ({
  midi: [low, high],
  hold: true,
  coach,
  beat,
  hands: ["L", "R"],
  fingers: [2, 2],
});

const keyFor = (midi: number): string => midiToComputerKey(midi) ?? midiName(midi);

const press = (midi: number): string => `Press ${keyFor(midi)}.`;

// ── Tier 1 · Basic ───────────────────────────────────────────────────────────

/** E D C, then the "one a penny" run on C and D. The hand never leaves middle C. */
const HOT_CROSS_BUNS = melody(
  [
    [64, 1], [62, 1], [60, 2],
    [64, 1], [62, 1], [60, 2],
    [60, 0.5], [60, 0.5], [60, 0.5], [60, 0.5],
    [62, 0.5], [62, 0.5], [62, 0.5], [62, 0.5],
    [64, 1], [62, 1], [60, 2],
  ],
  (midi, index) => {
    const run = index >= 6 && index < 14;
    const line = run ? "One a penny, two a penny · quick and even" : "Hot cross buns · 3 · 2 · thumb";
    return `${line}. ${press(midi)}`;
  },
).steps;

const MARY_LAMB = melody(
  [
    [64, 1], [62, 1], [60, 1], [62, 1], [64, 1], [64, 1], [64, 2],
    [62, 1], [62, 1], [62, 2], [64, 1], [67, 1], [67, 2],
    [64, 1], [62, 1], [60, 1], [62, 1], [64, 1], [64, 1], [64, 1], [64, 1],
    [62, 1], [62, 1], [64, 1], [62, 1], [60, 4],
  ],
  (midi, index) => {
    const line =
      index < 7 ? "Mary had a little lamb" : index < 13 ? "Little lamb, little lamb" : index < 21 ? "Mary had a little lamb" : "Its fleece was white as snow";
    return `${line} · note ${index + 1}. ${press(midi)}`;
  },
).steps;

const TWINKLE = melody(
  [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  ],
  (midi, index) => {
    const line = index < 7 ? "Twinkle twinkle little star" : "How I wonder what you are";
    return `${line} · note ${index + 1}. ${press(midi)}`;
  },
).steps;

/**
 * Happy Birthday for one hand — the song everybody actually wants to play first.
 *
 * The Tier 2 version is in F, which is where the tune normally lives, but F puts
 * a B flat in the last line and a black key is a poor place for a first song. In
 * C the whole melody is white keys, so this version is the same tune with the
 * left hand and the accidental taken out.
 *
 * It still spans a full octave — the G below middle C up to the G above — which
 * is more than five fingers cover, so it is taught in two positions with a single
 * announced shift rather than pretending it fits under one hand. Lines 1 and 2
 * sit with the thumb on the low G; from "dear" onward the hand moves up so the
 * thumb is on middle C. That is exactly how it is taught on a real piano.
 */
const BIRTHDAY_BASIC = ((): LessonStep[] => {
  const line = (
    notes: SongNote[],
    words: string,
    position: FingerMap,
    startBeat: number,
    from = 1,
  ): { steps: LessonStep[]; endBeat: number } =>
    melody(notes, (midi, index) => `${words} · note ${index + from}. ${press(midi)}`, {
      position,
      startBeat,
    });

  const one = line([[55, 0.5], [55, 0.5], [57, 1], [55, 1], [60, 1], [59, 2]], "Happy birthday to you", RH_G, 0);
  const two = line([[55, 0.5], [55, 0.5], [57, 1], [55, 1], [62, 1], [60, 2]], "Happy birthday to you", RH_G, one.endBeat);
  // The third line straddles the shift: its first two notes are still the low G,
  // then the hand moves up for the rest.
  const threeLow = line([[55, 0.5], [55, 0.5]], "Happy birthday dear friend", RH_G, two.endBeat);
  const threeHigh = line(
    [[67, 1], [64, 1], [60, 1], [62, 1], [60, 2]],
    "Happy birthday dear friend",
    RH_C,
    threeLow.endBeat,
    3,
  );
  const four = line(
    [[65, 0.5], [65, 0.5], [64, 1], [60, 1], [62, 1], [60, 2]],
    "Happy birthday to you",
    RH_C,
    threeHigh.endBeat,
  );

  threeHigh.steps[0].coach =
    "Happy birthday dear friend · note 3. The high one. Move your whole right hand up so your THUMB sits on middle C, then reach this G with finger 5.";
  four.steps[0].coach =
    "Happy birthday to you · note 1. Stay up here where you are now — finger 4 on F.";

  return [...one.steps, ...two.steps, ...threeLow.steps, ...threeHigh.steps, ...four.steps];
})();

// ── Tier 2 · Intermediate ────────────────────────────────────────────────────

/** Beethoven's phrase in the right hand, one held bass note per half. */
const ODE = ((): LessonStep[] => {
  const first = melody(
    [[64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1]],
    (midi, index) => `Ode to Joy · note ${index + 1}. ${press(midi)}`,
    { startBeat: 0 },
  );
  const second = melody(
    [[60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2]],
    (midi, index) => `Ode to Joy · note ${index + 9}. ${press(midi)}`,
    { startBeat: first.endBeat },
  );
  return [
    bass(48, "Left hand first. Little finger on the low C and hold it down — that is the whole bass part for now.", 0),
    ...first.steps,
    // G with the thumb, not the little finger: the left hand stays parked in its
    // C position, exactly where the lh-c-position drill left it.
    bass(55, "Now your left THUMB on G, and hold it. The harmony changes here.", first.endBeat, 1),
    ...second.steps,
  ];
})();

/**
 * Happy Birthday is in F, which is why the top line needs a B flat. The melody
 * spans an octave so the right hand has to shift, and a five-finger map cannot
 * express a shift — so this one is taught by ear and by the glow, with the shift
 * called out in the coach line rather than by a finger badge.
 */
const BIRTHDAY = ((): LessonStep[] => {
  const line = (notes: SongNote[], words: string, startBeat: number): { steps: LessonStep[]; endBeat: number } =>
    melody(notes, (midi, index) => `${words} · note ${index + 1}. ${press(midi)}`, {
      position: {},
      startBeat,
    });

  const one = line([[60, 0.5], [60, 0.5], [62, 1], [60, 1], [65, 1], [64, 2]], "Happy birthday to you", 0);
  const two = line([[60, 0.5], [60, 0.5], [62, 1], [60, 1], [67, 1], [65, 2]], "Happy birthday to you", one.endBeat);
  const three = line(
    [[60, 0.5], [60, 0.5], [72, 1], [69, 1], [65, 1], [67, 1], [65, 2]],
    "Happy birthday dear friend",
    two.endBeat,
  );
  const four = line([[70, 0.5], [70, 0.5], [69, 1], [65, 1], [67, 1], [65, 2]], "Happy birthday to you", three.endBeat);
  // The high C is the shift: the hand cannot reach it from middle C.
  three.steps[2].coach = "Happy birthday dear friend · note 3. This one is high — slide your whole right hand up so your thumb lands on F. Press I.";
  four.steps[0].coach = "Happy birthday to you · note 1. B flat — the black key just left of the top B. Press 7.";
  // Every left-hand voicing is inverted to sit inside C3-B3: the keybed starts at
  // C3, and the right hand owns C4 upwards, so root-position bass chords have
  // nowhere to go. Inversions also mean only one or two fingers move per change.
  return [
    chord([48, 53, 57], "Left hand: hold C, F and A together. Those three are the F chord, and F is home.", 0),
    ...one.steps,
    chord([48, 52, 55], "Left hand: middle finger drops to E, thumb to G. That is the C chord.", one.endBeat),
    ...two.steps,
    chord([48, 53, 57], "Back to the F chord — C, F, A.", two.endBeat),
    ...three.steps,
    chord([50, 53, 58], "Left hand: D, F and B flat. B flat is the black key under your thumb.", three.endBeat),
    ...four.steps,
  ];
})();

/**
 * The C / A minor / F / G loop the agent holds down underneath Heart and Soul.
 * Two beats a chord, eight beats round, in the `PhraseNote` shape the transport
 * and the phrase roll both already speak.
 *
 * Voiced inside C3-B3 so every chord tone has a key to light up green — the
 * keybed starts at C3 — and so the loop never collides with the melody an octave
 * above it. The inversions also keep the movement to one or two notes a change.
 */
const HEART_LOOP: PhraseNote[] = [
  [48, 52, 55],
  [48, 52, 57],
  [48, 53, 57],
  [50, 55, 59],
].flatMap((notes, index) =>
  notes.map((midi) => ({ midi, startBeat: index * 2, durationBeats: 1.9, velocity: 74 })),
);

const HEART_AND_SOUL = ((): LessonStep[] => {
  const first = melody(
    [[64, 1], [64, 1], [64, 1], [62, 1], [60, 1], [62, 1], [64, 2]],
    (midi, index) => `Heart and soul · note ${index + 1}. Stay with my loop. ${press(midi)}`,
  );
  const second = melody(
    [[67, 1], [67, 1], [67, 1], [65, 1], [64, 1], [65, 1], [67, 2]],
    (midi, index) => `Heart and soul · note ${index + 8}. Up to G now. ${press(midi)}`,
    { startBeat: first.endBeat },
  );
  return [...first.steps, ...second.steps];
})();

// ── Tier 3 · Advanced ────────────────────────────────────────────────────────

/**
 * The thumb tuck. Going up, the thumb passes under finger 3 to take F; coming
 * down, finger 3 crosses back over the thumb to take E. It is the single move
 * that separates a five-finger player from a scale player.
 */
const C_SCALE = fingeredMelody(
  [
    [60, 1, 1], [62, 1, 2], [64, 1, 3], [65, 1, 1], [67, 1, 2], [69, 1, 3], [71, 1, 4], [72, 1, 5],
    [71, 1, 4], [69, 1, 3], [67, 1, 2], [65, 1, 1], [64, 1, 3], [62, 1, 2], [60, 2, 1],
  ],
  (midi, index) => {
    if (index === 3) return `The tuck. Bring your THUMB under finger 3 and play F with it. ${press(midi)}`;
    if (index === 12) return `Cross finger 3 back OVER your thumb to reach E. ${press(midi)}`;
    if (index === 7) return `Top C, on finger 5. One octave with five fingers. ${press(midi)}`;
    if (index === 8) return `Now back down. ${press(midi)}`;
    return `C major scale · note ${index + 1}. ${press(midi)}`;
  },
).steps;

const CHOPSTICKS = ((): LessonStep[] => {
  const chops: Array<[low: number, high: number, times: number, coach: string]> = [
    [65, 67, 3, "F and G together — left index on F, right index on G. Chop straight down."],
    [64, 67, 3, "Left index slides down to E. Right stays on G."],
    [62, 71, 3, "Both hands open out: D in the left, B in the right."],
    [64, 69, 1, "One chop on E and A."],
    [62, 71, 1, "Back to D and B."],
    [60, 72, 3, "The big one: middle C in the left, the C an octave up in the right."],
  ];
  let beat = 0;
  const steps: LessonStep[] = [];
  chops.forEach(([low, high, times, coach]) => {
    for (let i = 0; i < times; i += 1) {
      steps.push(chop(low, high, i === 0 ? coach : `Again — ${nameList([low, high])}. Keep the waltz going.`, beat));
      beat += 1;
    }
  });
  return steps;
})();

/**
 * The opening of Für Elise, WoO 59. D sharp is the second black key in a group
 * of two, which is exactly the landmark the very first lesson teaches — so a
 * child arriving here already knows how to find it.
 */
const FUR_ELISE = ((): LessonStep[] => {
  const first = fingeredMelody(
    [
      [76, 0.5, 5], [75, 0.5, 4], [76, 0.5, 5], [75, 0.5, 4], [76, 0.5, 5],
      [71, 0.5, 1], [74, 0.5, 3], [72, 0.5, 2], [69, 2, 1],
    ],
    (midi, index) => {
      if (index === 1) return `D sharp — the black key just left of E. Finger 4. ${press(midi)}`;
      if (index === 5) return `Drop down to B and bring your thumb under. ${press(midi)}`;
      if (index === 8) return `Rest on A. That is the phrase everybody knows. ${press(midi)}`;
      return `Für Elise · note ${index + 1}. ${press(midi)}`;
    },
  );
  const second = fingeredMelody(
    [[60, 0.5, 1], [64, 0.5, 2], [69, 0.5, 4], [71, 2, 5]],
    (midi, index) => `Für Elise · answer · note ${index + 1}. ${press(midi)}`,
    { startBeat: first.endBeat },
  );
  const third = fingeredMelody(
    [[64, 0.5, 1], [68, 0.5, 2], [71, 0.5, 4], [72, 2, 5]],
    (midi, index) =>
      index === 1
        ? `G sharp — the middle black key of a group of three. ${press(midi)}`
        : `Für Elise · answer · note ${index + 5}. ${press(midi)}`,
    { startBeat: second.endBeat },
  );
  return [...first.steps, ...second.steps, ...third.steps];
})();

const LESSONS: LessonDef[] = [
  // ── First steps ─────────────────────────────────────────────────────────────
  // Untiered, and deliberately untimed: nobody can play in rhythm on keys they
  // cannot find yet.
  {
    id: "landmarks",
    title: "Find any C",
    tier: "steps",
    timing: "free",
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
    tier: "steps",
    timing: "free",
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
    tier: "steps",
    timing: "free",
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
    tier: "steps",
    timing: "free",
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
    tier: "steps",
    timing: "free",
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
    id: "c-chord",
    title: "C major chord",
    tier: "steps",
    timing: "free",
    coach: "Build the triad. I show each note, then you hold all three.",
    steps: [
      note(60, "Root: C. Q."),
      note(64, "Third: E. E."),
      note(67, "Fifth: G. T."),
      { midi: [60, 64, 67], hold: true, coach: "Hold C E G together — Q E T. That is C major." },
    ],
  },

  // ── Tier 1 · Basic ──────────────────────────────────────────────────────────
  // Right hand only, parked on middle C, glow on, waits forever.
  {
    id: "hot-cross-buns",
    title: "Hot Cross Buns",
    tier: "basic",
    timing: "free",
    bpm: 84,
    coach: "Three keys, three fingers: E is 3, D is 2, C is your thumb. Your hand never moves.",
    steps: HOT_CROSS_BUNS,
  },
  {
    id: "mary-lamb",
    title: "Mary Had a Little Lamb",
    tier: "basic",
    timing: "free",
    bpm: 88,
    coach: "Same three keys as Hot Cross Buns, plus G under your little finger.",
    steps: MARY_LAMB,
  },
  {
    id: "twinkle",
    title: "Twinkle Twinkle",
    tier: "basic",
    timing: "free",
    bpm: 92,
    coach: "The whole five-finger position, C up to G — and finger 5 stretches to A.",
    steps: TWINKLE,
  },
  {
    id: "birthday-basic",
    title: "Happy Birthday, one hand",
    tier: "basic",
    timing: "free",
    bpm: 92,
    coach: "The birthday song in C, right hand only — every note is a white key. Your hand moves once, and I tell you when.",
    steps: BIRTHDAY_BASIC,
  },

  // ── Tier 2 · Intermediate ───────────────────────────────────────────────────
  // Both hands, metronome running, timing shown but a late note still counts.
  {
    id: "ode",
    title: "Ode to Joy",
    tier: "intermediate",
    timing: "metronome",
    bpm: 84,
    coach: "Beethoven's phrase in your right hand, one bass note per line in your left.",
    steps: ODE,
  },
  {
    id: "birthday",
    title: "Happy Birthday",
    tier: "intermediate",
    timing: "metronome",
    bpm: 96,
    coach: "The whole song in F, with the F, C and B flat chords underneath in your left hand.",
    steps: BIRTHDAY,
  },
  {
    id: "heart-and-soul",
    title: "Heart and Soul",
    tier: "intermediate",
    timing: "metronome",
    bpm: 92,
    // The only lesson where the agent keeps playing while the student plays:
    // startLesson leaves duetMode alone when a lesson has an accompaniment.
    accompaniment: { notes: HEART_LOOP, loopBeats: 8 },
    coach: "A real duet. I hold down the C, A minor, F, G loop. You play the tune on top.",
    steps: HEART_AND_SOUL,
  },

  // ── Tier 3 · Advanced ───────────────────────────────────────────────────────
  // Hand independence at tempo, falling notes, and the glow starts to fade.
  {
    id: "c-scale",
    title: "C major scale",
    tier: "advanced",
    timing: "strict",
    bpm: 76,
    coach: "Eight keys, five fingers. The thumb tucks under finger 3 to reach F.",
    steps: C_SCALE,
  },
  {
    id: "chopsticks",
    title: "Chopsticks",
    tier: "advanced",
    timing: "strict",
    bpm: 108,
    coach: "Two notes at once, one in each hand, chopping. Index finger on each.",
    steps: CHOPSTICKS,
  },
  {
    id: "fur-elise",
    title: "Für Elise",
    tier: "advanced",
    timing: "strict",
    bpm: 72,
    coach: "Your first black keys. D sharp is the second black key of a group of two.",
    steps: FUR_ELISE,
  },
];

/** Lessons in ladder order, which is also the order the tiers appear in the intro. */
const TIER_ORDER: LessonTier[] = ["steps", "basic", "intermediate", "advanced"];

export const TIER_LABELS: Record<LessonTier, string> = {
  steps: "First steps",
  basic: "Basic",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const lessonDef = (id: LessonState["id"]): LessonDef | undefined =>
  LESSONS.find((lesson) => lesson.id === id);

/** Every lesson of one tier, in the order they should be attempted. */
export const lessonsInTier = (tier: LessonTier): LessonId[] =>
  LESSONS.filter((lesson) => lesson.tier === tier).map((lesson) => lesson.id);

export const lessonTitle = (id: LessonState["id"]): string => lessonDef(id)?.title ?? "Next lesson";

/**
 * What to offer after finishing `id`: the next lesson in the same tier, or the
 * first lesson of the next tier. Null at the very top of the ladder.
 *
 * The celebration modal used to walk a hard-coded list of ten recipe phrases, so
 * any new lesson threw the student somewhere arbitrary. This walks the real table.
 */
export const nextLessonAfter = (id: LessonState["id"]): LessonId | null => {
  const def = lessonDef(id);
  if (!def) return "hot-cross-buns";
  const siblings = lessonsInTier(def.tier);
  const atIndex = siblings.indexOf(def.id);
  if (atIndex >= 0 && atIndex < siblings.length - 1) return siblings[atIndex + 1];
  const nextTier = TIER_ORDER[TIER_ORDER.indexOf(def.tier) + 1];
  return nextTier ? (lessonsInTier(nextTier)[0] ?? null) : null;
};

export const listLessons = (): Array<{
  id: string;
  title: string;
  tier: LessonTier;
  timing: LessonTiming;
  steps: number;
  coach: string;
}> =>
  LESSONS.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    tier: lesson.tier,
    timing: lesson.timing,
    steps: lesson.steps.length,
    coach: lesson.coach,
  }));

/**
 * Phrases that pick a lesson.
 *
 * This used to be a hand-ordered if-chain whose own comments warned that a loose
 * key in an early branch would swallow the phrases below it — with fifteen
 * lessons that becomes unmaintainable. Matching is longest-phrase-first instead,
 * so specificity decides rather than line order: "thumb under" reaches the scale
 * even though "thumb" points at the finger-numbers drill, and adding a lesson can
 * no longer break an existing one by being in the wrong place.
 */
const LESSON_KEYWORDS: Array<{ id: LessonId; keys: string[] }> = [
  { id: "landmarks", keys: ["landmarks", "landmark", "black key", "black keys", "group of two", "group of three", "where is c", "find any c", "find a c", "orient"] },
  { id: "first-keys", keys: ["first-keys", "first keys", "first", "c d e", "cde", "beginner"] },
  { id: "rh-c-position", keys: ["rh-c-position", "right hand", "finger number", "finger", "thumb", "hand position", "five finger"] },
  { id: "lh-c-position", keys: ["lh-c-position", "left hand", "left-hand"] },
  { id: "hands-together", keys: ["hands-together", "hands together", "both hands", "two hands", "together"] },
  { id: "c-chord", keys: ["c-chord", "c chord", "chord", "triad"] },
  { id: "hot-cross-buns", keys: ["hot-cross-buns", "hot cross buns", "hot cross", "buns"] },
  { id: "mary-lamb", keys: ["mary-lamb", "mary had a little lamb", "little lamb", "mary", "lamb"] },
  { id: "twinkle", keys: ["twinkle", "star"] },
  {
    id: "birthday-basic",
    // Longer than the plain "happy birthday" below, and KEYWORD_INDEX sorts by
    // length, so these win without disturbing the two-handed version.
    keys: [
      "birthday-basic",
      "happy birthday one hand",
      "happy birthday right hand",
      "happy birthday basic",
      "simple happy birthday",
      "easy happy birthday",
      "birthday one hand",
      "birthday basic",
    ],
  },
  { id: "ode", keys: ["ode to joy", "ode", "joy", "beethoven"] },
  { id: "birthday", keys: ["happy birthday", "birthday", "cumple"] },
  { id: "heart-and-soul", keys: ["heart-and-soul", "heart and soul", "heart & soul", "heart", "soul", "duet"] },
  { id: "c-scale", keys: ["c-scale", "c major scale", "thumb under", "thumb-under", "c scale", "scale"] },
  { id: "chopsticks", keys: ["chopsticks", "chop sticks", "chop waltz"] },
  { id: "fur-elise", keys: ["fur-elise", "für elise", "fur elise", "elise"] },
];

/**
 * Flattened once at module load and sorted so the longest phrase always wins.
 *
 * Every lesson's own title goes in too, which is what makes a title always
 * resolve to its own lesson: "Left hand, five fingers" would otherwise be caught
 * by the shorter "five finger" and start the right-hand drill instead.
 */
const KEYWORD_INDEX: Array<{ key: string; id: LessonId }> = [
  ...LESSONS.map((lesson) => ({ key: lesson.title.toLowerCase(), id: lesson.id })),
  ...LESSON_KEYWORDS.flatMap(({ id, keys }) => keys.map((key) => ({ key, id }))),
].sort((a, b) => b.key.length - a.key.length);

export const resolveLessonId = (raw: string): LessonId | null => {
  const text = raw.trim().toLowerCase();
  const exact = LESSONS.find((lesson) => lesson.id === text);
  if (exact) return exact.id;
  return KEYWORD_INDEX.find((entry) => text.includes(entry.key))?.id ?? null;
};

const makeRuntime = (
  id: LessonState["id"],
  title: string,
  coach: string,
  steps: LessonStep[],
  tier: LessonTier = "steps",
  timing: LessonTiming = "free",
): LessonState => ({
  id,
  title,
  coach,
  tier,
  timing,
  steps,
  stepIndex: 0,
  hits: 0,
  misses: 0,
  lastGrade: "wait",
  lastPlayed: null,
  lastTiming: "none",
  onBeat: 0,
  timedNotes: 0,
  lastHitAt: null,
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

/**
 * Lowest and highest note the running lesson will ever ask for, plus whether it
 * teaches a repeating pattern.
 *
 * The keybed uses this to render only the octaves a lesson actually needs. Three
 * octaves at a finger-width key is ~1350px, which on a phone means five visible
 * keys and a lot of panning; most beginner lessons live inside a single octave,
 * so drawing that octave alone makes every key big and removes panning entirely.
 */
export const lessonSpan = (): { lo: number; hi: number; repeating: boolean } | null => {
  const lesson = state.lesson;
  if (!lesson) return null;
  let lo = Infinity;
  let hi = -Infinity;
  let repeating = false;
  for (const step of lesson.steps) {
    if (step.anyOctave) repeating = true;
    for (const midi of step.midi) {
      if (midi < lo) lo = midi;
      if (midi > hi) hi = midi;
    }
  }
  return Number.isFinite(lo) ? { lo, hi, repeating } : null;
};

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
  const timing = timingLine();
  const beat = timing ? ` · ${timing}` : "";
  if (step.hold) return `HOLD ${target}${finger} · ${keys}${beat}`;
  return `NEXT ${target}${finger} · PRESS ${keys}${beat}`;
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
          tier: lesson.tier,
          timingMode: lesson.timing,
          lastTiming: lesson.lastTiming,
          timingAccuracy: timingAccuracy(),
          bpm: state.bpm,
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
        ? "Student finished. Offer the next lesson in the tier, or a duet (harmonize / answer / follow)."
        : `Light the next keys with show-next-keys. Demo with demo-next. Do not invent their hands — they must play the glowing keys. Finger numbers are DISPLAY ONLY: this page receives note events with no finger information, so never tell the student they used the wrong finger.${
            lesson.timing === "free"
              ? " This lesson is untimed: never mention rhythm or tempo."
              : " Timing is graded against the gap between notes, not position in the piece, and a late note still counts. If lastTiming keeps coming back late, call set-bpm lower and say you are slowing it down."
          }`
      : "No lesson yet. Call start-lesson. Teaching only works on this live page.",
  };
};

export const startLesson = (id: LessonId): LessonState => {
  const def = LESSONS.find((lesson) => lesson.id === id);
  if (!def) throw new Error(`Unknown lesson ${id}`);
  const lesson = makeRuntime(def.id, def.title, def.coach, def.steps, def.tier, def.timing);
  // A duet lesson is the one case where the agent must keep playing while the
  // student plays, so only clear duet mode when the lesson has no accompaniment.
  patchState({
    lesson,
    ...(def.accompaniment ? {} : { duetMode: "idle" as const }),
    ...(def.bpm && def.timing !== "free" ? { bpm: def.bpm } : {}),
  });
  startTransport({ metronome: def.timing !== "free", loop: def.accompaniment ?? null });
  return lesson;
};

/** The looping backing part for a duet lesson, or null for every other lesson. */
export const lessonAccompaniment = (
  id: LessonState["id"],
): { notes: PhraseNote[]; loopBeats: number } | null => lessonDef(id)?.accompaniment ?? null;

/** Tempo a lesson is graded at, falling back to the instrument's current BPM. */
export const lessonBpm = (id: LessonState["id"]): number => lessonDef(id)?.bpm ?? state.bpm;

export const startDrill = (notes: number[], title = "Your next keys", coach = "Play the glowing keys in order."): LessonState => {
  const cleaned = [...new Set(notes.filter((midi) => midi >= 0 && midi <= 127))];
  const steps = cleaned.map((midi, index) =>
    note(midi, `${coach} Note ${index + 1}: ${keyHint(midi)}.`),
  );
  const lesson = makeRuntime("drill", title, coach, steps.length ? steps : [note(60, "I need notes to teach. Defaulting to middle C.")]);
  patchState({ lesson, duetMode: "idle" });
  stopTransport();
  return lesson;
};

/** Two bars. The rest of a generated loop is the same figure again. */
const TEACHABLE_BEATS = 8;

/**
 * Turn the phrase the agent just generated into a lesson the student can play.
 *
 * Only the top line, and only the first two bars. A generated loop is chord
 * stabs on a grid: three voices at 130 BPM is not something a beginner can
 * play, and four bars of it is not something they will finish. The highest note
 * of each stab is the line a listener hums back, so that is the line worth
 * teaching.
 *
 * Untimed on purpose, and the beat stops. Learning where a key is and keeping up
 * with a kick are two different skills, and this is the first one.
 *
 * Keyed by start beat rather than by pitch — unlike `startDrill`, whose `Set`
 * would collapse a riff, and a riff is mostly repeats.
 */
export const startPhraseLesson = (phrase: PhraseNote[], title = "Your riff"): LessonState | null => {
  const topByBeat = new Map<number, number>();
  phrase
    .filter((item) => item.startBeat < TEACHABLE_BEATS && item.midi >= 0 && item.midi <= 127)
    .forEach((item) => {
      const top = topByBeat.get(item.startBeat);
      if (top === undefined || item.midi > top) topByBeat.set(item.startBeat, item.midi);
    });
  const line = [...topByBeat.entries()].sort((a, b) => a[0] - b[0]).map(([, midi]) => midi);
  if (!line.length) return null;

  const coach = "Play the top line of the riff I just made. One key at a time — no rush.";
  const steps = line.map((midi, index) =>
    note(midi, `${coach.split(".")[0]}. Note ${index + 1} of ${line.length}: ${keyHint(midi)}.`),
  );
  const lesson = makeRuntime("drill", title, coach, steps);
  patchState({ lesson, duetMode: "idle", drums: "" });
  setDrumLoop(null);
  return lesson;
};

export const stopLesson = (): void => {
  stopTransport();
  patchState({ lesson: null });
};

const finishLesson = (lesson: LessonState): void => {
  stopTransport();
  patchState({
    lesson: {
      ...lesson,
      lastGrade: "done",
      stepIndex: lesson.steps.length,
    },
  });
};

/**
 * How close a note was to its written length — measured against the *previous*
 * note, not against a position in the piece.
 *
 * A lesson waits indefinitely for the right key, so a child who takes four
 * seconds to find note 1 is not thereby four seconds late for the rest of the
 * song. Grading the gap between consecutive notes measures the thing that is
 * actually being taught: rhythm.
 */
const gradeTiming = (lesson: LessonState, step: LessonStep, now: number): TimingGrade => {
  if (lesson.timing === "free") return "none";
  const previous = lesson.steps[lesson.stepIndex - 1];
  if (!previous || previous.beat === undefined || step.beat === undefined) return "none";
  if (lesson.lastHitAt === null) return "none";
  const expectedMs = (step.beat - previous.beat) * beatSeconds() * 1000;
  if (expectedMs <= 0) return "none";
  const deltaMs = now - lesson.lastHitAt - expectedMs;
  const off = Math.abs(deltaMs);
  if (off < 90) return "perfect";
  if (off < 200) return "good";
  return deltaMs < 0 ? "early" : "late";
};

/**
 * How much help the current step gets.
 *
 * A permanently glowing key is the strongest possible form of the finger-number
 * dependency that method books warn about — you can finish every song in the app
 * without ever learning to read a note. So the help fades by tier: Basic lights
 * the key and badges the finger, Intermediate lights only the note that starts a
 * phrase, and Advanced lights nothing and leaves the note highway to say what is
 * coming.
 *
 * The one thing that never fades is the answer to a wrong note. A child who has
 * just missed gets the key lit again at every tier, because an app that hides the
 * answer from someone who is stuck is not teaching.
 */
export const scaffold = (): { glow: boolean; badges: boolean } => {
  const lesson = state.lesson;
  const step = currentStep();
  if (!lesson || !step) return { glow: true, badges: true };
  if (lesson.lastGrade === "miss") return { glow: true, badges: true };
  // Chords are not guessable from a coach line, so they always light.
  if (step.hold) return { glow: true, badges: true };
  if (lesson.tier === "advanced") return { glow: false, badges: false };
  if (lesson.tier === "intermediate") {
    const phraseStart = lesson.stepIndex === 0 || Boolean(lesson.steps[lesson.stepIndex - 1]?.hold);
    return { glow: phraseStart, badges: phraseStart };
  }
  return { glow: true, badges: true };
};

/** Words for the timing grade, or empty on an untimed lesson. */
export const timingLine = (): string => {
  const lesson = state.lesson;
  if (!lesson || lesson.lastTiming === "none") return "";
  if (lesson.lastTiming === "perfect") return "ON THE BEAT";
  if (lesson.lastTiming === "good") return "CLOSE";
  return lesson.lastTiming === "early" ? "A BIT EARLY" : "A BIT LATE";
};

/** Share of timed notes that landed on or near the beat, or null when untimed. */
export const timingAccuracy = (): number | null => {
  const lesson = state.lesson;
  if (!lesson || lesson.timedNotes === 0) return null;
  return Math.round((lesson.onBeat / lesson.timedNotes) * 100);
};

export const gradeHumanNote = (midi: number): void => {
  const lesson = state.lesson;
  const step = currentStep();
  if (!lesson || !step) return;

  /**
   * A correct note. Timing is recorded but never costs a hit, at any tier: the
   * lesson is teaching rhythm, not punishing a child for being 200ms out.
   */
  const advance = (): void => {
    const now = performance.now();
    const timing = gradeTiming(lesson, step, now);
    const scored = timing !== "none";
    const next: LessonState = {
      ...lesson,
      hits: lesson.hits + 1,
      lastGrade: "hit",
      lastPlayed: midi,
      lastTiming: timing,
      onBeat: lesson.onBeat + (timing === "perfect" || timing === "good" ? 1 : 0),
      timedNotes: lesson.timedNotes + (scored ? 1 : 0),
      lastHitAt: now,
    };
    const nextIndex = lesson.stepIndex + 1;
    if (nextIndex >= lesson.steps.length) {
      finishLesson(next);
      return;
    }
    patchState({ lesson: { ...next, stepIndex: nextIndex } });
  };

  const miss = (): void => {
    patchState({
      lesson: { ...lesson, misses: lesson.misses + 1, lastGrade: "miss", lastPlayed: midi },
    });
  };

  if (step.hold) {
    const held = new Set(state.humanHeld);
    if (step.midi.every((noteMidi) => held.has(noteMidi))) {
      advance();
      return;
    }
    if (!step.midi.includes(midi)) miss();
    return;
  }

  const want = step.midi[0];
  // `anyOctave` steps accept the right letter in any octave — that is the whole
  // point of "find a C anywhere". Every pre-existing step leaves it undefined.
  if (step.anyOctave ? midi % 12 === want % 12 : midi === want) advance();
  else miss();
};
