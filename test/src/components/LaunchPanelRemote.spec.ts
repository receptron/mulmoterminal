// @vitest-environment jsdom
// The launch panel's host picker (#3506). A remote start must not reach this machine's /api with the
// typed directory, which names a path on the other machine.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import LaunchPanel from "../../../src/components/LaunchPanel.vue";
import type { RemoteHostSummary } from "../../../common/remoteHosts";

const HOSTS: RemoteHostSummary[] = [
  { id: "lx", label: "Linux box", state: "reachable", version: "1.0.0" },
  { id: "down", label: "Down", state: "unreachable", version: null },
  { id: "old", label: "Old", state: "version-mismatch", version: "0.9.0" },
];

let requested: string[] = [];
const stubFetch = (hosts: RemoteHostSummary[]) => {
  requested = [];
  globalThis.fetch = vi.fn(async (url: string) => {
    requested.push(String(url));
    if (String(url).includes("/api/remote-hosts")) return { ok: true, json: async () => ({ hosts, rejected: [] }) };
    if (String(url).includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: false, base: null, worktrees: [] }) };
    if (String(url).includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
};

beforeEach(() => stubFetch(HOSTS));

const mountPanel = async () => {
  const w = mount(LaunchPanel, {
    props: { initialDir: "/home/me/proj", defaultCwd: "/home/me/workspace", presets: [], launchers: [], customAgents: [] },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
};
const pickHost = async (w: VueWrapper, id: string) => {
  await w.find(`[data-testid="remote-host-${id}"]`).trigger("click");
  await flushPromises();
};
const typeDir = async (w: VueWrapper, dir: string) => {
  await w.find('[data-testid="remote-launch"] [data-testid="cell-dir-input"]').setValue(dir);
};

describe("the launch panel's host picker", () => {
  it("is absent when no remote host is configured, leaving the panel as it was", async () => {
    stubFetch([]);
    const w = await mountPanel();
    expect(w.find('[data-testid="remote-host-picker"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  it("lists every configured host, and refuses the ones that cannot start a terminal", async () => {
    const w = await mountPanel();
    expect(w.find('[data-testid="remote-host-lx"]').attributes("aria-disabled")).toBe("false");
    expect(w.find('[data-testid="remote-host-down"]').attributes("data-tip")).toContain("ssh");
    await pickHost(w, "down");
    await pickHost(w, "old");
    expect(w.find('[data-testid="remote-launch"]').exists()).toBe(false);
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });

  it("starts on the remote with the typed directory and the picked agent", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(false);
    await typeDir(w, "/srv/app");
    await w.find('[data-testid="remote-agent-codex"]').trigger("click");
    await w.find('[data-testid="remote-launch"]').trigger("submit");
    expect(w.emitted("start-remote")).toEqual([[{ host: "lx", dir: "/srv/app", agent: "codex" }]]);
    expect(w.emitted("start")).toBeUndefined();
  });

  it("will not start on a path the remote would read as something else", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    await typeDir(w, "~/app");
    expect(w.find('[data-testid="remote-dir-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="remote-start"]').attributes("disabled")).toBeDefined();
    await w.find('[data-testid="remote-launch"]').trigger("submit");
    expect(w.emitted("start-remote")).toBeUndefined();
  });

  it("asks this machine nothing about the directory typed for the remote", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    requested = [];
    await typeDir(w, "/srv/app");
    await flushPromises();
    expect(requested).toEqual([]);
  });

  it("goes back to the local form when this machine is picked again", async () => {
    const w = await mountPanel();
    await pickHost(w, "lx");
    await w.find('[data-testid="remote-host-picker"] [role="radio"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="cell-launch"]').exists()).toBe(true);
  });
});
