// A header button or script run from a remote cell (#3506) runs on that host, in a command cell whose
// terminal goes through the gateway. Its frame asks this server nothing about the remote's directory.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CommandCell from "../../../src/components/CommandCell.vue";
import { resetConfiguredRemoteHosts } from "../../../src/composables/configuredRemoteHosts";
import type { RunCommand } from "../../../src/components/runCommand";

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: { name: "TerminalView", props: ["remoteHost", "cwd", "command"], emits: ["exit"], template: '<div class="stub-term" />' },
}));

const CWD = "/srv/remote/project";
const COMMAND: RunCommand = { source: "script", index: 0, label: "test", cwd: CWD };

let configuredIds: string[] = [];
let requested: string[] = [];
beforeEach(() => {
  configuredIds = ["lx"];
  requested = [];
  resetConfiguredRemoteHosts();
  globalThis.fetch = vi.fn(async (url: string) => {
    requested.push(String(url));
    return { ok: true, json: async () => ({ ids: configuredIds }) };
  }) as unknown as typeof fetch;
});

const mountCommand = async (remoteHost: string | null) => {
  const w = mount(CommandCell, { props: { expanded: false, command: COMMAND, home: "/home/me", remoteHost } });
  await flushPromises();
  return w;
};
const mentionsCwd = (url: string) => url.includes(CWD) || url.includes(encodeURIComponent(CWD));

describe("a command cell on a remote host", () => {
  it("connects its terminal through the host and marks it", async () => {
    const w = await mountCommand("lx");
    expect(w.findComponent({ name: "TerminalView" }).props("remoteHost")).toBe("lx");
    expect(w.find('[data-testid="cell-host-mark"]').text()).toContain("lx");
  });

  it("asks this server nothing about the remote's directory, while a local one does", async () => {
    await mountCommand(null);
    expect(requested.filter(mentionsCwd).length).toBeGreaterThan(0);
    requested = [];
    await mountCommand("lx");
    expect(requested.filter(mentionsCwd)).toEqual([]);
  });

  it("shows the removed host in place of the terminal", async () => {
    configuredIds = ["other"];
    const w = await mountCommand("lx");
    expect(w.find('[data-testid="remote-host-gone"]').text()).toContain("lx");
    expect(w.findComponent({ name: "TerminalView" }).exists()).toBe(false);
  });
});
