import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LaunchAgentPicker from "../../../src/components/LaunchAgentPicker.vue";
import { launchAgent } from "../../../src/composables/useChatLauncher";

// `launchAgent` is a module singleton with a localStorage watcher behind it. Restored in an
// afterEach rather than at the end of each test: an assertion that throws would otherwise leave
// the next test running as muse and failing for the wrong reason.
afterEach(() => {
  launchAgent.value = "claude";
});

const PICKER = '[data-testid="launch-agent-picker"]';

describe("LaunchAgentPicker", () => {
  // The rule the agent badges already follow (common/sessionAgent.ts): claude is the default
  // everywhere, so marking it would put a chip on every pane and stop the chip meaning "this one
  // is not what you expect".
  it("renders nothing on a non-default-only surface while the agent is the default", () => {
    const w = mount(LaunchAgentPicker, { props: { nonDefaultOnly: true, description: "which agent" } });
    expect(w.find(PICKER).exists()).toBe(false);
  });

  it("appears on a non-default-only surface as soon as the agent is not claude", async () => {
    launchAgent.value = "muse";
    const w = mount(LaunchAgentPicker, { props: { nonDefaultOnly: true, description: "which agent" } });
    await flushPromises();
    expect(w.find(PICKER).exists()).toBe(true);
    expect((w.get("select").element as HTMLSelectElement).value).toBe("muse");
  });

  // The surface that OWNS the choice does not pass the flag, and must not: a control that hides
  // itself whenever it holds its default can never be used to leave that default.
  it("stays on a surface that did not ask for the non-default-only rule, even as claude", () => {
    const w = mount(LaunchAgentPicker, { props: { description: "which agent" } });
    expect(w.find(PICKER).exists()).toBe(true);
    expect((w.get("select").element as HTMLSelectElement).value).toBe("claude");
  });

  it("writes the choice through to the shared value and to localStorage", async () => {
    const w = mount(LaunchAgentPicker, { props: { description: "which agent" } });
    await w.get("select").setValue("codex");
    await flushPromises();
    expect(launchAgent.value).toBe("codex");
    expect(localStorage.getItem("mt-launch-agent")).toBe("codex");
  });

  // The primary interaction on a non-default-only surface is choosing Claude — which is exactly the
  // value that stops the control qualifying to exist. Unmounting it under the pointer drops a
  // keyboard user on <body> mid-gesture, so it stays until focus actually leaves.
  it("stays put while it holds focus, even once the value is back to the default", async () => {
    launchAgent.value = "muse";
    const w = mount(LaunchAgentPicker, { props: { nonDefaultOnly: true, description: "which agent" } });
    await flushPromises();
    await w.get(PICKER).trigger("focusin");
    await w.get("select").setValue("claude");
    await flushPromises();
    expect(w.find(PICKER).exists()).toBe(true);

    // And stands down as soon as focus leaves for good — which is when the user asked it to.
    await w.get(PICKER).trigger("focusout");
    await flushPromises();
    expect(w.find(PICKER).exists()).toBe(false);
  });

  it("offers every agent a seeded chat can run, and no shell", () => {
    const w = mount(LaunchAgentPicker, { props: { description: "which agent" } });
    const values = w.findAll("option").map((o) => o.attributes("value"));
    expect(values).toEqual(["claude", "codex", "antigravity", "grok", "muse", "copilot", "cursor"]);
  });

  // Two shapes, one accessible name. With words on screen the <label> supplies it; without them
  // (a pane too narrow to spend 60px on it) the description has to reach the select itself.
  it("names the select through its visible label when there is one", () => {
    const w = mount(LaunchAgentPicker, { props: { label: "Launch with", description: "which agent" } });
    expect(w.get(PICKER).text()).toContain("Launch with");
    expect(w.get("select").attributes("aria-label")).toBeUndefined();
  });

  it("names the select with the description when the label is an icon", () => {
    const w = mount(LaunchAgentPicker, { props: { description: "which agent" } });
    expect(w.get("select").attributes("aria-label")).toBe("which agent");
    expect(w.get(".material-symbols-outlined").attributes("aria-hidden")).toBe("true");
  });
});
