// Fetches a terminal's resolved header (action buttons + display chips) from GET /api/header —
// the server merges global + per-dir config and substitutes this session's live context (branch,
// dirty, model, …). Re-fetches when the dir/session/agent change or the window regains focus, so
// ${branch}/${dirty} etc. stay current. `chips: null` means unconfigured (the client keeps its
// default header); an empty `buttons` array means nothing extra is shown.
import { ref, type Ref } from "vue";
import { useAutoRefresh } from "./useAutoRefresh";
import { headerConfigRevision } from "./headerConfigRevision";
import type { TerminalAgent } from "../../common/sessionAgent";
import { isRecord, optionalBoolean, optionalString } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import type { WorktreeEnvValue } from "../../common/worktreeEnv";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { remotePath } from "../../common/remoteHosts";
import { dirAddressOf } from "./dirAddress";

export interface OpenTarget {
  url?: string;
  reveal?: string;
  files?: string;
  view?: string;
  terminal?: string;
  pickFile?: boolean;
}
export interface HeaderButton {
  id: string;
  emoji?: string;
  icon?: string;
  label: string;
  run: "shell" | "input" | "open" | "action";
  // No `cmd`: a shell button's command stays server-side and is re-resolved by id at exec time.
  text?: string;
  open?: OpenTarget;
  // What a `run: "action"` button does to the cell it sits in (common/headerActions.ts). A plain string like
  // `open.view`, for the same reason: the server validates it against its own list, and an
  // unknown one reaches a dispatcher that acts on none of them.
  action?: string;
}
// A folder: one row-2 icon whose menu holds these buttons. The server never sends an empty one.
export interface HeaderFolder {
  id: string;
  emoji?: string;
  icon?: string;
  label: string;
  items: HeaderButton[];
}
export type HeaderEntry = HeaderButton | HeaderFolder;
export const isHeaderFolder = (entry: HeaderEntry): entry is HeaderFolder => "items" in entry;
export type ResolvedChip = { kind: "builtin"; id: string } | { kind: "custom"; label: string; text: string };

// The header arrives off /api/header, so a button becomes one only once the fields the header
// RENDERS and ACTS on are there: `label` is drawn, `id` re-resolves the command server-side at
// exec time, and `run` decides what pressing it does. A button missing one of those would draw
// blank or do nothing, which is worse than not offering it.
const isHeaderButton = (value: unknown): value is HeaderButton =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.label === "string" &&
  (value.run === "shell" || value.run === "input" || value.run === "open" || value.run === "action") &&
  optionalString(value.emoji) &&
  optionalString(value.icon) &&
  optionalString(value.text) &&
  optionalString(value.action) &&
  // `open` is nested and IS read — hasPickFileButton reaches into `open.pickFile`.
  (value.open === undefined || isOpenTarget(value.open));

// A folder keeps only the children that pass as buttons, and is dropped if none do — the same
// "would draw blank or do nothing" rule, applied to a menu that would open empty.
function toHeaderFolder(value: unknown): HeaderFolder | null {
  if (!isRecord(value) || !isUnknownArray(value.items)) return null;
  if (typeof value.id !== "string" || typeof value.label !== "string") return null;
  if (!optionalString(value.emoji) || !optionalString(value.icon)) return null;
  const items = value.items.filter(isHeaderButton);
  if (items.length === 0) return null;
  const folder: HeaderFolder = { id: value.id, label: value.label, items };
  if (typeof value.emoji === "string") folder.emoji = value.emoji;
  if (typeof value.icon === "string") folder.icon = value.icon;
  return folder;
}

const toHeaderEntries = (values: unknown[]): HeaderEntry[] =>
  values.flatMap((value): HeaderEntry[] => {
    if (isHeaderButton(value)) return [value];
    const folder = toHeaderFolder(value);
    return folder ? [folder] : [];
  });

const isOpenTarget = (value: unknown): value is OpenTarget =>
  isRecord(value) &&
  optionalString(value.url) &&
  optionalString(value.reveal) &&
  optionalString(value.files) &&
  optionalString(value.view) &&
  optionalString(value.terminal) &&
  optionalBoolean(value.pickFile);

const isResolvedChip = (value: unknown): value is ResolvedChip =>
  isRecord(value) &&
  ((value.kind === "builtin" && typeof value.id === "string") ||
    (value.kind === "custom" && typeof value.label === "string" && typeof value.text === "string"));

// A reserved per-tree value (#1367). `url` is what makes a port a link, so it is checked as
// carefully as the value itself — a non-string there would be rendered into an href.
const isWorktreeEnvValue = (value: unknown): value is WorktreeEnvValue =>
  isRecord(value) && typeof value.name === "string" && typeof value.value === "string" && (value.url === null || typeof value.url === "string");

// Whether the resolved header offers a file-path picker (an `open` button with `pickFile`), at the
// top level or inside a folder. Header buttons are user-configurable and no picker ships by default,
// so anything that points the user at "the file-picker button" must first confirm it is present.
export function hasPickFileButton(entries: readonly HeaderEntry[]): boolean {
  return entries.flatMap((e) => (isHeaderFolder(e) ? e.items : [e])).some((b) => b.run === "open" && b.open?.pickFile === true);
}

interface Params {
  cwd: Ref<string | null>;
  session: Ref<string | null>;
  agent: Ref<TerminalAgent>;
  model?: Ref<string | null>;
}

export function useHeaderButtons(params: Params) {
  const buttons = ref<HeaderEntry[]>([]);
  // The command palette's own entries (#2465), shaped and checked like the buttons.
  const commands = ref<HeaderEntry[]>([]);
  const chips = ref<ResolvedChip[] | null>(null);
  const env = ref<WorktreeEnvValue[]>([]);
  let requestSeq = 0;

  async function refresh(): Promise<void> {
    const cwd = params.cwd.value;
    if (!cwd) {
      buttons.value = [];
      commands.value = [];
      chips.value = null;
      env.value = [];
      return;
    }
    // `cwd` is a directory key (dirAddress.ts): a remote one asks its host, about its own session.
    const { host, cwd: dir } = dirAddressOf(cwd);
    const query = new URLSearchParams({ cwd: dir, agent: params.agent.value });
    if (params.session.value) query.set("session", params.session.value);
    if (params.model?.value) query.set("model", params.model.value);
    const seq = ++requestSeq;
    try {
      const res = await fetchWithTimeout(`${host === null ? "/api/header" : remotePath(host, "/api/header")}?${query.toString()}`);
      if (seq !== requestSeq) return;
      const data = res.ok ? await jsonBody(res) : {};
      if (seq !== requestSeq) return;
      buttons.value = isUnknownArray(data.buttons) ? toHeaderEntries(data.buttons) : [];
      commands.value = isUnknownArray(data.commands) ? toHeaderEntries(data.commands) : [];
      chips.value = isUnknownArray(data.chips) ? data.chips.filter(isResolvedChip) : null;
      env.value = isUnknownArray(data.env) ? data.env.filter(isWorktreeEnvValue) : [];
    } catch {
      if (seq === requestSeq) {
        buttons.value = [];
        commands.value = [];
        chips.value = null;
        env.value = [];
      }
    }
  }

  useAutoRefresh(refresh, [params.cwd, params.session, params.agent, () => params.model?.value, () => headerConfigRevision.value]);

  return { buttons, commands, chips, env, refresh };
}
