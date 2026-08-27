import { clampPatch, sampleSheet, type SoundPatch } from "../engine/patch";
import { clampGeneratedPhrase, type GeneratedPhrase } from "../engine/generated-phrase";

/**
 * Client half of the LLM tier. Asks /api/design for a patch and gives up quietly.
 *
 * "Quietly" is the whole design. This tier is an upgrade, never a dependency:
 * the caller's fallback is the offline word mapper, which is always available, so
 * any failure here should cost the child a slightly less clever answer and
 * nothing else. Every error path therefore returns null rather than throwing.
 */

/**
 * Short on purpose. This is a child waiting for an answer with nothing else
 * happening on screen, so the budget is set by their patience, not by how long
 * a model might plausibly take. A slow model is simply a model we do not use.
 */
const TIMEOUT_MS = 8000;

/**
 * Once the endpoint has told us it has no key, stop asking. Without this every
 * unmatched message on the Vercel deploy (where no key is set) would spend the
 * full timeout waiting to be told the same thing again.
 */
let unavailable = false;

/**
 * Same idea, for a proxy that is reachable but broken — a dead upstream, an
 * exhausted key, a provider outage. "Fall through silently" was only ever
 * honest when failure was rare; when the proxy fails every single time, silent
 * became a timeout-long stare before every reply, which reads as a hung app.
 *
 * So: pay the wait twice, then stop paying it. Latched for the session rather
 * than on a timer, because a page that is fast and slightly stale beats one
 * that randomly goes slow again ten minutes later.
 */
const MAX_FAILURES = 2;
let failures = 0;

/**
 * True once this tier has given up for the session, so the caller can SAY the
 * sound designer is offline instead of silently handing back the offline
 * mapper's answer. Failing quietly is why this looked broken rather than
 * degraded: the chat simply stopped being clever and never said why.
 */
export const llmUnavailable = (): boolean => unavailable;

const noteFailure = (): null => {
  failures += 1;
  if (failures >= MAX_FAILURES) unavailable = true;
  return null;
};

export type DesignResult = { patch: SoundPatch | null; phrase: GeneratedPhrase | null; reply: string };

export const designViaLlm = async (description: string): Promise<DesignResult | null> => {
  if (unavailable) return null;
  // A doomed request still costs half a second before it fails, and this tier's
  // whole reason for having a fallback is the child on bad hotel wifi. Not
  // latched: navigator.onLine can flip back, and a false negative here only
  // means one message gets the offline mapper's answer instead.
  if (navigator.onLine === false) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("/api/design", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description, sheet: sampleSheet() }),
      signal: controller.signal,
    });

    // 503 is the endpoint saying no key is configured, which will not change
    // while the page is open. Anything else might be transient, so keep trying.
    if (response.status === 503) {
      unavailable = true;
      return null;
    }
    if (!response.ok) return noteFailure();

    const data = (await response.json()) as { reply?: unknown; patch?: unknown; phrase?: unknown };
    // Clamped here rather than trusted: the server only checked the shape was
    // roughly right, and this is the last point before the audio graph and
    // phrase sequencer.
    const patch = clampPatch(data.patch);
    const phrase = clampGeneratedPhrase(data.phrase);
    // A 200 carrying nothing usable is still a failure of this tier, and one
    // that repeats: a model that cannot hold the schema will not learn to.
    if (!patch && !phrase) return noteFailure();

    failures = 0;
    const reply = typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "";
    return { patch, phrase, reply };
  } catch {
    // Aborted, offline, blocked by CSP, served by a host with no /api route —
    // all the same outcome as far as the caller is concerned.
    return noteFailure();
  } finally {
    window.clearTimeout(timer);
  }
};
