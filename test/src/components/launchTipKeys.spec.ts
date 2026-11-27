// The launch form's hover tips and aria-labels are translated (#2408); see tipCensus.ts.
import { describe, it, expect } from "vitest";
import { describeTipSurface } from "./tipCensus";
import { i18n } from "../../../src/i18n";
import { UI_LOCALES } from "../../../src/composables/uiLanguage";
import { agentPickerOptions } from "../../../src/components/agentPicker";
import CellLaunchFormSource from "../../../src/components/CellLaunchForm.vue?raw";
import ChatModalAgentPickerSource from "../../../src/components/ChatModalAgentPicker.vue?raw";
import agentPickerSource from "../../../src/components/agentPicker.ts?raw";
import RemoteHostPickerSource from "../../../src/components/RemoteHostPicker.vue?raw";
import RemoteLaunchFormSource from "../../../src/components/RemoteLaunchForm.vue?raw";
import RemoteWorktreesSource from "../../../src/components/RemoteWorktrees.vue?raw";

// The surface this section covers. A file added to the launch form belongs here too.
describeTipSurface("launch", {
  "CellLaunchForm.vue": CellLaunchFormSource,
  "ChatModalAgentPicker.vue": ChatModalAgentPickerSource,
  "agentPicker.ts": agentPickerSource,
  "RemoteHostPicker.vue": RemoteHostPickerSource,
  "RemoteLaunchForm.vue": RemoteLaunchFormSource,
  "RemoteWorktrees.vue": RemoteWorktreesSource,
});

// agentPicker.ts has no i18n of its own, so it hands the form a key and the command; the hover is
// only useful if every language still shows which binary the click runs.
describe("a custom agent's hover", () => {
  const command = "ollama launch claude --model nemotron-3-ultra:cloud --";
  const tip = agentPickerOptions([{ id: "nemotron", label: "Nemotron", agent: "claude", command }]).find((o) => o.agent === "custom:nemotron")?.tip;

  it.each(UI_LOCALES.map((locale) => locale.code))("names the command in %s", (locale) => {
    expect(tip).toBeDefined();
    expect(i18n.global.t(tip?.key ?? "", { ...tip }, { locale })).toContain(command);
  });
});
