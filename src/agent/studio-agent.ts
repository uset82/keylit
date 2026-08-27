import { playPhrase } from "../engine/audio";
import { generatePhrase, styleBpm } from "../engine/generate";
import { drumLoop, isDrumPattern } from "../engine/drums";
import { setDrumLoop } from "../engine/transport";
import { applySoundPatch, type SoundPatch } from "../engine/patch";
import { patchState, setPhrase, state } from "../store";
import type { PhraseStyle } from "../types";
import { runTool } from "../webmcp/adapter";
import { designViaLlm } from "./llm";
import { generateInstrumental, showGeneratedInstrumental } from "./music";
import { looksLikeSoundWords, patchFromWords } from "./sound-words";

export type AgentMessage = {
  role: "user" | "agent";
  text: string;
};

type Recipe = {
  match: RegExp;
  steps: Array<{ tool: string; input?: Record<string, unknown> }>;
  say: string;
};

const RECIPES: Recipe[] = [
  // Mode is the most global thing the agent can change, and "teaching mode" would
  // otherwise be eaten by the /teach|learn|lesson/ catch-all further down, so both
  // mode recipes sit at the very top of the table.
  {
    match: /dj mode|producer mode|make (me )?(a )?(track|beat)|i want to (dj|make music)|let me dj/,
    steps: [{ tool: "set-mode", input: { mode: "dj" } }],
    say: "DJ mode. Lessons out of the way, decks open.",
  },
  {
    match: /teach(ing)? mode|lesson mode|learn mode|back to (lessons?|teaching|learning)/,
    steps: [{ tool: "set-mode", input: { mode: "teach" } }],
    say: "Teaching mode. Pick a lesson and I will light the first key.",
  },
  {
    match: /stop (the )?lesson|stop teach|end lesson/,
    steps: [{ tool: "stop-lesson" }],
    say: "Lesson off. The keys are yours.",
  },
  {
    // The crush/warm recipes below had no way home. Kept narrow so "reset the lesson"
    // still belongs to the lesson controls above.
    match: /put it back|back to normal|sounds? (bad|weird|broken)|factory|reset( the)? (sound|effects|fx|knobs)|^reset$|undo the/,
    steps: [{ tool: "reset-sound" }],
    say: "Putting the sound back to normal.",
  },
  // Above the lesson recipes: "slow down Twinkle" is a tempo request, not a
  // request to restart Twinkle from the top.
  {
    match: /slow(er| it| this| that| down)|half speed|too fast/,
    steps: [{ tool: "set-bpm", input: { scale: 0.7 } }],
    say: "Slowing it down. Play it right first — speed comes free after that.",
  },
  {
    match: /faster|speed (it|this|that)? ?up|quicker|too slow/,
    steps: [{ tool: "set-bpm", input: { scale: 1.3 } }],
    say: "Faster.",
  },
  {
    match: /show next|what next|next keys|hint|which key/,
    steps: [{ tool: "show-next-keys" }],
    say: "I lit the next keys on this piano.",
  },
  {
    match: /hear it|demo|play it (for me|first)|show me how/,
    steps: [{ tool: "demo-next" }],
    say: "I play it once. Then you copy the glowing keys.",
  },
  {
    // Above the plain /birthday/ below, which would otherwise swallow every one
    // of these and start the two-handed version instead.
    match: /(one|right) hand.*birthday|birthday.*(one|right) hand|(simple|easy|basic) (happy )?birthday|(happy )?birthday (basic|simple|easy)/,
    steps: [{ tool: "start-lesson", input: { lesson: "birthday-basic" } }],
    say: "Happy Birthday, one hand and all white keys. I light the next note, you play it.",
  },
  {
    match: /birthday|cumple/,
    steps: [{ tool: "start-lesson", input: { lesson: "birthday" } }],
    say: "Happy Birthday. I light the next note. You play it.",
  },
  {
    match: /twinkle|star/,
    steps: [{ tool: "start-lesson", input: { lesson: "twinkle" } }],
    say: "Twinkle Twinkle — I light each note. You play it.",
  },
  {
    match: /ode|joy|beethoven/,
    steps: [{ tool: "start-lesson", input: { lesson: "ode" } }],
    say: "Ode to Joy. Copy the glowing keys.",
  },
  {
    match: /c[- ]?scale|major scale|teach.*scale/,
    steps: [{ tool: "start-lesson", input: { lesson: "c-scale" } }],
    say: "C major scale. One glowing key at a time.",
  },
  {
    match: /c[- ]?chord|teach.*chord|triad/,
    steps: [{ tool: "start-lesson", input: { lesson: "c-chord" } }],
    say: "C major chord. I show C, E, G, then you hold all three.",
  },
  // These four sit above the greedy /teach|learn|lesson/ recipe below — that one
  // matches almost every beginner phrasing and would otherwise swallow them.
  {
    match: /both hands|two hands|hands together/,
    steps: [{ tool: "start-lesson", input: { lesson: "hands-together" } }],
    say: "Both hands. Left hand low, right hand high, same letters.",
  },
  {
    match: /left hand|lh /,
    steps: [{ tool: "start-lesson", input: { lesson: "lh-c-position" } }],
    say: "Left hand. Little finger is 5, and your thumb points to the right.",
  },
  {
    match: /finger|thumb|hand position|five finger|which hand/,
    steps: [{ tool: "start-lesson", input: { lesson: "rh-c-position" } }],
    say: "Finger numbers. Thumb is 1, little finger is 5. I light the finger and the key.",
  },
  {
    match: /find (a |any )?c|where is c|black keys?|group of (two|three|2|3)|landmark|find the notes?/,
    steps: [{ tool: "start-lesson", input: { lesson: "landmarks" } }],
    say: "The black keys are your map. Groups of 2 and groups of 3. C is left of a group of 2.",
  },
  {
    match: /play c d e|c d e|first keys?/,
    steps: [{ tool: "start-lesson", input: { lesson: "first-keys" } }],
    say: "C, D, E — three white keys in a row.",
  },
  // The tiered repertoire. All six sit above the /teach|learn|lesson/ catch-all,
  // and "heart and soul" also has to clear the later /hear|listen|duet/ recipe —
  // "heart" contains "hear", and that entry matches "duet" outright.
  {
    match: /hot cross|buns/,
    steps: [{ tool: "start-lesson", input: { lesson: "hot-cross-buns" } }],
    say: "Hot Cross Buns. Three keys, three fingers — everyone starts here.",
  },
  {
    match: /mary|little lamb|lamb/,
    steps: [{ tool: "start-lesson", input: { lesson: "mary-lamb" } }],
    say: "Mary Had a Little Lamb. Same three keys, plus G under your little finger.",
  },
  {
    match: /heart and soul|heart & soul|heart|four hands/,
    steps: [{ tool: "start-lesson", input: { lesson: "heart-and-soul" } }],
    say: "Heart and Soul — a real duet. I hold the loop, you play the tune.",
  },
  {
    match: /chopsticks|chop sticks|chop waltz/,
    steps: [{ tool: "start-lesson", input: { lesson: "chopsticks" } }],
    say: "Chopsticks. One index finger in each hand, chopping straight down.",
  },
  {
    match: /f[uü]r elise|elise/,
    steps: [{ tool: "start-lesson", input: { lesson: "fur-elise" } }],
    say: "Für Elise. Your first black keys — D sharp sits just left of E.",
  },
  {
    // Above the catch-all below, which owns the bare word "teach" and would
    // otherwise answer "teach me this riff" with the find-a-C lesson.
    match: /(teach|learn|play).{0,12}(this|that|it|the (riff|loop|phrase|beat|groove))|teach me (this|that|it)/,
    steps: [{ tool: "teach-phrase" }],
    say: "Here is the top line of that riff, one key at a time.",
  },
  {
    match: /teach|learn|lesson|beginner|how (do i|to) play/,
    steps: [{ tool: "start-lesson", input: { lesson: "landmarks" } }],
    say: "Start here. Nobody can play a note they cannot find — so first I teach you to find C.",
  },
  {
    match: /hear|listen|what.?s on|status|duet|lesson state/,
    steps: [{ tool: "get-lesson-state" }, { tool: "get-duet-state" }],
    say: "I am listening on this page — not a separate chat.",
  },
  {
    match: /(drums?|beat|groove) (off|stop)|stop (the )?(drums?|beat)|no drums?/,
    steps: [{ tool: "set-drums", input: { pattern: "" } }],
    say: "Drums off.",
  },
  {
    match: /(house).{0,14}(beat|drums?|groove)|(beat|drums?|groove).{0,14}(house)/,
    steps: [{ tool: "set-drums", input: { pattern: "house" } }],
    say: "Four on the floor, open hat on the off-beat.",
  },
  {
    match: /(techno).{0,14}(beat|drums?|groove)|(beat|drums?|groove).{0,14}(techno)/,
    steps: [{ tool: "set-drums", input: { pattern: "techno" } }],
    say: "Techno: same kick, tighter top, no clap.",
  },
  {
    match: /(garage|two[- ]step).{0,14}(beat|drums?|groove)|(beat|drums?|groove).{0,14}(garage|two[- ]step)/,
    steps: [{ tool: "set-drums", input: { pattern: "garage" } }],
    say: "Garage two-step, shuffled kick and skipping hat.",
  },
  {
    match: /(backbeat|rock|basic|simple|plain).{0,14}(beat|drums?|groove)|(beat|drums?|groove).{0,14}(backbeat|rock|basic|simple|plain)/,
    steps: [{ tool: "set-drums", input: { pattern: "backbeat" } }],
    say: "Backbeat: kick on 1 and 3, snare on 2 and 4.",
  },
  {
    match: /(drums?|a beat|some beat|give me a beat)/,
    steps: [{ tool: "set-drums", input: { pattern: "backbeat" } }],
    say: "A backbeat. Ask for house, techno or garage to change it.",
  },
  {
    match: /harmon|color|seventh|add notes/,
    steps: [{ tool: "harmonize-held" }],
    say: "I only add notes if you are holding a chord on these keys.",
  },
  {
    match: /answer|respond|call and|your turn/,
    steps: [{ tool: "answer-human" }],
    say: "Answering the line you just played.",
  },
  {
    match: /follow|shadow|octave|8va/,
    steps: [{ tool: "follow-human" }],
    say: "I will shadow you on the same keyboard.",
  },
  {
    match: /arrange|my take|what i played|to the roll/,
    steps: [{ tool: "arrange-human-take" }],
    say: "Writing your hands onto the roll.",
  },
  {
    match: /state/,
    steps: [{ tool: "get-instrument-state" }],
    say: "Here is the live instrument.",
  },
  {
    match: /c minor|rave/,
    steps: [
      { tool: "set-layer", input: { layer: "A", sampleId: "sy-rail", volume: 0.86, transpose: 0 } },
      { tool: "set-layer", input: { layer: "B", sampleId: "or-reed", volume: 0.28, transpose: 12 } },
      // A stab has to stop before the next one lands. The factory release runs
      // 550ms, which at these tempos smears four hits a bar into one chord.
      { tool: "set-adsr", input: { attack: 0.001, decay: 0.2, sustain: 0.24, release: 0.16 } },
      { tool: "set-fx", input: { filter: 0.68, distortion: 0.14, crush: 0.14, delay: 0.18, reverb: 0.18 } },
      { tool: "generate-phrase", input: { style: "rave", bars: 4 } },
    ],
    say: "C-minor rave stab on the CP80, i-VII-VI.",
  },
  {
    match: /house/,
    steps: [
      { tool: "set-layer", input: { layer: "A", sampleId: "sy-rail", volume: 0.84, transpose: 0 } },
      { tool: "set-layer", input: { layer: "B", volume: 0 } },
      { tool: "set-adsr", input: { attack: 0.002, decay: 0.24, sustain: 0.3, release: 0.2 } },
      { tool: "set-fx", input: { filter: 0.8, distortion: 0.06, crush: 0.08, delay: 0.14, reverb: 0.18 } },
      { tool: "generate-phrase", input: { style: "house", bars: 4 } },
      // Last, so the kit inherits the tempo generate-phrase just set and starts
      // against a context the steps above have already armed.
      { tool: "set-drums", input: { pattern: "house" } },
    ],
    say: "F-major house comp, I-vi-IV-V, over four on the floor.",
  },
  {
    // Was the harshest preset in the app: crush 0.34 with distortion 0.2, which
    // makeCurve turns into a k=8 clip, over a phrase whose bars overlapped each
    // other. The pile-up is gone, and these are the levels the stab needs.
    match: /techno/,
    steps: [
      { tool: "set-layer", input: { layer: "A", sampleId: "sy-rail", volume: 0.82, transpose: 0 } },
      { tool: "set-layer", input: { layer: "B", volume: 0 } },
      { tool: "set-adsr", input: { attack: 0.001, decay: 0.14, sustain: 0.18, release: 0.12 } },
      { tool: "set-fx", input: { filter: 0.7, distortion: 0.08, crush: 0.12, delay: 0.12, reverb: 0.1 } },
      { tool: "generate-phrase", input: { style: "techno", bars: 4 } },
      { tool: "set-drums", input: { pattern: "techno" } },
    ],
    say: "A-minor techno: offbeat stabs over the kick.",
  },
  {
    match: /steinway|ballad|roland/,
    steps: [
      { tool: "set-layer", input: { layer: "A", sampleId: "pn-ivory", volume: 0.9, transpose: 0 } },
      { tool: "set-layer", input: { layer: "B", sampleId: "ok-bloom", volume: 0, transpose: 0 } },
      { tool: "set-adsr", input: { attack: 0.002, decay: 0.42, sustain: 0.72, release: 0.55 } },
      { tool: "set-fx", input: { filter: 0.92, distortion: 0, crush: 0, delay: 0.05, reverb: 0.16 } },
    ],
    say: "Steinway on the shared keys. Hold a chord and say harmonize.",
  },
  {
    match: /yamaha|cp80|electric grand/,
    steps: [
      { tool: "set-layer", input: { layer: "A", sampleId: "sy-rail", volume: 0.88, transpose: 0 } },
      { tool: "set-layer", input: { layer: "B", sampleId: "pn-ivory", volume: 0.22, transpose: 0 } },
      { tool: "set-fx", input: { filter: 0.86, distortion: 0.04, crush: 0, delay: 0.08, reverb: 0.2 } },
    ],
    say: "Yamaha CP80. Play — I can follow or answer.",
  },
  {
    match: /wurlitzer|wurli|rhodes|akai/,
    steps: [
      { tool: "set-layer", input: { layer: "A", sampleId: "sy-razor", volume: 0.88, transpose: 0 } },
      { tool: "set-layer", input: { layer: "B", sampleId: "ok-bloom", volume: 0.12, transpose: 0 } },
      { tool: "set-fx", input: { filter: 0.78, distortion: 0.08, crush: 0, delay: 0.1, reverb: 0.18 } },
    ],
    say: "Wurlitzer EP200 on the shared rack.",
  },
  {
    match: /crush|destroy|grit/,
    steps: [{ tool: "set-fx", input: { crush: 0.55, distortion: 0.4, filter: 0.4 } }],
    say: "Crushed the chain. You can still roll it back.",
  },
  {
    match: /warm|plate|reverb/,
    steps: [{ tool: "set-fx", input: { reverb: 0.48, delay: 0.22, crush: 0.06, distortion: 0.1 } }],
    say: "More plate, less dirt.",
  },
  {
    match: /play (a )?c major|play chord/,
    steps: [{ tool: "play-notes", input: { notes: [60, 64, 67, 72], velocity: 104, durationMs: 900 } }],
    say: "C major from me. Hold yours and ask me to harmonize.",
  },
  {
    // Needs an export verb rather than the bare word "midi", which used to make
    // this recipe swallow "write me a midi riff" and download a stale phrase
    // instead of composing anything.
    match: /\b(export|download|save)\b/,
    steps: [{ tool: "export-midi" }],
    say: "MIDI download started if a phrase exists.",
  },
  {
    match: /lock a|lock layer a/,
    steps: [{ tool: "lock-layer", input: { layer: "A", locked: true } }],
    say: "Layer A is locked.",
  },
  {
    match: /save/,
    steps: [{ tool: "save-preset", input: { name: "STUDIO TAKE" } }],
    say: "Preset saved in this browser.",
  },
];

