import { designReply } from "../src/server/design.js";

/**
 * Vercel adapter for the sound-design proxy. The ChatGPT Sites deploy routes the
 * same path through src/site-worker.js instead; both call the shared core so the
 * prompt and the rate limit cannot drift between the two hosts.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method-not-allowed" });
    return;
  }

  // Vercel parses JSON bodies already, but a string arrives when the caller
  // omits or misstates content-type.
  let body = request.body ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const forwarded = request.headers["x-forwarded-for"];
  const { status, json } = await designReply({
    description: body.description,
    sheet: body.sheet,
    apiKey: process.env.OPENROUTER_API_KEY,
    ip: (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || "unknown",
    fetchImpl: fetch,
  });

  response.setHeader("cache-control", "no-store");
  response.status(status).json(json);
}
