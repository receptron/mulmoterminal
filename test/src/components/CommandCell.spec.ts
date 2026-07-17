import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import CommandCell from "../../../src/components/../../src/components/CommandCell.vue";
import type { RunCommand } from "../../../src/components/../../src/components/runCommand";

// Stub the terminal so no xterm/WebSocket is needed; it forwards the props the cell
// passes (command/connectKey), can emit "exit" to drive the re-run UI, and exposes
// readOutput() so the summarize action has captured output to send.
const CAPTURED_OUTPUT = "npm ERR! cannot find module foo";
vi.mock("./Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "command"],
    emits: ["exit"],
    template: '<div class="stub-term" />',
    methods: {
      readOutput() {
        return CAPTURED_OUTPUT;
      },
    },
  },
}));

const COMMAND: RunCommand = { source: "script", index: 2, label: "Dev server", cwd: "/work/proj" };
const mountCell = () => mount(CommandCell, { props: { expanded: false, command: COMMAND, home: "/work" } });
const term = (w: ReturnType<typeof mount>) => w.findComponent({ name: "TerminalView" });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("CommandCell", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the label + dir and runs the command in its directory", () => {
    const w = mountCell();
    expect(w.find(".cell-cmd").text()).toContain("Dev server");
    expect(w.find(".cell-dir").text()).toBe("~/proj"); // ~-anchored to home
    expect(term(w).props("command")).toEqual(COMMAND);
    expect(term(w).props("cwd")).toBe("/work/proj"); // runs in the cell's dir
    expect(term(w).props("sessionId")).toBeNull(); // not a Claude session
  });

  it("offers a re-run only after the command exits, and re-running reconnects", async () => {
    const w = mountCell();
    expect(w.find('[aria-label="Re-run command"]').exists()).toBe(false);

    term(w).vm.$emit("exit");
    await nextTick();
    const rerun = w.find('[aria-label="Re-run command"]');
    expect(rerun.exists()).toBe(true);

    const before = term(w).props("connectKey");
    await rerun.trigger("click");
    expect(term(w).props("connectKey")).toBe(before + 1); // forces a fresh connect
    expect(w.find('[aria-label="Re-run command"]').exists()).toBe(false); // running again
  });

  it("emits toggle-expand and close from the header buttons", async () => {
    const w = mountCell();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("zooms on a header-background click in the normal grid (mirrors clicking the body)", async () => {
    const w = mountCell(); // expanded: false, zoomed: undefined → tiled grid
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("zooms on a header-background click when it's a filmstrip thumbnail", async () => {
    const w = mount(CommandCell, { props: { expanded: false, zoomed: true, command: COMMAND, home: "/work" } });
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("does not zoom on a header-background click while expanded (restore via the ⤡ button)", async () => {
    const w = mount(CommandCell, { props: { expanded: true, command: COMMAND, home: "/work" } });
    expect(w.find(".cell-header").classes()).not.toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });
});

describe("CommandCell summarize", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has no summary panel until the button is clicked", () => {
    const w = mountCell();
    expect(w.find('[aria-label="Summarize command output"]').exists()).toBe(true);
    expect(w.find(".cell-summary").exists()).toBe(false);
  });

  it("posts the captured output and renders the returned summary", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(jsonResponse({ summary: "Errors: missing module foo\nSuggested fix: yarn add foo", truncated: false })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/command/summarize");
    const sent = JSON.parse(String(init?.body));
    expect(sent.log).toContain("npm ERR!");
    expect(typeof sent.locale).toBe("string"); // browser locale forwarded for the reply language
    expect(w.find(".cell-summary-text").text()).toContain("missing module foo");
  });

  it("copies the command + summary as a prompt to the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "Errors: missing module foo", truncated: false })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();

    await w.find(".cell-summary-continue").trigger("click");
    expect(writeText).toHaveBeenCalledOnce();
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain("Dev server"); // the command label
    expect(copied).toContain("/work/proj"); // the command's dir
    expect(copied).toContain("missing module foo"); // the summary
    await flushPromises();
    expect(w.find(".cell-summary-continue").text()).toContain("Copied");
  });

  it("does not throw when the clipboard API is unavailable (insecure origin / webview)", async () => {
    vi.stubGlobal("navigator", {}); // no `clipboard`
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "Errors: boom", truncated: false })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    await w.find(".cell-summary-continue").trigger("click"); // must not throw
    expect(w.find(".cell-summary-continue").text()).toContain("Copy"); // stays "Copy as prompt"
  });

  it("shows the truncation note when the server truncated the log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "Errors: boom", truncated: true })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    expect(w.find(".cell-summary-note").exists()).toBe(true);
  });

  it("surfaces the server error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "summary failed: not logged in" }, 502)),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    expect(w.find(".cell-summary-error").text()).toContain("not logged in");
    expect(w.find(".cell-summary-text").exists()).toBe(false);
  });

  it("dismisses the summary panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ summary: "ok", truncated: false })),
    );
    const w = mountCell();
    await w.find('[aria-label="Summarize command output"]').trigger("click");
    await flushPromises();
    expect(w.find(".cell-summary").exists()).toBe(true);
    await w.find('[aria-label="Dismiss summary"]').trigger("click");
    expect(w.find(".cell-summary").exists()).toBe(false);
  });
});