const humanizeToolText = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(trimmed) as {
      content?: Array<{ text?: string }>;
      line?: string;
      stepCoach?: string | null;
      nextNames?: string;
      nextKeys?: string[];
      hint?: string;
      teaching?: boolean;
    };
    if (Array.isArray(parsed.content)) {
      return humanizeToolText(parsed.content.map((item) => item.text ?? "").join("\n"));
    }
    if (parsed.line || parsed.stepCoach || parsed.teaching === false) {
      return [parsed.line, parsed.stepCoach, parsed.nextNames && parsed.nextNames !== "—" ? `Next: ${parsed.nextNames}` : "", parsed.hint]
        .filter((part) => Boolean(part))
        .join("\n");
    }
  } catch {
    /* keep raw */
  }
  return raw;
};

const formatResult = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return humanizeToolText(value);
  if (typeof value === "object" && value !== null && "content" in value) {
    const content = (value as { content?: Array<{ text?: string }> }).content;
    return humanizeToolText(content?.map((item) => item.text ?? "").join("\n") ?? JSON.stringify(value));
  }
  return humanizeToolText(JSON.stringify(value));
};

const runStep = async (tool: string, input: Record<string, unknown> = {}): Promise<string> => {
  // No local fallback here: runTool already prefers this page's own implementation, and
  // retrying a tool that threw halfway would run its side effects twice.
  const result = await runTool(tool, input);
  return formatResult(result);
};

