# KEYBED — knowledge brief

Original browser instrument in this repo. Inspired by public product pages, not a clone.

## Sources

- [RAV3](https://theproducerschool.com/products/rav3) — dual-layer rompler, LCD pages, ADSR, 5-stage FX
- [Drum Monkey](https://page.unison.audio/dm-special/) — generate, lock, piano roll, MIDI/audio export
- [WebMCP](https://github.com/webmachinelearning/webmcp) — `document.modelContext` tools for in-page agents
- [Ideal-Piano](https://github.com/Rainbow-Dreamer/Ideal-Piano) — computer + MIDI keyboard, SoundFont / audio instruments, live chord view
- [Free MIDI keyboard software](https://midination.com/keyboards/free-midi-keyboard-software/) — hosts (DAWs, piano apps) supply the sound; a MIDI controller does not

## What we took (patterns only)

| Pattern | From | In KEYBED |
|---|---|---|
| Dual sample layers A/B + mix | RAV3 | `set-layer`, VOL A/B |
| Browse vs Envelope screens | RAV3 | LCD pages |
| Filter → Dist → Crush → Delay → Reverb | RAV3 | FX knobs + `set-fx` |
| Style + 1-click generate + lock | Drum Monkey | `generate-phrase`, `lock-layer` |
| Piano roll + export MIDI | Drum Monkey | phrase buffer + `export-midi` |
| Agent tools on the live page | WebMCP | `src/webmcp` + Studio Agent |
| SoundFont + audio instruments | Ideal-Piano | `smplr` rompler: Steinway, CP80, Wurlitzer, GM |
| Controller is not the instrument | MIDINation / APC Key 25 | Web MIDI in + sampled output + sustain CC64 |

## Design refs (do not ship as our UI)

- `docs/design-refs/rav3/` — official RAV3 rack / LCD
- `docs/design-refs/drum-monkey/` — review screenshots of pads + sequencer

## Legal

No RAV3, Unison, Roland, Yamaha, or Akai preset banks. Factory keys use open sample sets via [smplr](https://github.com/danigb/smplr) (Splendid Grand, Gleitz GM soundfonts, Greg Sullivan E-Pianos). User imports stay local. Ideal-Piano is LGPL — we used the approach, not their code.

## Why a Roland / Yamaha / APC Key 25 needs this

An [Akai APC Key 25 MKII](https://www.akaipro.com/apc-key-25-mkii) is a MIDI controller. It sends note and CC messages; it does not contain a piano engine. The same is true of many Roland and Yamaha controllers. Ideal-Piano and the apps on MIDINation all load **real samples or SoundFonts** (or a DAW instrument). KEYBED is that host in the browser:

1. Load multi-velocity piano / EP samples (`src/engine/rompler.ts`)
2. Play them from QWERTY, on-screen keys, or Web MIDI
3. Honor sustain (CC 64) like a hardware pedal
4. Keep FX / generate / WebMCP on the same live instrument
