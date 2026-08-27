import { FACTORY_SOUND, state, patchState } from "../store";
import type { LayerState, PhraseNote } from "../types";
import {
  applySustainToRompler,
  bindRomplerProgress,
  peekVoice,
  voicesForSample,
  warmPatches,
  type VoiceSpec,
} from "./rompler";
import {
  createFactoryBuffer,
  getUserSample,
  playbackRateFor,
} from "./samples";
import type { Smplr } from "smplr";

const factoryCache = new Map<string, AudioBuffer>();
const activeVoices = new Map<number, Voice[]>();
const sustainedNotes = new Set<number>();

type Voice = {
  stop: (when?: number) => void;
};

let context: AudioContext | null = null;
let filter: BiquadFilterNode | null = null;
let shaper: WaveShaperNode | null = null;
let crush: AudioWorkletNode | null = null;
let delay: DelayNode | null = null;
let delayGain: GainNode | null = null;
let wet: GainNode | null = null;
let dry: GainNode | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let convolver: ConvolverNode | null = null;
let mix: GainNode | null = null;
let warming: Promise<boolean> = Promise.resolve(false);
let initializing: Promise<void> | null = null;
let crushLoading: Promise<void> | null = null;

const crushWorklet = `
class CrushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "amount", defaultValue: 0, minValue: 0, maxValue: 1 }];
  }
  constructor() {
    super();
    this.hold = 0;
    this.counter = 0;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const amount = parameters.amount[0] ?? 0;
    const step = 1 + Math.floor(amount * 28);
    const bits = Math.max(3, 14 - Math.floor(amount * 11));
    const quant = 2 ** bits;
    for (let c = 0; c < output.length; c += 1) {
      const inp = input[c] || input[0];
      if (!inp) continue;
      for (let i = 0; i < output[c].length; i += 1) {
        this.counter += 1;
        if (this.counter >= step) {
          this.counter = 0;
          this.hold = Math.round(inp[i] * quant) / quant;
        }
        output[c][i] = amount < 0.02 ? inp[i] : this.hold;
      }
    }
    return true;
  }
}
registerProcessor("crush-processor", CrushProcessor);
`;

const makeImpulse = (audio: AudioContext): AudioBuffer => {
  const seconds = 1.8;
  const buffer = audio.createBuffer(2, audio.sampleRate * seconds, audio.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audio.sampleRate * 0.42));
    }
  }
  return buffer;
};

const makeCurve = (amount: number): Float32Array => {
  const n = 256;
  const curve = new Float32Array(n);
  const k = amount * 40;
  for (let i = 0; i < n; i += 1) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
};

