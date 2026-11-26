// The palette's side of the prompt rows (#2523): the acting terminal's prompt history, read the
// way the Prompts pane reads it, each time the palette opens.
import { ref, watch } from "vue";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { readPrompt } from "../../common/promptHistory";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { transcriptPath } from "../components/remoteCell";
import { palettePrompts, type PalettePrompt, type PalettePromptSource } from "./palettePrompts";

async function readHistory(source: PalettePromptSource): Promise<PalettePrompt[]> {
  const { session, agent, cwd, host } = source;
  const params = new URLSearchParams({ session, agent });
  if (cwd) params.set("cwd", cwd);
  const url = transcriptPath(host, "prompts", params);
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const body = await jsonBody(res);
  const rows = isRecord(body) && isUnknownArray(body.prompts) ? body.prompts : [];
  return palettePrompts(
    rows.flatMap((row) => readPrompt(row) ?? []),
    source,
  );
}

// Everything the read is asked with, as the Prompts pane watches it: the cwd too.
const sourceKey = (source: PalettePromptSource | null): string =>
  source ? [source.slotKey, source.session, source.agent, source.cwd ?? "", source.host ?? ""].join("\n") : "";

export function usePalettePrompts(source: () => PalettePromptSource | null) {
  const prompts = ref<PalettePrompt[]>([]);
  // Bumped per read, so the history of a terminal you have moved off cannot land under the next one.
  let newest = 0;
  watch(
    () => sourceKey(source()),
    async () => {
      const read = ++newest;
      prompts.value = [];
      const from = source();
      if (!from) return;
      try {
        const history = await readHistory(from);
        if (read === newest) prompts.value = history;
      } catch {
        if (read === newest) prompts.value = [];
      }
    },
    { immediate: true },
  );
  return { prompts };
}