/**
 * Start a lesson by its id, skipping phrase matching entirely.
 *
 * The celebration modal's "Next Lesson" button used to guess at a phrase and hope
 * a recipe caught it, which broke as soon as a lesson title stopped resembling
 * its trigger words ("C major chord" matches no recipe at all).
 */
export const runLessonTurn = async (id: string): Promise<string> => {
  try {
    return await runStep("start-lesson", { lesson: id });
  } catch (error) {
    return `Could not start that lesson: ${error instanceof Error ? error.message : "error"}`;
  }
};

/** Nouns that can only mean "make me something rhythmic" when typed at a piano. */
const RHYTHM_WORDS = /\b(beats?|drums?|drumbeat|groove|rhythm|percussion|pattern)\b/;

/** Weaker nouns, which need a verb alongside them to read as a request. */
const PHRASE_WORDS = /\b(midi|notes?|melody|riff|arpeggio|bass ?line|chord progression|loop|phrase|hook|lick|tune)\b/;

const CREATION_WORDS = /\b(create|generate|compose|write|make|build|custom|invent|arrange|cook up|lay down)\b/;

const wantsCustomMidi = (prompt: string): boolean => {
  const lower = prompt.toLowerCase();
  if (/\b(export|download|save)\b/.test(lower)) return false;
  // A rhythm noun carries its own intent, so it does not also need a verb.
  // Demanding both is what sent "drum pattern", "give me a groove" and
  // "generate some drum beats" to the generic hint: none of those three
  // contains a word this used to recognise as musical at all.
  if (RHYTHM_WORDS.test(lower)) return true;
  // The weaker list still needs one, or "what notes do I play" — a question
  // about the lesson in progress — would answer itself with a new jam.
  return PHRASE_WORDS.test(lower) && CREATION_WORDS.test(lower);
};

