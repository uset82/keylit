import { FACTORY_SOUND } from "../store";
import type { SoundPatch } from "../engine/patch";

/**
 * Turn a sound description into a patch, with no model and no network.
 *
 * This is the floor the whole chatbot stands on. The LLM tier is better at odd
 * phrasing, but it needs a key, a working proxy and a round trip — and a child
 * mid-song on hotel wifi has none of those. Everything here is a table lookup,
 * so it answers instantly, offline, forever, and for free.
 *
 * Scoring is additive per axis rather than first-match: "dark warm hall piano"
 * should land somewhere between dark and warm, not on whichever word came first.
 */

type Axis = "bright" | "attack" | "grit" | "space" | "body";

/**
 * Each word pushes one axis by a signed amount. Ranges are -1..1 and get folded
 * into parameters at the end, so a word can appear on several axes at once —
 * "thunderous" is both huge and dark, and should read as both.
 */
const WORDS: Array<{ match: RegExp; axis: Axis; weight: number }> = [
  // brightness: -1 muffled ... +1 piercing
  { match: /\bbright|brilliant|crisp|clear|sparkl|shimmer|glass|bell|chime|sharp\b/, axis: "bright", weight: 0.7 },
  { match: /\bmetallic|steel|digital|harsh|piercing|screech|razor\b/, axis: "bright", weight: 0.8 },
  { match: /\bdark|muffl|mellow|dull|murky|underwater|distant|veiled\b/, axis: "bright", weight: -0.8 },
  { match: /\bwarm|round|soft|smooth|gentle|velvet|gentle\b/, axis: "bright", weight: -0.4 },

  // attack: -1 slow swell ... +1 percussive slap
  { match: /\bslap|snap|punch|percussi|stab|strike|hit|attack|pluck|staccato|tight|click\b/, axis: "attack", weight: 0.8 },
  { match: /\bpad|swell|bloom|slow|soft attack|fade in|breath|wash|ambient|drift\b/, axis: "attack", weight: -0.8 },
  { match: /\bsustain|lively|ringing|singing|holds?\b/, axis: "attack", weight: -0.2 },

  // grit: 0 clean ... +1 destroyed
  { match: /\bdistort|dirty|grit|crunch|fuzz|raw|aggressive|angry|growl|bark|snarl\b/, axis: "grit", weight: 0.7 },
  { match: /\bcrush|bitcrush|destroy|broken|lo-?fi|8-?bit|glitch|mangle|brutal\b/, axis: "grit", weight: 0.9 },
  { match: /\bclean|pure|pristine|natural|acoustic|simple\b/, axis: "grit", weight: -0.6 },
  // Enough edge to read as metal without tipping into the bitcrusher, which
  // only opens up past 0.6 and is unpleasant on a phone speaker.
  { match: /\bmetallic|steel|industrial|robot|machine|clang\b/, axis: "grit", weight: 0.35 },

  // space: 0 dry ... +1 cathedral
  { match: /\bhall|cathedral|church|cavern|huge space|vast|echo|reverb|ambient|distant\b/, axis: "space", weight: 0.8 },
  { match: /\bdelay|repeat|slap ?back|bounce|ping\b/, axis: "space", weight: 0.5 },
  { match: /\bdry|tight|close|intimate|direct|upfront\b/, axis: "space", weight: -0.7 },

  // body: -1 thin ... +1 enormous
  { match: /\bthunder|massive|huge|enormous|epic|cinematic|dramatic|orchestral|wall of\b/, axis: "body", weight: 0.9 },
  { match: /\bfull|thick|rich|lush|deep|heavy|fat|big\b/, axis: "body", weight: 0.5 },
  { match: /\bthin|small|tiny|light|delicate|sparse|simple\b/, axis: "body", weight: -0.6 },
];

