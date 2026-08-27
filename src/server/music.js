/**
 * Server-side MiniMax instrumental proxy. This deliberately has no imports so
 * the Sites build can inline it into the worker just like design.js.
 */

const MINIMAX_MUSIC_URL = "https://api.minimax.io/v1/music_generation";
const MINIMAX_TIMEOUT_MS = 30000;
const MINIMAX_MAX_PROMPT = 1200;
const MINIMAX_RATE_LIMIT = { windowMs: 60000, max: 3 };
const minimaxHits = new Map();
const MINIMAX_MODELS = new Set(["music-3.0", "music-2.6", "music-3.0-free", "music-2.6-free"]);

const cleanMusicText = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const musicRateLimited = (ip) => {
  const now = Date.now();
  const recent = (minimaxHits.get(ip) ?? []).filter((time) => now - time < MINIMAX_RATE_LIMIT.windowMs);
  recent.push(now);
  minimaxHits.set(ip, recent);
  if (minimaxHits.size > 1000) {
    for (const [key, times] of minimaxHits) {
      if (!times.length || now - times[times.length - 1] > MINIMAX_RATE_LIMIT.windowMs) minimaxHits.delete(key);
    }
  }
  return recent.length > MINIMAX_RATE_LIMIT.max;
};

const safeAudioUrl = (value) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Ask MiniMax for an instrumental track, returning only a short-lived audio URL
 * to the page. The API key and upstream response remain on the server.
 */
export const musicReply = async ({ prompt, apiKey, model, ip, fetchImpl }) => {
  if (!apiKey) return { status: 503, json: { error: "not-configured" } };
  const text = cleanMusicText(prompt, MINIMAX_MAX_PROMPT);
  if (!text) return { status: 400, json: { error: "empty-prompt" } };
  if (musicRateLimited(ip || "unknown")) return { status: 429, json: { error: "rate-limited" } };

  const selectedModel = MINIMAX_MODELS.has(model) ? model : "music-3.0-free";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MINIMAX_TIMEOUT_MS);
  try {
    const response = await fetchImpl(MINIMAX_MUSIC_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        prompt: text,
        is_instrumental: true,
        output_format: "url",
        audio_setting: { sample_rate: 44100, bitrate: 128000, format: "mp3" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { status: 502, json: { error: "upstream-failed" } };
    const data = await response.json();
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return { status: 502, json: { error: "upstream-failed" } };
    }
    const audioUrl = safeAudioUrl(data?.data?.audio ?? data?.data?.audio_url);
    if (!audioUrl) return { status: 502, json: { error: "missing-audio" } };
    return { status: 200, json: { audioUrl, model: selectedModel } };
  } catch {
    return { status: 502, json: { error: "upstream-failed" } };
  } finally {
    clearTimeout(timer);
  }
};

/** Fetch-standard adapter used by the Sites worker. */
export const handleMusicRequest = async (request, apiKey, model) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method-not-allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { status, json } = await musicReply({
    prompt: body.prompt,
    apiKey,
    model,
    ip: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown",
    fetchImpl: fetch,
  });
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
