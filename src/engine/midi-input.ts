import { patchState } from "../store";
import { playHuman, releaseHuman } from "./perform";
import { setSustain } from "./audio";
import { shiftNoteOff, shiftNoteOn, useDevice } from "./midi-octave";

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
      const device = inputs[0]?.name ?? null;
      patchState({ midiDevice: device ?? "No controller" });
      useDevice(device);
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
          // Shifted at the boundary, so the key that lights, the pitch that
          // sounds and the note that gets graded all agree, whatever register
          // the controller's octave buttons have it in.
          if (command === 0x90 && velocity > 0) playHuman(shiftNoteOn(note), velocity);
          else if (command === 0x80 || (command === 0x90 && velocity === 0)) releaseHuman(shiftNoteOff(note));
        };
      });
    };
    bind();
    access.onstatechange = () => bind();
  } catch {
    patchState({ midiDevice: "MIDI permission denied" });
  }
};