const wantsInstrumentalTrack = (prompt: string): boolean =>
  /\b(instrumental|soundtrack|background music|music bed|ai music|minimax)\b/i.test(prompt) && !wantsCustomMidi(prompt);

const styleFor = (prompt: string): PhraseStyle => {
  const lower = prompt.toLowerCase();
  if (/\bhouse\b|\bdisco\b/.test(lower)) return "house";
  if (/\btechno\b|\bindustrial\b/.test(lower)) return "techno";
  if (/\brave\b|\btrance\b|\bhardcore\b/.test(lower)) return "rave";
  if (/\bgarage\b|\b2[- ]?step\b|\bhip ?hop\b|\btrap\b|\bdnb\b|\bjungle\b|\bbreak/.test(lower)) return "garage";
  // Never answer a beat request with the piano voicings: they are sustained
  // sevenths on every downbeat, which is a phrase but audibly not a groove.
  return RHYTHM_WORDS.test(lower) ? "house" : "piano";
};

const barsFor = (prompt: string): 4 | 8 => (/\b8[ -]?bar|eight[ -]?bar\b/i.test(prompt) ? 8 : 4);

const applyGeneratedPhrase = (notes: typeof state.phrase, bars: 4 | 8, bpm?: number): void => {
  patchState({ bars, ...(bpm ? { bpm } : {}) });
  setPhrase(notes);
  playPhrase(notes);
};

