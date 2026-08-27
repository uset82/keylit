import type { SampleKind } from "../types";

const userBuffers = new Map<string, AudioBuffer>();

const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const writeTone = (
  data: Float32Array,
  sampleRate: number,
  kind: SampleKind,
  seed: number,
): void => {
  const duration = data.length / sampleRate;
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate;
    const env = Math.exp(-t * (kind === "bass" ? 2.2 : kind === "orchestra" ? 1.1 : 3.4));
    let sample = 0;
    if (kind === "piano" || kind === "multi") {
      sample += Math.sin(2 * Math.PI * 261.63 * t) * env;
      sample += Math.sin(2 * Math.PI * 523.25 * t) * 0.35 * Math.exp(-t * 5);
      sample += Math.sin(2 * Math.PI * 784.0 * t) * 0.12 * Math.exp(-t * 8);
    }
    if (kind === "organ" || kind === "multi") {
      sample += Math.sin(2 * Math.PI * 261.63 * t) * 0.55;
      sample += Math.sin(2 * Math.PI * 523.25 * t) * 0.35;
      sample += Math.sin(2 * Math.PI * 784.88 * t) * 0.22;
      sample *= Math.min(1, t * 40) * Math.exp(-t * 0.35);
    }
    if (kind === "synth") {
      const saw = 2 * ((261.63 * t + seed * 0.01) % 1) - 1;
      sample += saw * Math.exp(-t * 2.8);
      sample += Math.sin(2 * Math.PI * 130.81 * t) * 0.2 * Math.exp(-t * 4);
    }
    if (kind === "orchestra") {
      sample += Math.sin(2 * Math.PI * 196 * t) * 0.4 * Math.exp(-t * 0.8);
      sample += Math.sin(2 * Math.PI * 392 * t) * 0.25 * Math.exp(-t * 1.1);
      sample += (Math.random() * 2 - 1) * 0.02 * Math.exp(-t * 6);
    }
    if (kind === "bass") {
      sample += Math.sin(2 * Math.PI * 65.41 * t) * Math.exp(-t * 2.4);
      sample += Math.sin(2 * Math.PI * 130.81 * t) * 0.25 * Math.exp(-t * 8);
    }
    if (kind === "piano") {
      sample += (Math.random() * 2 - 1) * 0.01 * Math.exp(-t * 30);
    }
    data[i] = Math.max(-1, Math.min(1, sample * 0.55));
    if (t > duration - 0.03) {
      data[i] *= (duration - t) / 0.03;
    }
  }
};

export const createFactoryBuffer = (
  context: AudioContext,
  kind: SampleKind,
  seed = 0,
): AudioBuffer => {
  const seconds = kind === "orchestra" ? 2.4 : 1.8;
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  writeTone(buffer.getChannelData(0), context.sampleRate, kind, seed);
  return buffer;
};

export const playbackRateFor = (midi: number, transpose: number): number => {
  const target = midiToHz(midi + transpose);
  return target / midiToHz(60);
};

export const normalizeAndTrim = (buffer: AudioBuffer, context: AudioContext): AudioBuffer => {
  const maxSamples = Math.min(buffer.length, Math.floor(context.sampleRate * 5));
  const channels = buffer.numberOfChannels;
  let peak = 0.0001;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < maxSamples; i += 1) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  const out = context.createBuffer(channels, maxSamples, context.sampleRate);
  const gain = 0.95 / peak;
  for (let c = 0; c < channels; c += 1) {
    const src = buffer.getChannelData(c);
    const dest = out.getChannelData(c);
    for (let i = 0; i < maxSamples; i += 1) {
      dest[i] = src[i] * gain;
    }
  }
  return out;
};

export const storeUserSample = (id: string, buffer: AudioBuffer): void => {
  userBuffers.set(id, buffer);
};

export const getUserSample = (id: string): AudioBuffer | undefined => userBuffers.get(id);

export const listUserSamples = (): string[] => [...userBuffers.keys()];
