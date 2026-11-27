// #3506. A remote cell's AskUserQuestion dialog arrives from its host through the relay, keyed by
// host and id, so only that cell shows it; it is read and answered on its host. This machine's
// `ask-question` names this machine's sessions, so a dialog there with the same bare id is not it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalGrid from "../../../src/components/TerminalGrid.vue";
import type { Cell } from "../../../src/components/gridTabs.js";

const handlers = vi.hoisted(() => new Map<string, (data: unknown) => void>());
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, handler: (data: unknown) => void) => {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
    onReconnect: () => () => {},
  }),
}));
vi.mock("../../../src/components/TerminalCell.vue", () => ({
  default: { name: "TerminalCell", props: ["expanded"], template: '<div class="stub-cell" />' },
}));
vi.mock("../../../src/components/GuiPanel.vue", () => ({ default: { name: "GuiPanel", props: ["sessionId"], template: "<div />" } }));
vi.mock("../../../src/components/QuestionPane.vue", () => ({
  default: { name: "QuestionPane", props: ["event", "failure", "expanded"], emits: ["answer", "say", "toggle-expand", "close"], template: "<div />" },
}));

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const DIALOG = {
  sessionId: SESSION,
  toolUseId: "tu-1",
  questions: [{ question: "Pick?", header: "Pick", options: [{ label: "A" }, { label: "B" }], multiSelect: false }],
};

let requested: { url: string; method: string; body: string | null }[] = [];
let openOnHost: unknown = null;
beforeEach(() => {
  requested = [];
  openOnHost = null;
  handlers.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
      const body = url.includes("/api/question/") && !url.endsWith("/answer") ? { question: openOnHost } : { groups: [] };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
});

const cellOn = (remoteHost: string | undefined): Cell => ({ uid: 1, session: SESSION, cwd: "/srv/project", ...(remoteHost ? { remoteHost } : {}) });

const mountEnlarged = (remoteHost: string | undefined) =>
  mount(TerminalGrid, {
    props: {
      cells: [cellOn(remoteHost)],
      expandedUid: 1,
      listRows: [],
      cancelUid: null,
      defaultCwd: "/work",
      presets: [],
      launchers: [],
      home: "/work",
      openSessionIds: [],
      openCwds: [],
      reorderable: false,
      listMode: true,
    },
  });

const questionPane = (grid: ReturnType<typeof mountEnlarged>) => grid.findComponent({ name: "QuestionPane" });

describe("a remote cell's AskUserQuestion dialog", () => {
  it("asks its host for the dialog it is blocked on, and shows it", async () => {
    openOnHost = DIALOG;
    const grid = mountEnlarged("lx");
    await flushPromises();
    expect(requested.filter((r) => r.url.includes("/api/question/")).map((r) => r.url)).toEqual([`/remote/lx/api/question/${SESSION}`]);
    expect(questionPane(grid).props("event")).toMatchObject({ toolUseId: "tu-1", sessionId: `lx/${SESSION}` });
  });

  it("opens on its host's dialog through the relay, and answers on its host", async () => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    handlers.get("remote-ask-question")?.({ host: "lx", question: DIALOG });
    await flushPromises();
    expect(questionPane(grid).exists()).toBe(true);
    questionPane(grid).vm.$emit("answer", [[1]]);
    await flushPromises();
    const answers = requested.filter((r) => r.url.endsWith("/answer"));
    expect(answers).toEqual([{ url: `/remote/lx/api/question/${SESSION}/answer`, method: "POST", body: JSON.stringify({ toolUseId: "tu-1", picks: [[1]] }) }]);
  });

  it("closes when its host says the dialog closed", async () => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    handlers.get("remote-ask-question")?.({ host: "lx", question: DIALOG });
    await flushPromises();
    handlers.get("remote-ask-question")?.({ host: "lx", question: { sessionId: SESSION, toolUseId: "tu-1", done: true } });
    await flushPromises();
    expect(questionPane(grid).exists()).toBe(false);
  });

  it.each([
    ["this machine's dialog with the same id", "ask-question", DIALOG],
    ["another host's", "remote-ask-question", { host: "gpu", question: DIALOG }],
    ["a frame with no dialog", "remote-ask-question", { host: "lx" }],
  ])("ignores %s", async (_name, channel, data) => {
    const grid = mountEnlarged("lx");
    await flushPromises();
    handlers.get(channel)?.(data);
    await flushPromises();
    expect(questionPane(grid).exists()).toBe(false);
  });

  it("is a local cell's own channel's, as before (control)", async () => {
    const grid = mountEnlarged(undefined);
    await flushPromises();
    expect(requested.filter((r) => r.url.includes("/api/question/")).map((r) => r.url)).toEqual([`/api/question/${SESSION}`]);
    handlers.get("remote-ask-question")?.({ host: "lx", question: DIALOG });
    await flushPromises();
    expect(questionPane(grid).exists()).toBe(false);
    handlers.get("ask-question")?.(DIALOG);
    await flushPromises();
    expect(questionPane(grid).props("event")).toMatchObject({ sessionId: SESSION });
    questionPane(grid).vm.$emit("answer", [[0]]);
    await flushPromises();
    expect(requested.filter((r) => r.url.endsWith("/answer")).map((r) => r.url)).toEqual([`/api/question/${SESSION}/answer`]);
  });
});
