/// <reference types="vite/client" />

interface Navigator {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccess>;
}

interface MIDIAccess extends EventTarget {
  inputs: Map<string, MIDIInput>;
  onstatechange: ((event: Event) => void) | null;
}

interface MIDIInput extends EventTarget {
  id: string;
  name?: string;
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
}

interface MIDIMessageEvent extends Event {
  data: Uint8Array;
}