/** Direct requests for an instrument family win over anything the axes infer. */
const FAMILIES: Array<{ match: RegExp; sampleId: string }> = [
  { match: /\bfelt|soft piano|intimate piano|lullab\b/, sampleId: "pn-felt" },
  { match: /\bchurch|chapel|cathedral organ|pipe organ\b/, sampleId: "or-chapel" },
  { match: /\bdrawbar|jazz organ|hammond|organ\b/, sampleId: "or-reed" },
  { match: /\bcp80|electric grand|metallic|digital|bell|chime|glass\b/, sampleId: "sy-rail" },
  { match: /\bwurli|wurlitzer|rhodes|electric piano|slap\b/, sampleId: "sy-razor" },
  { match: /\bstring|orchestr|ensemble|cinematic|epic\b/, sampleId: "ok-bloom" },
  { match: /\bbass|sub|low end|upright\b/, sampleId: "bs-sub" },
  { match: /\bgrand ?\+ ?pad|piano and strings|stack\b/, sampleId: "ml-stack" },
  { match: /\bpiano|grand|steinway|keys\b/, sampleId: "pn-ivory" },
];

const mix = (from: number, to: number, amount: number): number =>
  Number((from + (to - from) * Math.max(0, Math.min(1, amount))).toFixed(3));

/** Fold a -1..1 axis into a 0..1 knob centred on the factory value. */
const knob = (score: number, centre: number): number =>
  Number(Math.max(0, Math.min(1, centre + score * (score > 0 ? 1 - centre : centre))).toFixed(3));

/**
 * Choose the main voice from the axes when no family was named. Deliberately
 * coarse: with nine samples, "which of these nine is least wrong" is the only
 * honest question, and picking on the two axes that separate them most —
 * how hard it hits and how bright it is — beats a longer table that pretends
 * to more precision than the sample set has.
 */
const voiceFor = (axes: Record<Axis, number>): string => {
  // Size is tested before character. "Thunderous dramatic strikes" is percussive
  // and raw, which would otherwise land it on the Wurlitzer — a small, dry
  // electric piano, the opposite of what the words asked for. When someone says
  // huge, the voice has to be huge first and detailed second.
  if (axes.body > 0.6) return axes.attack > 0.3 ? "ml-stack" : "ok-bloom";
  if (axes.attack > 0.4 && axes.bright > 0.4) return "sy-rail";
  if (axes.attack > 0.4 && axes.grit > 0.2) return "sy-razor";
  if (axes.attack < -0.4) return "or-chapel";
  if (axes.bright < -0.4) return "pn-felt";
  if (axes.body > 0.35) return "ml-stack";
  return "pn-ivory";
};

const titleFrom = (text: string): string => {
  const words = text
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^(the|and|with|that|make|sound|like|very|some|more|into|from)$/i.test(word));
  return (words.slice(0, 2).join(" ") || "custom").toUpperCase().slice(0, 22);
};

/**
 * True when the text reads like a description of a sound rather than a question.
 *
 * Deliberately cautious. A false positive silently rewrites the instrument under
 * a child who only asked a question, which is far worse than a false negative —
 * that just returns the hint telling them how to phrase it.
 */
export const looksLikeSoundWords = (text: string): boolean => {
  const lower = text.toLowerCase();
  if (/\b(make|sound|like|instrument|tone|timbre|patch|preset|voice)\b/.test(lower)) return true;

  // Counts regexes, not words, so several synonyms on one axis ("bright glassy
  // bell" is all one alternation) register as a single signal.
  const axisHits = WORDS.filter((word) => word.match.test(lower)).length;
  if (axisHits >= 2) return true;

  // Which is why naming an instrument counts as the second signal. On its own it
  // must not: "how do I play piano" names one and is plainly a question.
  return axisHits >= 1 && FAMILIES.some((family) => family.match.test(lower));
};

/**
 * Map a description onto the rompler. Always returns a patch — there is no
 * failure mode, because a vague description should still move the sound
 * somewhere rather than leave the child staring at an unchanged piano.
 */
