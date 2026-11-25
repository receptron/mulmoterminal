// A remote cell's dot (#3506 phase 2) follows its host's rows, relayed on REMOTE_SESSIONS_CHANNEL,
// and never this server's `sessions` channel — whose ids name this machine's sessions. A local cell
// beside it is the control: the same pushes, the other way round.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalCell from "../../../src/components/TerminalCell.vue";
import { resetConfiguredRemoteHosts } from "../../../src/composables/configuredRemoteHosts";

const bus = vi.hoisted(() => ({ listeners: new Map<string, Set<(data: unknown) => void>>(), reconnects: new Set<() => void>() }));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, listener: (data: unknown) => void) => {
      const set = bus.listeners.get(channel) ?? new Set();
      set.add(listener);
      bus.listeners.set(channel, set);
      return () => set.delete(listener);
    },
    onReconnect: (listener: () => void) => {
      bus.reconnects.add(listener);
      return () => bus.reconnects.delete(listener);
    },
  }),
}));
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader", "launch", "customAgent", "agent", "pathMenuPicker", "remoteHost"],
    emits: ["session", "cwd"],
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-lead" /><slot v-if="!hideHeader" name="header-actions" /></div>',
    methods: { terminate() {}, showHint() {}, submitText: () => true },
  },
}));

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const publish = (channel: string, data: unknown) => bus.listeners.get(channel)?.forEach((listener) => listener(data));
const row = (fields: Record<string, unknown>) => ({ id: SESSION, working: false, waiting: false, event: null, ...fields });

let remoteSeed: Record<string, unknown> = {};
let remoteDown = false;
let requested: string[] = [];
beforeEach(() => {
  bus.listeners.clear();
  bus.reconnects.clear();
  requested = [];
  remoteSeed = {};
  remoteDown = false;
  resetConfiguredRemoteHosts();
  globalThis.fetch = vi.fn(async (url: string) => {
    requested.push(String(url));
    if (String(url).endsWith("/api/remote-hosts/ids")) return { ok: true, json: async () => ({ ids: ["lx"] }) };
    if (String(url).includes("/api/remote-hosts/lx/activity")) {
      if (remoteDown) return { ok: false, status: 502, json: async () => ({ error: "Linux did not answer" }) };
      return { ok: true, json: async () => ({ [SESSION]: remoteSeed }) };
    }
    return { ok: true, json: async () => ({ working: false, waiting: false, lastPrompt: null }) };
  }) as unknown as typeof fetch;
});

const mountCell = async (remoteHost: string | null) => {
  const w = mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      collectionsAvailable: false,
      zoomed: false,
      reorderable: false,
      initialSessionId: SESSION,
      initialCwd: "/srv/p",
      defaultCwd: "/home/me/ws",
      presets: [],
      home: "/home/me",
      openSessionIds: [],
      openCwds: [],
      remoteHost,
    },
  });
  await flushPromises();
  return w;
};
const lastStatus = (w: Awaited<ReturnType<typeof mountCell>>) => w.emitted("status")?.at(-1)?.[0];

describe("a remote cell's dot", () => {
  it("follows its host's relayed rows", async () => {
    const w = await mountCell("lx");
    publish("remote-sessions", { host: "lx", row: row({ working: true, event: "UserPromptSubmit" }) });
    await flushPromises();
    expect(lastStatus(w)).toBe("working");
    publish("remote-sessions", { host: "lx", row: row({ waiting: true, event: "Notification" }) });
    await flushPromises();
    expect(lastStatus(w)).toBe("blocked");
  });

  it("ignores this server's sessions channel and another host's rows, even under the same id", async () => {
    const w = await mountCell("lx");
    publish("sessions", row({ working: true, event: "UserPromptSubmit" }));
    publish("remote-sessions", { host: "other", row: row({ working: true, event: "UserPromptSubmit" }) });
    await flushPromises();
    expect(lastStatus(w)).toBe("idle");
  });

  it("starts from the forwarded activity, and reads it again on the relay's resync", async () => {
    remoteSeed = { working: true, waiting: false, event: "UserPromptSubmit" };
    const w = await mountCell("lx");
    expect(lastStatus(w)).toBe("working");
    remoteSeed = { working: false, waiting: true, event: "Notification" };
    publish("remote-sessions", { host: "lx", resync: true });
    await flushPromises();
    expect(lastStatus(w)).toBe("blocked");
    expect(requested.filter((url) => url.includes(SESSION) && !url.includes("/api/remote-hosts/lx/activity"))).toEqual([]);
  });
});

describe("a remote cell whose host drops", () => {
  it("stops claiming the state it had before, once the relay says to read again and nothing answers", async () => {
    const w = await mountCell("lx");
    publish("remote-sessions", { host: "lx", row: row({ working: true, event: "UserPromptSubmit" }) });
    await flushPromises();
    expect(lastStatus(w)).toBe("working");
    remoteDown = true;
    publish("remote-sessions", { host: "lx", resync: true });
    await flushPromises();
    expect(lastStatus(w)).toBe("idle");
  });
});

describe("a local cell's dot, as the control", () => {
  it("follows this server's sessions channel and ignores a relayed row with the same id", async () => {
    const w = await mountCell(null);
    publish("remote-sessions", { host: "lx", row: row({ working: true, event: "UserPromptSubmit" }) });
    await flushPromises();
    expect(lastStatus(w)).toBe("idle");
    publish("sessions", row({ working: true, event: "UserPromptSubmit" }));
    await flushPromises();
    expect(lastStatus(w)).toBe("working");
  });
});
