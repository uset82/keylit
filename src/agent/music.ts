/**
 * Client half of the optional MiniMax instrumental route. It only ever receives
 * a temporary audio URL — provider credentials never leave the worker.
 */

const TIMEOUT_MS = 32000;
let unavailable = false;

export type InstrumentalTrack = { audioUrl: string };

export const generateInstrumental = async (prompt: string): Promise<InstrumentalTrack | null> => {
  if (unavailable || navigator.onLine === false) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("/api/music", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    if (response.status === 503) {
      unavailable = true;
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as { audioUrl?: unknown };
    return typeof data.audioUrl === "string" && /^https:\/\//.test(data.audioUrl) ? { audioUrl: data.audioUrl } : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
};

export const showGeneratedInstrumental = (audioUrl: string): void => {
  const panel = document.querySelector<HTMLElement>("#music-result");
  const player = document.querySelector<HTMLAudioElement>("#music-audio");
  if (!panel || !player) return;
  player.src = audioUrl;
  player.load();
  panel.classList.remove("hidden");
};
