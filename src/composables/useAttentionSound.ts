import { onUnmounted, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";

interface ActivityMsg {
  id: string;
  working?: boolean;
  waiting?: boolean;
}
interface ActivityState {
  working: boolean;
  waiting: boolean;
}
const isActivityMsg = (d: unknown): d is ActivityMsg => typeof d === "object" && d !== null && "id" in d;

// True when this activity push means the session now needs you: it just finished a
// turn (working true→false — Claude's Stop, published for every session) or it set
// `waiting` (a prompt/permission, published for background sessions). First sight is
// baseline only (no beep). Mutates `prev` to the latest state.
export function needsAttention(prev: Map<string, ActivityState>, msg: ActivityMsg): boolean {
  const now: ActivityState = { working: msg.working ?? false, waiting: msg.waiting ?? false };
  const was = prev.get(msg.id);
  prev.set(msg.id, now);
  if (!was) return false;
  const finishedTurn = was.working && !now.working;
  const becameWaiting = !was.waiting && now.waiting;
  return finishedTurn || becameWaiting;
}

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    return audioCtx;
  } catch {
    return null;
  }
}

// Autoplay policy: an AudioContext starts suspended until a user gesture, so a beep
// fired from an event (not a gesture) would be silent. Arm a one-shot listener that
// resumes the context on the first click/keypress anywhere; after that, beeps play.
let unlockArmed = false;
function armUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  const unlock = () => {
    const ctx = getCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

// A short two-note attention chime via Web Audio (no asset).
function playAttentionSound() {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const tone = (freq: number, start: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  try {
    tone(784, 0, 0.16); // G5
    tone(1047, 0.14, 0.22); // C6
  } catch {
    // no Web Audio — stay silent
  }
}

// The user's custom sound, decoded once into an AudioBuffer (keyed by its path so a
// settings change reloads it). The server streams the configured file at /api/sound;
// a 404 / decode failure leaves the buffer null and we use the chime.
let customBuffer: AudioBuffer | null = null;
let customLoadedFor: string | null = null;
let customLoading: Promise<void> | null = null;

function loadCustomSound(soundFile: string): Promise<void> {
  if (customLoadedFor === soundFile) return customLoading ?? Promise.resolve();
  customLoadedFor = soundFile;
  customBuffer = null;
  customLoading = (async () => {
    const ctx = getCtx();
    if (!ctx) return;
    let decoded: AudioBuffer | null = null;
    try {
      const res = await fetch(`/api/sound?v=${encodeURIComponent(soundFile)}`);
      if (res.ok) decoded = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      decoded = null; // unreadable / not audio — fall back to the chime
    }
    // Only assign if this is still the selected sound: a slower load for a now-stale
    // path (A→B switch) must not overwrite B's buffer.
    if (customLoadedFor === soundFile) customBuffer = decoded;
  })();
  return customLoading;
}

function playBuffer(buf: AudioBuffer) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.6;
  src.buffer = buf;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

// Play the attention sound: the user's custom file when configured AND already
// loaded, otherwise the built-in chime. A newly-configured file is loaded in the
// background, so the first beep uses the chime and later ones the custom sound.
export function playAttention(soundFile: string | null) {
  if (soundFile) {
    if (customLoadedFor !== soundFile) loadCustomSound(soundFile);
    if (customBuffer && customLoadedFor === soundFile) {
      playBuffer(customBuffer);
      return;
    }
  }
  playAttentionSound();
}

// Test-button variant: AWAIT the custom file's load so a just-configured sound is
// actually heard (the live beep path stays synchronous and chime-first).
export async function previewAttention(soundFile: string | null) {
  if (soundFile) {
    await loadCustomSound(soundFile);
    if (customBuffer && customLoadedFor === soundFile) {
      playBuffer(customBuffer);
      return;
    }
  }
  playAttentionSound();
}

// Beep when any session transitions into `waiting` (needs attention), across every
// page/view, by listening to the same "sessions" activity stream the cells use — so
// the beep tracks the amber header exactly. `enabled` gates it (the 🔔 toggle);
// `soundFile`, when set, plays the user's chosen file instead of the chime.
export function useAttentionSound(enabled: Ref<boolean>, soundFile?: Ref<string | null>) {
  armUnlock();
  // Preload the custom sound whenever it's set/changed, so the first beep can use it.
  if (soundFile) watch(soundFile, (f) => f && loadCustomSound(f), { immediate: true });
  const prev = new Map<string, ActivityState>();
  const { subscribe } = usePubSub();
  const unsubscribe = subscribe("sessions", (d) => {
    if (isActivityMsg(d) && needsAttention(prev, d) && enabled.value) playAttention(soundFile?.value ?? null);
  });
  onUnmounted(unsubscribe);
}
