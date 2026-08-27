/**
 * Exercises the sound-design proxy core with a stubbed upstream, so the failure
 * paths that matter (no key, junk model output, rate limit) are proved without a
 * real API key or a deploy. Run: node scripts/check-design.mjs
 */
import { designReply } from "../src/server/design.js";

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : `  (got ${actual}, wanted ${expected})`}`);
};

const upstream = (content) => async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

const goodPatch = JSON.stringify({
  reply: "Thunder it is.",
  patch: { presetName: "THUNDER", layerA: { sampleId: "ok-bloom" }, fx: { distortion: 0.7 } },
});
const goodPhrase = JSON.stringify({
  reply: "A short riff is on the roll.",
  phrase: {
    bpm: 108,
    bars: 4,
    notes: [{ midi: 60, startBeat: 0, durationBeats: 0.5, velocity: 96 }],
  },
});

const base = { description: "thunderous stab", sheet: "ok-bloom (Ensemble): strings", ip: "1.1.1.1" };

// A missing key must not look like a crash: the page needs a clear "not
// configured" so it can fall through to the offline mapper silently.
check("no key -> 503", (await designReply({ ...base, apiKey: "", fetchImpl: upstream(goodPatch) })).status, 503);
check(
  "empty description -> 400",
  (await designReply({ ...base, description: "   ", apiKey: "k", fetchImpl: upstream(goodPatch) })).status,
  400,
);

const ok = await designReply({ ...base, apiKey: "k", ip: "2.2.2.2", fetchImpl: upstream(goodPatch) });
check("valid -> 200", ok.status, 200);
check("valid -> carries patch", ok.json.patch?.layerA?.sampleId, "ok-bloom");
check("valid -> carries reply", typeof ok.json.reply, "string");

const phrase = await designReply({ ...base, description: "make a MIDI riff", apiKey: "k", ip: "2.3.2.2", fetchImpl: upstream(goodPhrase) });
check("phrase-only reply -> 200", phrase.status, 200);
check("phrase-only reply -> carries notes", phrase.json.phrase?.notes?.[0]?.midi, 60);

const fenced = await designReply({
  ...base,
  apiKey: "k",
  ip: "3.3.3.3",
  fetchImpl: upstream("Here you go!\n```json\n" + goodPatch + "\n```"),
});
check("fenced json -> 200", fenced.status, 200);
check("fenced json -> parsed", fenced.json.patch?.presetName, "THUNDER");

check(
  "prose only -> 502",
  (await designReply({ ...base, apiKey: "k", ip: "4.4.4.4", fetchImpl: upstream("I cannot do that") })).status,
  502,
);
check(
  "upstream error -> 502",
  (
    await designReply({
      ...base,
      apiKey: "k",
      ip: "5.5.5.5",
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    })
  ).status,
  502,
);
check(
  "upstream throws -> 502",
  (
    await designReply({
      ...base,
      apiKey: "k",
      ip: "6.6.6.6",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    })
  ).status,
  502,
);

// 12 allowed in the window, so the 13th from one IP is the first to be refused.
let last = 0;
for (let i = 0; i < 13; i += 1) {
  last = (await designReply({ ...base, apiKey: "k", ip: "9.9.9.9", fetchImpl: upstream(goodPatch) })).status;
}
check("13th call from one ip -> 429", last, 429);
check(
  "a different ip is unaffected",
  (await designReply({ ...base, apiKey: "k", ip: "8.8.8.8", fetchImpl: upstream(goodPatch) })).status,
  200,
);

console.log(failures ? `\n${failures} failing` : "\nall green");
process.exit(failures ? 1 : 0);
