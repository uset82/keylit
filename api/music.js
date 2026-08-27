import { musicReply } from "../src/server/music.js";

/** Vercel adapter for the same MiniMax proxy used by the Sites worker. */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method-not-allowed" });
    return;
  }

  let body = request.body ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const forwarded = request.headers["x-forwarded-for"];
  const { status, json } = await musicReply({
    prompt: body.prompt,
    apiKey: process.env.MINIMAX_API_KEY,
    model: process.env.MINIMAX_MUSIC_MODEL,
    ip: (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || "unknown",
    fetchImpl: fetch,
  });
  response.setHeader("cache-control", "no-store");
  response.status(status).json(json);
}
