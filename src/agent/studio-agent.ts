import { runTool } from "../webmcp/adapter";

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
      { tool: "set-fx", input: { filter: 0.62, distortion: 0.28, crush: 0.22, delay: 0.18, reverb: 0.2 } },
      { tool: "generate-phrase", input: { style: "rave", bars: 4 } },
    ],
    say: "Yamaha CP80 + drawbar, crushed rave stab.",
  },
  {
    match: /house/,
    steps: [{ tool: "generate-phrase", input: { style: "house", bars: 4 } }],
    say: "House stabs are on the roll.",
  },
  {
    match: /techno/,
    steps: [
      { tool: "set-fx", input: { crush: 0.34, filter: 0.48, delay: 0.12, reverb: 0.1, distortion: 0.2 } },
      { tool: "generate-phrase", input: { style: "techno", bars: 8 } },
    ],
    say: "Tighter techno hits, more crush.",
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
    match: /export|midi|download/,
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

export const runAgentTurn = async (prompt: string): Promise<string> => {
  const text = prompt.trim().toLowerCase();
  const recipe = RECIPES.find((item) => item.match.test(text));
  if (!recipe) {
    const hearing = await runStep("get-lesson-state");
    return `I can teach a song on these keys. Try: teach me, Happy Birthday, Twinkle, C scale.\n\n${hearing}`;
  }
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
