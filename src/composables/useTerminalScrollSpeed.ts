import { ref } from "vue";
import {
  normalizeScrollSpeed,
  TERMINAL_SCROLL_SPEED_DEFAULT,
  TERMINAL_SCROLL_SPEED_MAX,
  TERMINAL_SCROLL_SPEED_MIN,
  TERMINAL_SCROLL_SPEED_STEP,
} from "../../common/terminalScrollSpeed";

// The app-wide terminal scroll speed, as a multiplier (1 = xterm's own). Kept in localStorage
// rather than config.json for the same reason the font SIZE is: it is a property of the device
// doing the scrolling, not of the host — a laptop trackpad and a wheel mouse pointed at the same
// server want different answers, which one shared value can't express.
const STORAGE_KEY = "terminalScrollSpeed";

// Storage access can throw (private mode / storage-blocked contexts), so reading is best-effort.
function loadScrollSpeed(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Blank is screened out before Number(), which would read "" as 0 and clamp to the minimum
    // — the trap the font size already fell into. Blank means unset, like any unusable value.
    return normalizeScrollSpeed(stored?.trim() ? Number(stored) : null) ?? TERMINAL_SCROLL_SPEED_DEFAULT;
  } catch {
    return TERMINAL_SCROLL_SPEED_DEFAULT;
  }
}

const scrollSpeed = ref<number>(loadScrollSpeed());

// The plain read, for the wheel handler: it runs per wheel event outside any component, so it
// wants the current number, not a ref to track.
export const getTerminalScrollSpeed = (): number => scrollSpeed.value;

export function useTerminalScrollSpeed() {
  function setScrollSpeed(next: number) {
    const speed = normalizeScrollSpeed(next);
    if (speed === null) return;
    scrollSpeed.value = speed;
    try {
      localStorage.setItem(STORAGE_KEY, String(speed));
    } catch {
      // storage blocked: the speed still applies for this session, just isn't persisted
    }
  }
  const nudgeScrollSpeed = (delta: number) => setScrollSpeed(scrollSpeed.value + delta);
  return {
    scrollSpeed,
    setScrollSpeed,
    nudgeScrollSpeed,
    min: TERMINAL_SCROLL_SPEED_MIN,
    max: TERMINAL_SCROLL_SPEED_MAX,
    step: TERMINAL_SCROLL_SPEED_STEP,
  };
}