/**
 * Short, dry and bright, for when the ask was rhythmic.
 *
 * The melodic half of a rhythmic ask. There IS a drum kit now — synthesised in
 * engine/drums — so this patch is the chord stabs that sit on top of it, not a
 * substitute for it. On the factory Steinway, whose release runs half a second,
 * four stabs to the bar overlap into one sustained chord, so each hit has to
 * stop before the next one lands.
 */
const BEAT_PATCH: SoundPatch = {
  presetName: "BEAT STABS",
  layerA: { sampleId: "sy-rail", volume: 0.9 },
  layerB: { volume: 0 },
  adsr: { attack: 0.001, decay: 0.18, sustain: 0.25, release: 0.16 },
  fx: { filter: 0.82, distortion: 0.12, crush: 0.18, delay: 0.08, reverb: 0.1 },
};

const fallbackMidi = async (prompt: string): Promise<string> => {
  const style = styleFor(prompt);
  const bars = barsFor(prompt);
  const rhythmic = RHYTHM_WORDS.test(prompt.toLowerCase());
  if (rhythmic) await applySoundPatch(BEAT_PATCH);
  const phrase = generatePhrase(style, bars);
  // BEAT_PATCH already named the preset; leave it rather than overwrite it.
  patchState({
    style,
    bars,
    bpm: styleBpm(style),
    ...(rhythmic ? {} : { presetName: `${style.toUpperCase()} CUSTOM` }),
  });
  if (rhythmic) {
    // A real kit under the stabs. The style names already line up with the
    // pattern ids, and backbeat covers anything that has no groove of its own.
    // Started after the tempo lands, or the kit loops at the previous BPM.
    const pattern = isDrumPattern(style) ? style : "backbeat";
    patchState({ drums: pattern });
    setDrumLoop(drumLoop(pattern));
  }
  setPhrase(phrase);
  playPhrase(phrase);
  // Say plainly that these are not drums. A child who was promised a beat and
  // hears a piano will decide the app is broken; one who is told it is a piano
  // playing a groove hears exactly what was described.
  return rhythmic
    ? `A ${style} beat is looping, with a ${bars}-bar stab riff over it. Play along, ask again for a new riff, or Export MIDI to keep it. Say "drums off" to stop the beat.`
    : `I put a ${bars}-bar ${style} MIDI phrase on the roll. Play it, then use Export MIDI to keep it.`;
};

