import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ChatModalAgentPicker from "../../../src/components/ChatModalAgentPicker.vue";
import { launchAgent } from "../../../src/composables/useChatLauncher";

// A module singleton with a localStorage watcher behind it. Restored here rather than at the end
// of each test: an assertion that throws would otherwise leave the next one running as muse.
afterEach(() => {
  launchAgent.value = "claude";
});

const PICKER = '[data-testid="chat-modal-agent-picker"]';

describe("ChatModalAgentPicker", () => {
  it("writes the choice through to the shared value and to localStorage", async () => {
    const w = mount(ChatModalAgentPicker);
    await w.get("select").setValue("muse");
    await flushPromises();
    expect(launchAgent.value).toBe("muse");
    expect(localStorage.getItem("mt-launch-agent")).toBe("muse");
  });

  // Unlike the pane's chip, which marks only a surprising answer. The modal exists to start a
  // chat, so what it starts as is the subject — the call SkillLaunchConfirm makes.
  it("shows itself even when the agent is the default", () => {
    const w = mount(ChatModalAgentPicker);
    expect(w.find(PICKER).exists()).toBe(true);
    expect((w.get("select").element as HTMLSelectElement).value).toBe("claude");
  });

  it("offers every agent a seeded chat can run, and no shell", () => {
    const w = mount(ChatModalAgentPicker);
    expect(w.findAll("option").map((o) => o.attributes("value"))).toEqual(["claude", "codex", "antigravity", "grok", "muse", "copilot", "cursor"]);
  });
});
