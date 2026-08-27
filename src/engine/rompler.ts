import {
  SampleLoader,
  Soundfont,
  SplendidGrandPiano,
  type LoadProgress,
  type Smplr,
} from "smplr";

export type RomplerPhase = "loading" | "sampled" | "fallback";

export type RomplerProgress = {
  phase: RomplerPhase;
  loaded: number;
  total: number;
  label: string;
};

export type VoiceSpec =
  | { type: "grand"; gain: number }
  | {
      type: "sf";
      instrument: string;
      kit: "MusyngKite" | "FluidR3_GM";
      loop?: boolean;
      gain: number;
    };

export type FactoryPatch = {
  id: string;
  voices: VoiceSpec[];
};

const GRAND_NOTES = [36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 96];

export const FACTORY_PATCHES: FactoryPatch[] = [
  { id: "pn-ivory", voices: [{ type: "grand", gain: 1 }] },
  {
    id: "pn-felt",
    voices: [{ type: "sf", instrument: "acoustic_grand_piano", kit: "MusyngKite", gain: 1 }],
  },
  {
    id: "or-chapel",
    voices: [{ type: "sf", instrument: "church_organ", kit: "FluidR3_GM", loop: true, gain: 1 }],
  },
  {
    id: "or-reed",
    voices: [{ type: "sf", instrument: "drawbar_organ", kit: "FluidR3_GM", loop: true, gain: 1 }],
  },
  {
    id: "sy-rail",
    voices: [{ type: "sf", instrument: "electric_grand_piano", kit: "FluidR3_GM", gain: 1 }],
  },
  {
    id: "sy-razor",
    voices: [{ type: "sf", instrument: "electric_piano_2", kit: "FluidR3_GM", gain: 1 }],
  },
  {
    id: "ok-bloom",
    voices: [{ type: "sf", instrument: "string_ensemble_1", kit: "FluidR3_GM", loop: true, gain: 1 }],
  },
  {
    id: "bs-sub",
    voices: [{ type: "sf", instrument: "acoustic_bass", kit: "FluidR3_GM", gain: 1 }],
  },
  {
    id: "ml-stack",
    voices: [
      { type: "grand", gain: 1 },
      { type: "sf", instrument: "string_ensemble_1", kit: "FluidR3_GM", loop: true, gain: 0.38 },
    ],
  },
];

let reportProgress: ((progress: RomplerProgress) => void) | null = null;

export const bindRomplerProgress = (fn: (progress: RomplerProgress) => void): void => {
  reportProgress = fn;
};

const cache = new Map<string, Smplr>();
const inflight = new Map<string, Promise<Smplr | null>>();
const buckets = new Map<string, LoadProgress & { label: string }>();
let loader: ReturnType<typeof SampleLoader> | null = null;
let grandUpgraded = false;

export const voiceKey = (spec: VoiceSpec): string => {
  if (spec.type === "grand") return "grand";
  return `sf:${spec.kit}:${spec.instrument}`;
};

export const getPatch = (id: string): FactoryPatch | undefined =>
  FACTORY_PATCHES.find((patch) => patch.id === id);

export const voicesForSample = (sampleId: string): VoiceSpec[] => getPatch(sampleId)?.voices ?? [];

const getLoader = (context: AudioContext) => {
  if (!loader) loader = SampleLoader(context);
  return loader;
};

const publishProgress = (): void => {
  let loaded = 0;
  let total = 0;
  let label = "SAMPLES";
  buckets.forEach((bucket) => {
    loaded += bucket.loaded;
    total += bucket.total;
    if (bucket.loaded < bucket.total) label = bucket.label;
  });
  const done = total > 0 && loaded >= total;
  reportProgress?.({
    phase: done ? "sampled" : "loading",
    loaded,
    total,
    label,
  });
};

const trackProgress = (key: string, label: string) => (progress: LoadProgress) => {
  buckets.set(key, { ...progress, label });
  publishProgress();
};

const createVoice = (context: AudioContext, destination: AudioNode, spec: VoiceSpec): Smplr => {
  const shared = {
    destination,
    loader: getLoader(context),
    volume: 100,
  };

  if (spec.type === "grand") {
    return SplendidGrandPiano(context, {
      ...shared,
      decayTime: 3.4,
      notesToLoad: { notes: GRAND_NOTES, velocityRange: [1, 127] },
      onLoadProgress: trackProgress("grand", "STEINWAY"),
    });
  }

  return Soundfont(context, {
    ...shared,
    instrument: spec.instrument,
    kit: spec.kit,
    loadLoopData: Boolean(spec.loop),
    onLoadProgress: trackProgress(`sf:${spec.instrument}`, spec.instrument.replace(/_/g, " ")),
  });
};

const loadFastGrand = (context: AudioContext, destination: AudioNode): Smplr =>
  Soundfont(context, {
    destination,
    loader: getLoader(context),
    volume: 100,
    instrument: "acoustic_grand_piano",
    kit: "MusyngKite",
    onLoadProgress: trackProgress("grand-fast", "GRAND"),
  });

const loadSpec = async (
  context: AudioContext,
  destination: AudioNode,
  spec: VoiceSpec,
): Promise<Smplr | null> => {
  const key = voiceKey(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const work = (async () => {
    try {
      if (spec.type === "grand" && !grandUpgraded) {
        const fastKey = "grand-fast";
        let fast = cache.get(fastKey);
        if (!fast) {
          fast = loadFastGrand(context, destination);
          cache.set(fastKey, fast);
          await fast.ready;
        }
        cache.set("grand", fast);
        void (async () => {
          try {
            const splendid = createVoice(context, destination, spec);
            await splendid.ready;
            cache.set("grand", splendid);
            grandUpgraded = true;
            buckets.delete("grand-fast");
            publishProgress();
          } catch {
            /* keep the GM grand */
          }
        })();
        return fast;
      }

      const instrument = createVoice(context, destination, spec);
      await instrument.ready;
      cache.set(key, instrument);
      return instrument;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, work);
  return work;
};

export const resolveVoice = async (
  context: AudioContext,
  destination: AudioNode,
  spec: VoiceSpec,
): Promise<Smplr | null> => {
  const loaded = await loadSpec(context, destination, spec);
  if (spec.type === "grand") return cache.get("grand") ?? loaded;
  return loaded;
};

export const peekVoice = (spec: VoiceSpec): Smplr | undefined => cache.get(voiceKey(spec));

export const applySustainToRompler = (down: boolean): void => {
  cache.forEach((instrument) => {
    try {
      instrument.setCC(64, down ? 127 : 0);
    } catch {
      /* disposed */
    }
  });
};

export const warmPatches = async (
  context: AudioContext,
  destination: AudioNode,
  sampleIds: string[],
): Promise<boolean> => {
  reportProgress?.({ phase: "loading", loaded: 0, total: 1, label: "SAMPLES" });
  const specs = [
    ...new Map(sampleIds.flatMap((id) => voicesForSample(id)).map((spec) => [voiceKey(spec), spec])).values(),
  ];
  if (!specs.length) {
    reportProgress?.({ phase: "fallback", loaded: 0, total: 0, label: "SAMPLES" });
    return false;
  }
  const results = await Promise.all(specs.map((spec) => resolveVoice(context, destination, spec)));
  const ok = results.some(Boolean);
  reportProgress?.({
    phase: ok ? "sampled" : "fallback",
    loaded: ok ? 1 : 0,
    total: 1,
    label: "SAMPLES",
  });
  return ok;
};

export const loadedVoiceCount = (): number => cache.size;