const instrumentalFromWords = async (prompt: string): Promise<string> => {
  const track = await generateInstrumental(prompt);
  if (!track) {
    return "I could not make an instrumental track right now. Your custom MIDI generator and sound designer are still ready.";
  }
  showGeneratedInstrumental(track.audioUrl);
  return "Your instrumental track is ready below. Tap play when you want to hear it.";
};

/**
 * Anything the recipes did not claim: hear it as an instrument description or
 * a request for fresh MIDI. The LLM is the expressive layer, while the local
 * mapper and phrase generator remain a fast, offline floor.
 */
const designFromWords = async (prompt: string): Promise<string> => {
  const asksForSound = looksLikeSoundWords(prompt);
  const asksForMidi = wantsCustomMidi(prompt);
  if (!asksForSound && !asksForMidi) {
    const hearing = await runStep("get-lesson-state");
    return (
      `I can teach a song on these keys, or build you a sound. Try: teach me, Twinkle, ` +
      `describe one — "thunderous metallic stab" — or ask for a custom 4-bar MIDI riff.\n\n${hearing}`
    );
  }

  const viaLlm = await designViaLlm(prompt);
  if (viaLlm) {
    if (viaLlm.patch) await applySoundPatch(viaLlm.patch);
    if (viaLlm.phrase) {
      applyGeneratedPhrase(viaLlm.phrase.notes, viaLlm.phrase.bars, viaLlm.phrase.bpm);
      return viaLlm.reply || `I wrote ${viaLlm.phrase.notes.length} notes onto the roll. Play it or export the MIDI.`;
    }
    if (!asksForMidi) return viaLlm.reply || `Sound built: ${state.presetName}. Play a key. Press Restore to undo.`;

    const localPhrase = await fallbackMidi(prompt);
    return viaLlm.reply ? `${viaLlm.reply}\n\n${localPhrase}` : localPhrase;
  }

  let soundReply = "";
  if (asksForSound) {
    const { patch, reply } = patchFromWords(prompt);
    await applySoundPatch(patch);
    soundReply = reply;
  }
  if (asksForMidi) {
    const localPhrase = await fallbackMidi(prompt);
    return soundReply ? `${soundReply}\n\n${localPhrase}` : localPhrase;
  }
  return soundReply;
};

export const runAgentTurn = async (prompt: string): Promise<string> => {
  const text = prompt.trim().toLowerCase();
  if (wantsInstrumentalTrack(prompt)) return instrumentalFromWords(prompt);
  // Recipes stay first. They are instant and offline, and they own every lesson
  // trigger — a child asking for "twinkle" must never wait on a network call,
  // nor risk a model reinterpreting it as a request for a timbre.
  //
  // MIDI creation used to be tested above this, to dodge the export recipe
  // catching the word "midi". That also handed the DJ chips to the model:
  // "make me a rave loop" reads as create + loop, so a one-tap offline preset
  // became a round trip that changed the instrument as a side effect. The
  // export recipe is narrow now, so ordering alone resolves it.
  const recipe = RECIPES.find((item) => item.match.test(text));
  if (!recipe) return designFromWords(prompt.trim());
  const lines: string[] = [recipe.say];
  for (const step of recipe.steps) {
    try {
      const body = await runStep(step.tool, step.input ?? {});
      if (body) lines.push(body);
    } catch (error) {
      lines.push(`${step.tool} failed: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  return lines.join("\n\n");
};