export const patchFromWords = (text: string): { patch: SoundPatch; reply: string } => {
  const lower = text.toLowerCase();
  const axes: Record<Axis, number> = { bright: 0, attack: 0, grit: 0, space: 0, body: 0 };
  for (const word of WORDS) {
    if (word.match.test(lower)) axes[word.axis] += word.weight;
  }
  for (const axis of Object.keys(axes) as Axis[]) {
    axes[axis] = Math.max(-1, Math.min(1, axes[axis]));
  }

  const named = FAMILIES.find((family) => family.match.test(lower));
  const sampleId = named?.sampleId ?? voiceFor(axes);

  // A second layer only earns its place when the words asked for weight; two
  // stacked samples on a small phone speaker otherwise just sound muddy.
  const wantsLayer = axes.body > 0.35;
  const layerBId = sampleId === "ok-bloom" ? "bs-sub" : "ok-bloom";

  const factory = FACTORY_SOUND;
  const patch: SoundPatch = {
    presetName: titleFrom(text),
    layerA: { sampleId, volume: 0.9, transpose: 0 },
    layerB: wantsLayer
      ? { sampleId: layerBId, volume: mix(0.18, 0.42, axes.body), transpose: axes.body > 0.7 ? -12 : 0 }
      : { sampleId: layerBId, volume: 0 },
    adsr: {
      // Percussive words shorten the attack toward an instant slap; pad words
      // stretch it into a swell. Release follows the same axis inverted, so a
      // "staccato stab" gets both a hard start and a short tail.
      attack: axes.attack >= 0 ? mix(0.02, 0.001, axes.attack) : mix(0.02, 0.7, -axes.attack),
      decay: factory.adsr.decay,
      sustain: /\bsustain|lively|ringing|holds?\b/.test(lower) ? 0.85 : factory.adsr.sustain,
      release: axes.attack >= 0 ? mix(0.5, 0.08, axes.attack) : mix(0.5, 2.4, -axes.attack),
    },
    fx: {
      filter: knob(axes.bright, 0.72),
      distortion: axes.grit > 0 ? mix(0, 0.55, axes.grit) : 0,
      // Crush is the harshest thing on the chain, so it stays off until a word
      // asked for it specifically rather than riding along with any grit.
      crush: axes.grit > 0.6 ? mix(0, 0.4, axes.grit) : 0,
      delay: axes.space > 0.4 ? mix(0.05, 0.35, axes.space) : factory.fx.delay,
      reverb: axes.space >= 0 ? mix(0.16, 0.8, axes.space) : mix(0.16, 0.02, -axes.space),
    },
  };

  return { patch, reply: describe(axes, sampleId, wantsLayer) };
};

const NAMES: Record<string, string> = {
  "pn-ivory": "the Steinway",
  "pn-felt": "the felt piano",
  "or-chapel": "the chapel organ",
  "or-reed": "the drawbar organ",
  "sy-rail": "the CP80 electric grand",
  "sy-razor": "the Wurlitzer",
  "ok-bloom": "the string ensemble",
  "bs-sub": "the upright bass",
  "ml-stack": "grand piano and strings",
};

const describe = (axes: Record<Axis, number>, sampleId: string, layered: boolean): string => {
  const parts: string[] = [];
  if (axes.attack > 0.3) parts.push("a hard percussive start");
  if (axes.attack < -0.3) parts.push("a slow swell");
  if (axes.bright > 0.3) parts.push("opened up bright");
  if (axes.bright < -0.3) parts.push("rolled off dark");
  if (axes.grit > 0.3) parts.push("driven dirty");
  if (axes.space > 0.3) parts.push("in a big room");
  if (axes.space < -0.3) parts.push("close and dry");
  if (layered) parts.push("with a second layer underneath for weight");
  const tail = parts.length ? ` — ${parts.join(", ")}` : "";
  return `Built it on ${NAMES[sampleId] ?? sampleId}${tail}. Play a key. Press Restore to undo.`;
};
