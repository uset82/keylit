/* ---- voice ----
   Two halves that are worth very different amounts.

   Speaking is the valuable one: no device offers it, support is broad, and it is what
   lets a child watch the keys instead of reading a line that scrolled off the top.

   Listening is the opposite. Every phone and tablet keyboard already has a dictation
   mic that types into the field for free, with no permission prompt from us. In-page
   recognition is behind a flag in Firefox and fails silently on iOS once audio has
   played, which a synthesiser holding a permanent AudioContext does constantly. So the
   mic only appears where it beats what the device already does. */

const VOICE_KEY = "keylit.voice";

const readSpeak = (): boolean => {
  try {
    return window.localStorage.getItem(VOICE_KEY) === "on";
  } catch {
    // Private mode or a blocked origin: start silent rather than crash.
    return false;
  }
};

const writeSpeak = (on: boolean): void => {
  try {
    window.localStorage.setItem(VOICE_KEY, on ? "on" : "off");
  } catch {
    /* nothing to persist to */
  }
};

const canSpeak = (): boolean => "speechSynthesis" in window;

/**
 * iOS stays mute unless the first utterance is queued inside a user gesture, so the one
 * gesture that arms audio arms the voice with it.
 */
export const primeSpeech = (): void => {
  if (!canSpeak()) return;
  const silent = new SpeechSynthesisUtterance(" ");
  silent.volume = 0;
  window.speechSynthesis.speak(silent);
};

const speak = (line: string): void => {
  const text = line.trim();
  if (!text) return;
  // A fast player earns the next instruction before the last one finishes reading, and
  // only the newest one is any use.
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
};

const mountSpeaker = (): void => {
  const button = document.querySelector<HTMLButtonElement>("#voice-speak");
  const coach = document.querySelector<HTMLElement>("#lesson-coach");
  if (!button || !coach) return;
  if (!canSpeak()) {
    button.remove();
    return;
  }

  let on = readSpeak();
  const paint = (): void => {
    button.classList.toggle("live", on);
    button.setAttribute("aria-pressed", String(on));
  };
  paint();

  button.addEventListener("click", () => {
    on = !on;
    writeSpeak(on);
    paint();
    if (!on) {
      window.speechSynthesis.cancel();
      return;
    }
    // This click is a user gesture, which is the only moment iOS will accept.
    primeSpeech();
    speak(coach.textContent ?? "");
  });

  // updateView writes #lesson-coach only when the text actually differs, so every
  // mutation here is a new instruction rather than a repaint. Without that guard this
  // would re-read the same sentence on every key press.
  const observer = new MutationObserver(() => {
    if (on) speak(coach.textContent ?? "");
  });
  observer.observe(coach, { childList: true, characterData: true, subtree: true });
};

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };

type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | null => {
  const scope = window as Window & {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
};

/**
 * iPadOS reports itself as a Mac, so the touch-point count is what separates a tablet
 * from a desktop Safari, where recognition behaves.
 */
const isApplePortable = (): boolean =>
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const mountMic = (): void => {
  const button = document.querySelector<HTMLButtonElement>("#voice-mic");
  const field = document.querySelector<HTMLInputElement>("#agent-input");
  const form = document.querySelector<HTMLFormElement>("#agent-form");
  if (!button || !field || !form) return;

  const Ctor = recognitionCtor();
  if (!Ctor || isApplePortable()) {
    button.remove();
    return;
  }

  const recognition = new Ctor();
  recognition.lang = navigator.language || "en-US";
  // Leaving the mic open would let the piano coming out of the speakers feed itself.
  recognition.continuous = false;
  recognition.interimResults = true;

  let listening = false;
  let watchdog = 0;

  const paint = (): void => {
    button.classList.toggle("live", listening);
    button.setAttribute("aria-pressed", String(listening));
  };

  const stop = (): void => {
    listening = false;
    window.clearTimeout(watchdog);
    paint();
  };

  recognition.onresult = (event) => {
    let text = "";
    let final = false;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      text += result[0].transcript;
      if (result.isFinal) final = true;
    }
    field.value = text.trim();
    if (!final || !field.value) return;
    stop();
    recognition.abort();
    form.requestSubmit();
  };
  recognition.onerror = stop;
  recognition.onend = stop;

  button.addEventListener("click", () => {
    if (listening) {
      recognition.abort();
      stop();
      return;
    }
    // The teacher talking over the top is the quickest way to dictate its own words back.
    if (canSpeak()) window.speechSynthesis.cancel();
    field.value = "";
    try {
      recognition.start();
    } catch {
      // Already running, or the mic was refused. Leave the button idle to try again.
      return;
    }
    listening = true;
    paint();
    // Recognition can die without firing onend, which would strand the button mid-listen.
    watchdog = window.setTimeout(stop, 12000);
  });
};

export const mountVoice = (): void => {
  mountSpeaker();
  mountMic();
};
