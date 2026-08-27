/**
 * Client half of the optional MiniMax instrumental route. It only ever receives
 * a temporary audio URL — provider credentials never leave the worker.
 */

const TIMEOUT_MS = 32000;

/**
 * Latched after the first failure of any kind, not just a 503.
 *
 * Generation legitimately takes half a minute, so the timeout has to be long —
 * which makes a broken provider unusually expensive here. MiniMax discontinued
 * the free music tier on 20 August 2026, so /api/music now answers 502 rather
 * than 503, and without this every attempt would stall the chat for 32 seconds
 * to reach the same "could not make a track" as the first one.
 */
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
    if (!response.ok) {
      unavailable = true;
      return null;
    }
    const data = (await response.json()) as { audioUrl?: unknown };
    const track =
      typeof data.audioUrl === "string" && /^https:\/\//.test(data.audioUrl) ? { audioUrl: data.audioUrl } : null;
    if (!track) unavailable = true;
    return track;
  } catch {
    unavailable = true;
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
