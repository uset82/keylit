import { FACTORY_SAMPLES, patchState, state } from "../store";
import type { AdsrState, FxState, InstrumentState, LayerState } from "../types";
import { applyFx, initAudio, warmCurrentPatches } from "./audio";

/**
 * A whole sound in one object. The rompler has no single "load this patch" call —
 * set-layer, set-adsr and set-fx each own a slice — so anything describing a
 * complete instrument had to fire three tools and hope they landed together.
 */
export type SoundPatch = {
  presetName?: string;
  layerA?: Partial<LayerState>;
  layerB?: Partial<LayerState>;
  adsr?: Partial<AdsrState>;
  fx?: Partial<FxState>;
};

/**
 * What each sample actually sounds like.
 *
 * The agent-facing names are useless on their own: nothing about the string
 * "ok-bloom" or even "Ensemble" tells a model it is a slow-swelling string pad
 * with no attack, so without this sheet it picks by vibe and lands on a piano
 * every time. Shared by the WebMCP tool description, the offline word mapper and
 * the LLM system prompt so all three agree on what the instrument can do.
 */
export const SAMPLE_CHARACTER: Record<string, string> = {
  "pn-ivory": "bright acoustic grand piano, hard percussive attack, long ringing decay",
  "pn-felt": "soft felt piano, muted and intimate, gentle attack, close and quiet",
  "or-chapel": "church pipe organ, holds forever with no decay, huge and airy",
  "or-reed": "drawbar jazz organ, reedy and punchy, hard edge",
  "sy-rail": "Yamaha CP80 electric grand, metallic bell-like attack, hard and glassy",
  "sy-razor": "Wurlitzer electric piano, barking slappy attack, warm dirty growl",
  "ok-bloom": "orchestral string ensemble, slow swelling attack, wide and cinematic",
  "bs-sub": "upright acoustic bass, deep and woody, short plucked notes",
  "ml-stack": "grand piano stacked with strings, big dramatic and cinematic",
};

/** Parameter bounds, mirroring the set-adsr / set-fx / set-layer tool schemas. */
const BOUNDS = {
  attack: [0.001, 2],
  decay: [0.01, 2],
  sustain: [0, 1],
  release: [0.02, 3],
  filter: [0, 1],
  distortion: [0, 1],
  crush: [0, 1],
  delay: [0, 1],
  reverb: [0, 1],
  volume: [0, 1],
  transpose: [-24, 24],
} as const;

const clamp = (value: unknown, key: keyof typeof BOUNDS): number | undefined => {
  const number = typeof value === "number" ? value : Number(value);
  // NaN fails every comparison, so this rejects "loud", null and undefined alike.
  if (!Number.isFinite(number)) return undefined;
  const [min, max] = BOUNDS[key];
  return Math.min(max, Math.max(min, number));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clampLayer = (raw: unknown): Partial<LayerState> | undefined => {
  if (!isRecord(raw)) return undefined;
  const layer: Partial<LayerState> = {};
  // Only a known factory id may through, and it carries its own `kind` with it.
  // A hallucinated "warm-pad-3" would otherwise reach the rompler as a patch name
  // that loads nothing, leaving the layer silent with no clue why.
  const sample = FACTORY_SAMPLES.find((item) => item.id === raw.sampleId);
  if (sample) {
    layer.sampleId = sample.id;
    layer.kind = sample.kind;
  }
  const volume = clamp(raw.volume, "volume");
  if (volume !== undefined) layer.volume = volume;
  const transpose = clamp(raw.transpose, "transpose");
  if (transpose !== undefined) layer.transpose = Math.round(transpose);
  return Object.keys(layer).length ? layer : undefined;
};

const clampGroup = <K extends string>(raw: unknown, keys: readonly K[]): Partial<Record<K, number>> | undefined => {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const value = clamp(raw[key], key as keyof typeof BOUNDS);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
};

/**
 * The trust boundary for anything that did not come from our own code.
 *
 * A language model will happily answer with `{"fx": {"reverb": "lots"}}`, a
 * negative attack, or a sample that does not exist. Every field is therefore
 * proved rather than assumed, and anything unprovable is dropped instead of
 * defaulted — a dropped field leaves that part of the sound alone, which is
 * always a safe outcome. Returns null when nothing survived.
 */
export const clampPatch = (raw: unknown): SoundPatch | null => {
  if (!isRecord(raw)) return null;
  const patch: SoundPatch = {};

  if (typeof raw.presetName === "string") {
    const name = raw.presetName.trim().slice(0, 22).toUpperCase();
    if (name) patch.presetName = name;
  }
  const layerA = clampLayer(raw.layerA);
  if (layerA) patch.layerA = layerA;
  const layerB = clampLayer(raw.layerB);
  if (layerB) patch.layerB = layerB;
  const adsr = clampGroup(raw.adsr, ["attack", "decay", "sustain", "release"] as const);
  if (adsr) patch.adsr = adsr;
  const fx = clampGroup(raw.fx, ["filter", "distortion", "crush", "delay", "reverb"] as const);
  if (fx) patch.fx = fx;

  return Object.keys(patch).length ? patch : null;
};

/**
 * Apply a whole sound at once, following the same order load-preset uses:
 * state first, then the FX graph, then warm whatever samples the new layers need.
 */
export const applySoundPatch = async (patch: SoundPatch): Promise<void> => {
  const next: Partial<InstrumentState> = {};
  if (patch.presetName) next.presetName = patch.presetName;
  // Spread over the live layer rather than assigning: patchState is a top-level
  // Object.assign, so handing it a partial layer would drop every field the
  // patch did not mention, silently resetting volume or transpose to undefined.
  if (patch.layerA) next.layerA = { ...state.layerA, ...patch.layerA };
  if (patch.layerB) next.layerB = { ...state.layerB, ...patch.layerB };
  if (patch.adsr) next.adsr = { ...state.adsr, ...patch.adsr };
  if (patch.fx) next.fx = { ...state.fx, ...patch.fx };

  patchState(next);
  applyFx();
  await initAudio();
  await warmCurrentPatches();
};

/** One line per sample, for a tool description or a system prompt. */
export const sampleSheet = (): string =>
  FACTORY_SAMPLES.map((sample) => `${sample.id} (${sample.name}): ${SAMPLE_CHARACTER[sample.id] ?? sample.source}`).join("\n");
