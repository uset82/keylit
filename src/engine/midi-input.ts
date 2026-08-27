import { patchState } from "../store";
import { playHuman, releaseHuman } from "./perform";
import { setSustain } from "./audio";

type MidiPort = {
  name?: string;
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
};

export const connectMidi = async (): Promise<void> => {
  if (!navigator.requestMIDIAccess) {
    patchState({ midiDevice: "Web MIDI unavailable" });
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const bind = (): void => {
      const inputs = [...access.inputs.values()] as MidiPort[];
      patchState({ midiDevice: inputs[0]?.name ?? "No controller" });
      inputs.forEach((input) => {
        input.onmidimessage = (event) => {
          const status = event.data[0] ?? 0;
          const note = event.data[1] ?? 0;
          const velocity = event.data[2] ?? 0;
          const command = status & 0xf0;
          if (command === 0xb0 && note === 64) {
            setSustain(velocity >= 64);
            return;
          }
          if (command === 0x90 && velocity > 0) playHuman(note, velocity);
          else if (command === 0x80 || (command === 0x90 && velocity === 0)) releaseHuman(note);
        };
      });
    };
    bind();
    access.onstatechange = () => bind();
  } catch {
    patchState({ midiDevice: "MIDI permission denied" });
  }
};