const bufferFor = (sampleId: string, kind: string): AudioBuffer => {
  if (!context) throw new Error("Audio is not ready");
  const user = getUserSample(sampleId);
  if (user) return user;
  const cached = factoryCache.get(sampleId);
  if (cached) return cached;
  const seed = [...sampleId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const created = createFactoryBuffer(context, kind as "piano", seed);
  factoryCache.set(sampleId, created);
  return created;
};

const bindProgress = (): void => {
  bindRomplerProgress((progress) => {
    patchState({
      sampleEngine: progress.phase === "loading" ? "loading" : progress.phase,
      loadProgress:
        progress.phase === "loading" && progress.total > 0
          ? { loaded: progress.loaded, total: progress.total, label: progress.label }
          : null,
    });
  });
};

export const getAnalyser = (): AnalyserNode | null => analyser;

/**
 * The master gain, for sources that should obey the volume knob and show on the
 * meter but skip the filter/crush chain — the backing drums are the one case.
 */
export const getMasterBus = (): GainNode | null => master;

export const applyMaster = (): void => {
  if (master) master.gain.value = state.master;
};

export const applyFx = (): void => {
  if (!context || !filter || !shaper || !delay || !delayGain || !wet || !dry) return;
  const nyquist = context.sampleRate / 2;
  filter.frequency.value = 240 + state.fx.filter * (nyquist * 0.92);
  shaper.curve = makeCurve(state.fx.distortion) as Float32Array<ArrayBuffer>;
  delay.delayTime.value = 0.08 + state.fx.delay * 0.36;
  delayGain.gain.value = state.fx.delay * 0.42;
  wet.gain.value = state.fx.reverb * 0.55;
  dry.gain.value = 1 - state.fx.reverb * 0.25;
  const crushAmount = crush?.parameters.get("amount");
  if (crushAmount) crushAmount.setValueAtTime(state.fx.crush, context.currentTime);
};

const upgradeCrushInBackground = (): void => {
  if (!context || !shaper || !dry || !delay || !convolver || crush || crushLoading) return;
  const audio = context;
  const source = shaper;
  const dryTarget = dry;
  const delayTarget = delay;
  const reverbTarget = convolver;
  const blob = new Blob([crushWorklet], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  crushLoading = (async () => {
    try {
      await audio.audioWorklet.addModule(url);
      if (context !== audio || shaper !== source) return;
      const upgraded = new AudioWorkletNode(audio, "crush-processor");
      source.disconnect();
      source.connect(upgraded);
      upgraded.connect(dryTarget);
      upgraded.connect(delayTarget);
      upgraded.connect(reverbTarget);
      crush = upgraded;
      applyFx();
    } catch {
      // Older iPads can omit or reject AudioWorklet. The direct effects graph
      // remains connected, so the instrument keeps playing without crush.
    } finally {
      URL.revokeObjectURL(url);
      crushLoading = null;
    }
  })();
};

export const warmCurrentPatches = async (): Promise<boolean> => {
  if (!context || !mix) return false;
  bindProgress();
  const ids = [state.layerA, state.layerB]
    .filter((layer) => layer.kind !== "user" && layer.volume >= 0.02)
    .map((layer) => layer.sampleId);
  if (!ids.includes(state.layerA.sampleId) && state.layerA.kind !== "user") {
    ids.unshift(state.layerA.sampleId);
  }
  warming = warming.then(
    () => warmPatches(context!, mix!, ids),
    () => warmPatches(context!, mix!, ids),
  );
  return warming;
};

/**
 * iOS runs Web Audio in the `ambient` session by default, and `ambient` is muted
 * by the physical Ring/Silent switch. A phone left on silent — which is most of
 * them — plays nothing at all: keys glow, lessons advance, meter moves, no sound.
 * `playback` is the category for media that should be heard regardless.
 *
 * Safari 16.4+. Feature-detected, and a no-op everywhere else.
 */
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

const claimAudioSession = (): void => {
  try {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // Setting the session is best-effort; never let it break audio start-up.
  }
};

/**
 * Older iOS (pre-16.4) has no audioSession API. Playing one silent sample
 * through the destination inside the unlocking gesture is the long-standing way
 * to get the session out of its muted default.
 */
const kickSilentBuffer = (audio: AudioContext): void => {
  try {
    const source = audio.createBufferSource();
    source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
    source.connect(audio.destination);
    source.start(0);
  } catch {
    // Non-fatal.
  }
};

/** True while the context exists but is not running — the app is visibly silent. */
const syncAudioBlocked = (): void => {
  const blocked = Boolean(context) && context!.state !== "running";
  if (state.audioBlocked !== blocked) patchState({ audioBlocked: blocked });
};

/** iOS suspends the context on backgrounding, and can demote the session too. */
const watchContext = (audio: AudioContext): void => {
  audio.addEventListener("statechange", syncAudioBlocked);
  const revive = (): void => {
    if (document.visibilityState !== "visible") return;
    claimAudioSession();
    void audio.resume().catch(() => undefined).then(syncAudioBlocked);
  };
  document.addEventListener("visibilitychange", revive);
  window.addEventListener("pageshow", revive);
};

export const initAudio = async (): Promise<void> => {
  if (initializing) return initializing;
  if (context && mix) {
    claimAudioSession();
    void context
      .resume()
      .catch(() => patchState({ ready: false }))
      .then(syncAudioBlocked);
    return;
  }
  initializing = (async () => {
    // Claim the session BEFORE the context exists — on iOS the category is
    // decided as the context starts, so setting it afterwards is too late.
    claimAudioSession();
    context = new AudioContext({ latencyHint: "interactive" });
    mix = context.createGain();
    filter = context.createBiquadFilter();
    filter.type = "lowpass";
    shaper = context.createWaveShaper();
    delay = context.createDelay(1.2);
    delayGain = context.createGain();
    dry = context.createGain();
    wet = context.createGain();
    convolver = context.createConvolver();
    master = context.createGain();
    analyser = context.createAnalyser();
    analyser.fftSize = 256;

    mix.connect(filter);
    filter.connect(shaper);
    shaper.connect(dry);
    shaper.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(delay);
    delayGain.connect(dry);
    shaper.connect(convolver);
    convolver.connect(wet);
    dry.connect(master);
    wet.connect(master);
    master.connect(analyser);
    analyser.connect(context.destination);
    applyFx();
    applyMaster();
    // Trigger resume inside the touch event, but do not make visual/audio setup
    // wait for Safari's resume promise. Scheduled voices begin as soon as the
    // context transitions to running.
    kickSilentBuffer(context);
    watchContext(context);
    void context
      .resume()
      .catch(() => patchState({ ready: false }))
      .then(syncAudioBlocked);
    // Do not hold the first note behind a network sample download. The light
    // local fallback plays immediately and the sampled piano replaces it as
    // soon as warming completes.
    void warmCurrentPatches();
    upgradeCrushInBackground();
    const impulseContext = context;
    const impulseNode = convolver;
    window.setTimeout(() => {
      if (context === impulseContext && convolver === impulseNode && !impulseNode.buffer) {
        impulseNode.buffer = makeImpulse(impulseContext);
      }
    }, 0);
  })();
  try {
    await initializing;
  } finally {
    initializing = null;
  }
};

const startBufferLayer = (layer: LayerState, midi: number, velocity: number, when: number): Voice => {
  const source = context!.createBufferSource();
  source.buffer = bufferFor(layer.sampleId, layer.kind);
  source.playbackRate.value = playbackRateFor(midi, layer.transpose);
  const gain = context!.createGain();
  const peak = layer.volume * (velocity / 127);
  const attack = Math.max(0.001, state.adsr.attack);
  const decay = Math.max(0.01, state.adsr.decay);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * state.adsr.sustain), when + attack + decay);
  source.connect(gain);
  gain.connect(mix!);
  source.start(when);
  return {
    stop: (stopAt = context!.currentTime) => {
      const release = Math.max(0.03, state.adsr.release);
      gain.gain.cancelScheduledValues(stopAt);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), stopAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt + release);
      try {
        source.stop(stopAt + release + 0.02);
      } catch {
        /* already stopped */
      }
    },
  };
};

