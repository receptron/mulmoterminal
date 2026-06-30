import { onMounted, onUnmounted, ref } from "vue";

// How many live terminals each view reports, keyed by source ("single", "grid").
// Keyed — not a single shared counter — because persistent connections mean the
// single view's PTY and the grid's PTYs can be alive AT THE SAME TIME: switching
// from the single view to the grid no longer closes the single socket. A single
// overwritten ref would let whichever view mounted last hide the other's live
// terminals from the close warning. Each source keeps its last reported count until
// its own view updates it, which mirrors the connections actually staying alive.
const counts = ref(new Map<string, number>());

export function reportActiveTerminals(source: string, count: number): void {
  counts.value.set(source, count);
  // Reassign to trip reactivity (Map mutation alone isn't tracked by a plain ref).
  counts.value = new Map(counts.value);
}

function totalActive(): number {
  let total = 0;
  for (const n of counts.value.values()) total += n;
  return total;
}

// Suppress the guard for the NEXT unload only — for reloads WE initiate, where the
// session isn't being lost by accident. The flag is one-shot: the handler consumes
// it, so it can never linger and silence a later genuine close.
let skipNextUnload = false;
export function suppressNextUnloadGuard(): void {
  skipNextUnload = true;
}

// Vite does a full page reload when source it can't hot-swap changes. That fires
// beforeunload like any close would, so without this the guard would prompt on every
// save during development. Vite emits `vite:beforeFullReload` just before it reloads,
// so we suppress the imminent prompt for that one unload. `import.meta.hot` is
// undefined in production, so this branch tree-shakes away — prod prompts on every
// real close as before.
if (import.meta.hot) {
  import.meta.hot.on("vite:beforeFullReload", suppressNextUnloadGuard);
}

// Warn before the tab closes / reloads / navigates away while a terminal is live,
// so an accidental close doesn't drop sessions (an idle PTY is reaped shortly after
// the socket closes; a working one keeps going, but either way the live view is
// lost). With nothing running, the page closes without a prompt. Install once at the
// app root. The browser shows its own generic confirm dialog — the message text is
// fixed by the browser and can't be customised.
export function useUnloadGuard(): void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (skipNextUnload) {
      skipNextUnload = false; // one-shot: consume so it never silences a later close
      return; // a reload we initiated (e.g. Vite HMR) — see suppressNextUnloadGuard
    }
    if (totalActive() <= 0) return;
    e.preventDefault();
    e.returnValue = ""; // legacy Chrome/Edge still need returnValue assigned to prompt
  };
  onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
  onUnmounted(() => window.removeEventListener("beforeunload", onBeforeUnload));
}
