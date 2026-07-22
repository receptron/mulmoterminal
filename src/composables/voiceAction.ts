// What pressing the mic button should do, given what the voice input is currently doing.
//
// One button with four possible meanings, and the guard that matters is the last one: an
// impatient user pressing a button that already looks like it is doing nothing must not
// re-POST the model download on every click.

export interface VoiceState {
  // A capture is running — the press ends it.
  listening: boolean;
  // The model is present and the platform supports it.
  available: boolean;
  // A download is already running.
  downloading: boolean;
}

export type VoiceAction = "stop" | "start" | "download" | "none";

export function voiceAction({ listening, available, downloading }: VoiceState): VoiceAction {
  if (listening) return "stop";
  if (available) return "start";
  return downloading ? "none" : "download";
}

export interface VoiceModelStatus {
  capable?: boolean;
  model?: { state?: string };
}

// Ready means BOTH halves: a platform that can run it and a model that finished downloading.
// Optional chaining throughout so a malformed status degrades to "not ready" rather than
// throwing inside the poll that produced it.
export function modelReadiness(status: VoiceModelStatus | null | undefined): { ready: boolean; downloading: boolean } {
  return { ready: status?.capable === true && status?.model?.state === "ready", downloading: status?.model?.state === "downloading" };
}
