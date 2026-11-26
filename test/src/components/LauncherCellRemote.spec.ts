// A shell cell on a remote host (#3506) that is no longer configured shows why, instead of a terminal
// whose socket the gateway refuses on every retry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LauncherCell from "../../../src/components/LauncherCell.vue";
import { resetConfiguredRemoteHosts } from "../../../src/composables/configuredRemoteHosts";

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: { name: "TerminalView", props: ["remoteHost"], emits: ["session", "exit"], template: '<div class="stub-term" />' },
}));

let configuredIds: string[] = [];
beforeEach(() => {
  resetConfiguredRemoteHosts();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ids: configuredIds }) })) as unknown as typeof fetch;
});

const mountShell = async (remoteHost: string) => {
  const w = mount(LauncherCell, {
    props: { uid: 1, expanded: false, launcher: { shell: true, label: "shell" }, session: null, cwd: "/srv/p", home: "/home/me", remoteHost },
  });
  await flushPromises();
  return w;
};

describe("a remote shell cell", () => {
  it("shows the removed host in place of the terminal", async () => {
    configuredIds = ["other"];
    const w = await mountShell("lx");
    expect(w.find('[data-testid="remote-host-gone"]').text()).toContain("lx");
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
  });
  it("runs as before while the host is configured", async () => {
    configuredIds = ["lx"];
    const w = await mountShell("lx");
    expect(w.find('[data-testid="remote-host-gone"]').exists()).toBe(false);
    expect(w.findComponent({ name: "TerminalView" }).props("remoteHost")).toBe("lx");
  });
});