const startSampledLayer = (
  layer: LayerState,
  spec: VoiceSpec,
  instrument: Smplr,
  midi: number,
  velocity: number,
  when: number,
  duration?: number,
): Voice => {
  const note = midi + layer.transpose;
  const scaled = Math.max(1, Math.min(127, Math.round(velocity * layer.volume * spec.gain)));
  const stop = instrument.start({
    note,
    velocity: scaled,
    time: when,
    duration: duration ?? undefined,
    ampRelease: Math.max(0.04, state.adsr.release),
  });
  return {
    stop: (stopAt) => stop(stopAt),
  };
};

const collectLayerVoices = (
  layer: LayerState,
  midi: number,
  velocity: number,
  when: number,
  duration?: number,
): Voice[] => {
  if (layer.volume < 0.02) return [];
  if (layer.kind === "user" || getUserSample(layer.sampleId)) {
    return [startBufferLayer(layer, midi, velocity, when)];
  }
  const specs = voicesForSample(layer.sampleId);
  const voices: Voice[] = [];
  specs.forEach((spec) => {
    const instrument = peekVoice(spec);
    if (!instrument) return;
    voices.push(startSampledLayer(layer, spec, instrument, midi, velocity, when, duration));
  });
  if (voices.length) return voices;
  return [startBufferLayer(layer, midi, velocity, when)];
};

export const noteOn = (midi: number, velocity = 100, when?: number, duration?: number): void => {
  if (!context || !mix) return;
  const scheduled = duration !== undefined;
  if (!scheduled) noteOff(midi, true);
  const time = when ?? context.currentTime;
  const voices = [
    ...collectLayerVoices(state.layerA, midi, velocity, time, duration),
    ...collectLayerVoices(state.layerB, midi, velocity, time, duration),
  ];
  if (!scheduled && voices.length) activeVoices.set(midi, voices);
};

const releaseVoice = (midi: number, immediate = false, when?: number): void => {
  const voices = activeVoices.get(midi);
  if (!voices || !context) return;
  const time = when ?? context.currentTime;
  const stopAt = immediate ? time : time;
  voices.forEach((voice) => voice.stop(stopAt));
  activeVoices.delete(midi);
  sustainedNotes.delete(midi);
};

export const noteOff = (midi: number, immediate = false, when?: number): void => {
  if (state.sustain && !immediate) {
    sustainedNotes.add(midi);
    return;
  }
  releaseVoice(midi, immediate, when);
};

export const setSustain = (down: boolean): void => {
  patchState({ sustain: down });
  applySustainToRompler(down);
  if (down) return;
  [...sustainedNotes].forEach((midi) => {
    if (!state.heldNotes.includes(midi)) releaseVoice(midi);
  });
  sustainedNotes.clear();
};

export const allNotesOff = (): void => {
  patchState({ sustain: false });
  applySustainToRompler(false);
  [...activeVoices.keys()].forEach((midi) => releaseVoice(midi, true));
  sustainedNotes.clear();
};

export const playPhrase = (phrase: PhraseNote[]): void => {
  if (!context) return;
  const beat = 60 / state.bpm;
  const now = context.currentTime;
  phrase.forEach((note) => {
    const swing = note.startBeat % 1 === 0.5 ? state.swing * beat : 0;
    const start = now + note.startBeat * beat + swing;
    const duration = Math.max(0.05, note.durationBeats * beat);
    noteOn(note.midi, note.velocity, start, duration);
  });
};

export const getContext = (): AudioContext | null => context;

/**
 * Put the instrument back to the sound it booted with. Cloned so the running state never
 * shares objects with FACTORY_SOUND. ADSR needs no call of its own — it is read per note,
 * so the next key pressed already uses it.
 */
export const resetSound = async (): Promise<void> => {
  patchState(structuredClone(FACTORY_SOUND));
  applyFx();
  applyMaster();
  await initAudio();
  await warmCurrentPatches();
};
