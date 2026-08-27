/** Exercise the MiniMax proxy shape without spending a real generation request. */
import { musicReply } from "../src/server/music.js";

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : `  (got ${actual}, wanted ${expected})`}`);
};

const upstream = (payload, ok = true) => async () => ({ ok, json: async () => payload });
const base = { prompt: "Bright cinematic instrumental piano", model: "music-3.0-free", ip: "1.1.1.1" };
const good = { data: { audio: "https://example.com/generated.mp3" }, base_resp: { status_code: 0 } };

check("no key -> 503", (await musicReply({ ...base, apiKey: "", fetchImpl: upstream(good) })).status, 503);
check("empty prompt -> 400", (await musicReply({ ...base, prompt: " ", apiKey: "k", fetchImpl: upstream(good) })).status, 400);

const valid = await musicReply({ ...base, apiKey: "k", ip: "2.2.2.2", fetchImpl: upstream(good) });
check("valid -> 200", valid.status, 200);
check("valid -> returns audio URL", valid.json.audioUrl, "https://example.com/generated.mp3");
check(
  "non-https audio -> 502",
  (await musicReply({ ...base, apiKey: "k", ip: "3.3.3.3", fetchImpl: upstream({ data: { audio: "http://bad.test/a.mp3" } }) })).status,
  502,
);
check(
  "upstream error -> 502",
  (await musicReply({ ...base, apiKey: "k", ip: "4.4.4.4", fetchImpl: upstream({}, false) })).status,
  502,
);

console.log(failures ? `\n${failures} failing` : "\nall green");
process.exit(failures ? 1 : 0);
