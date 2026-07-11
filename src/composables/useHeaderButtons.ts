// Fetches a terminal's resolved header (action buttons + display chips) from GET /api/header —
// the server merges global + per-dir config and substitutes this session's live context (branch,
// dirty, model, …). Re-fetches when the dir/session/agent change or the window regains focus, so
// ${branch}/${dirty} etc. stay current. `chips: null` means unconfigured (the client keeps its
// default header); an empty `buttons` array means nothing extra is shown.
import { ref, watch, onMounted, onBeforeUnmount, type Ref } from "vue";

export interface OpenTarget {
  url?: string;
  reveal?: string;
  files?: string;
  view?: string;
  pickFile?: boolean;
}
export interface HeaderButton {
  id: string;
  emoji?: string;
  icon?: string;
  label: string;
  run: "shell" | "input" | "open";
  // No `cmd`: a shell button's command stays server-side and is re-resolved by id at exec time.
  text?: string;
  open?: OpenTarget;
}
export type ResolvedChip = { kind: "builtin"; id: string } | { kind: "custom"; label: string; text: string };

interface Params {
  cwd: Ref<string | null>;
  session: Ref<string | null>;
  agent: Ref<"claude" | "codex">;
  model?: Ref<string | null>;
}

export function useHeaderButtons(params: Params) {
  const buttons = ref<HeaderButton[]>([]);
  const chips = ref<ResolvedChip[] | null>(null);
  let requestSeq = 0;

  async function refresh(): Promise<void> {
    const cwd = params.cwd.value;
    if (!cwd) {
      buttons.value = [];
      chips.value = null;
      return;
    }
    const query = new URLSearchParams({ cwd, agent: params.agent.value });
    if (params.session.value) query.set("session", params.session.value);
    if (params.model?.value) query.set("model", params.model.value);
    const seq = ++requestSeq;
    try {
      const res = await fetch(`/api/header?${query.toString()}`);
      if (seq !== requestSeq) return;
      const data = res.ok ? await res.json() : { buttons: [], chips: null };
      if (seq !== requestSeq) return;
      buttons.value = Array.isArray(data.buttons) ? data.buttons : [];
      chips.value = Array.isArray(data.chips) ? data.chips : null;
    } catch {
      if (seq === requestSeq) {
        buttons.value = [];
        chips.value = null;
      }
    }
  }

  const onFocus = () => void refresh();
  onMounted(() => {
    void refresh();
    window.addEventListener("focus", onFocus);
  });
  onBeforeUnmount(() => window.removeEventListener("focus", onFocus));
  watch([params.cwd, params.session, params.agent, () => params.model?.value], () => void refresh());

  return { buttons, chips, refresh };
}
