import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useMdPreviewScroll, type MdPreviewScroll } from "../../../src/composables/useMdPreviewScroll";
import { MD_PREVIEW_FROM_FRAME, MD_PREVIEW_FROM_HOST } from "../../../common/mdPreviewMessage";
import { previewCodeBlocks } from "../../../common/previewCodeBlocks";

// #2615. A copy button in the Preview names a block by number; the pane reads that block from the file
// and shows it. What reaches the dialog must be the FILE's text, the latest press, for the file open.

const TOKEN = "0123456789abcdef-wire";
const FILE = "# Doc\n\n```ts\nconst first = 1;\n```\n\n```sh\necho second\n```\n";

function mountHost(openPath = ref<string | null>("a.md"), cwd = ref("/proj"), label = ref("Copy this code block"), markdownShown = ref(true)) {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  let api: MdPreviewScroll | null = null;
  mount(
    defineComponent({
      setup() {
        api = useMdPreviewScroll(
          // The pane hands over the frame only while a Markdown document is in it.
          () => (markdownShown.value ? frame : null),
          ref(0),
          () => {},
          () => TOKEN,
          { cwd: () => cwd.value, openPath: () => openPath.value, label: () => label.value, diagramSourceLabel: () => "Diagram source" },
        );
        return () => h("div");
      },
    }),
  );
  const press = (index: unknown): void => {
    const event = new MessageEvent("message", { data: { source: MD_PREVIEW_FROM_FRAME, kind: "code-block", index, token: TOKEN } });
    Object.defineProperty(event, "source", { value: frame.contentWindow });
    window.dispatchEvent(event);
  };
  return { frame, press, shown: () => api?.codeBlock?.shown.value ?? null, close: () => api?.codeBlock?.close(), openPath, cwd };
}

/** The server's `/code-block` route over one file: the block at `?index=`, or its 404 for none. */
const serveFile = (text: string | null) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (text === null) return new Response("{}", { status: 500 });
      const block = previewCodeBlocks(text)[Number(new URL(url, "https://localhost").searchParams.get("index"))];
      return block ? new Response(JSON.stringify(block), { status: 200 }) : new Response(JSON.stringify({ kind: "no-block" }), { status: 404 });
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a Preview code block's copy button", () => {
  it("shows the block the button names, read from the file", async () => {
    serveFile(FILE);
    const host = mountHost();
    host.press(1);
    await flushPromises();
    expect(host.shown()).toEqual({ status: "found", block: { lang: "sh", text: "echo second" } });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/api/files/browse/code-block?");
  });

  it("says the block is gone when the file no longer has it", async () => {
    serveFile("no code now\n");
    const host = mountHost();
    host.press(0);
    await flushPromises();
    expect(host.shown()).toEqual({ status: "missing" });
  });

  it("says it could not read the file when the read fails", async () => {
    serveFile(null);
    const host = mountHost();
    host.press(0);
    await flushPromises();
    expect(host.shown()).toEqual({ status: "failed" });
  });

  it("drops the answer when another file was opened meanwhile", async () => {
    serveFile(FILE);
    const host = mountHost();
    host.press(0);
    host.openPath.value = "b.md";
    await flushPromises();
    expect(host.shown()).toBeNull();
  });

  // Closed before the file answered: the answer must not bring the dialog back.
  it("drops a read still out when the dialog is closed", async () => {
    const answers: ((res: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    );
    const host = mountHost();
    host.press(0);
    host.close();
    answers[0]?.(new Response(JSON.stringify({ lang: "ts", text: "const first = 1;" }), { status: 200 }));
    await flushPromises();
    expect(host.shown()).toBeNull();
  });

  it("shows the latest press when an earlier one answers last", async () => {
    const answers: ((res: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    );
    const host = mountHost();
    host.press(0);
    host.press(1);
    answers[1]?.(new Response(JSON.stringify({ lang: "sh", text: "echo second" }), { status: 200 }));
    await flushPromises();
    answers[0]?.(new Response(JSON.stringify({ lang: "ts", text: "const first = 1;" }), { status: 200 }));
    await flushPromises();
    expect(host.shown()).toEqual({ status: "found", block: { lang: "sh", text: "echo second" } });
  });

  // The same relative path under another root is another file (a re-root keeps the pane mounted).
  it("drops a read in flight, and a dialog already open, when the root changes", async () => {
    serveFile(FILE);
    const host = mountHost();
    host.press(0);
    host.cwd.value = "/other";
    await flushPromises();
    expect(host.shown()).toBeNull();
    host.press(0);
    await flushPromises();
    expect(host.shown()).not.toBeNull();
    host.cwd.value = "/proj";
    await flushPromises();
    expect(host.shown()).toBeNull();
  });

  it.each([[-1], ["0"], [1.5]])("ignores a press naming %j", async (index) => {
    serveFile(FILE);
    const host = mountHost();
    host.press(index);
    await flushPromises();
    expect(fetch).not.toHaveBeenCalled();
    expect(host.shown()).toBeNull();
  });

  it("names the buttons again when the app's language changes", async () => {
    const label = ref("Copy this code block");
    const host = mountHost(ref("a.md"), ref("/proj"), label);
    const target = host.frame.contentWindow;
    if (!target) throw new Error("the frame has no window");
    const sent = vi.spyOn(target, "postMessage");
    label.value = "このコードブロックをコピー";
    await flushPromises();
    expect(sent).toHaveBeenCalledWith({ source: MD_PREVIEW_FROM_HOST, codeCopyLabel: "このコードブロックをコピー", diagramSourceLabel: "Diagram source" }, "*");
  });

  // An HTML page runs its own scripts; nothing is posted into its frame (#2269).
  it("posts no new name while the frame holds something other than Markdown", async () => {
    const label = ref("Copy this code block");
    const host = mountHost(ref("a.md"), ref("/proj"), label, ref(false));
    const target = host.frame.contentWindow;
    if (!target) throw new Error("the frame has no window");
    const sent = vi.spyOn(target, "postMessage");
    label.value = "このコードブロックをコピー";
    await flushPromises();
    expect(sent).not.toHaveBeenCalled();
  });

  it("names the buttons when it answers a fresh document", () => {
    serveFile(FILE);
    const host = mountHost();
    const target = host.frame.contentWindow;
    if (!target) throw new Error("the frame has no window");
    const sent = vi.spyOn(target, "postMessage");
    const event = new MessageEvent("message", { data: { source: MD_PREVIEW_FROM_FRAME, kind: "ready", token: TOKEN } });
    Object.defineProperty(event, "source", { value: host.frame.contentWindow });
    window.dispatchEvent(event);
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ codeCopyLabel: "Copy this code block", diagramSourceLabel: "Diagram source" }), "*");
  });
});
