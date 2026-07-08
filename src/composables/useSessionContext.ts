// Fetches a session's running model + current-turn context size from /api/session/:id.
// Used where only the model/context is needed (e.g. header `${model}` substitution). Components that
// also need live activity/usage (TerminalCell) fetch the same endpoint alongside those concerns.
import { ref, watch, onMounted, onBeforeUnmount, type Ref } from "vue";

export interface SessionContext {
  model: string | null;
  contextTokens: number;
}

const isContext = (c: unknown): c is SessionContext => typeof c === "object" && c !== null && "contextTokens" in c;

export function useSessionContext(sessionId: Ref<string | null>, cwd: Ref<string | null>) {
  const context = ref<SessionContext | null>(null);
  let requestSeq = 0;

  async function refresh(): Promise<void> {
    const id = sessionId.value;
    if (!id) {
      context.value = null;
      return;
    }
    const query = cwd.value ? `?cwd=${encodeURIComponent(cwd.value)}` : "";
    const seq = ++requestSeq;
    try {
      const res = await fetch(`/api/session/${id}${query}`);
      if (seq !== requestSeq || !res.ok) return;
      const data = await res.json();
      // Guard against a stale response: the terminal may have switched session mid-flight.
      if (seq === requestSeq && id === sessionId.value && isContext(data.context)) context.value = data.context;
    } catch {
      // best-effort — `${model}` just renders empty until a later fetch succeeds
    }
  }

  const onFocus = () => void refresh();
  onMounted(() => {
    void refresh();
    window.addEventListener("focus", onFocus);
  });
  onBeforeUnmount(() => window.removeEventListener("focus", onFocus));
  watch([sessionId, cwd], () => void refresh());

  return { context, refresh };
}
