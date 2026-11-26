import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createImagePasteHandler } from "../../../src/composables/usePasteImage";

const SESSION = "11111111-2222-3333-4444-555555555555";
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });

// jsdom has no clipboard, and the handler only reads what the browser reports.
function pasteEvent(types: string[], file: File | null): ClipboardEvent {
  const clipboardData = {
    types,
    items: file ? [{ kind: "file", type: file.type, getAsFile: () => file }] : [{ kind: "string", type: "text/plain", getAsFile: () => null }],
  };
  return {
    clipboardData,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ClipboardEvent;
}

const jsonResponse = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

// The handler is fire-and-forget by design (it must claim the event synchronously), so the
// assertions wait for the upload rather than for a fixed number of ticks — a fixed wait passes
// alone and fails in a loaded full-suite run.

describe("createImagePasteHandler", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  const handler = (insertText: (text: string) => void, onError: (message: string) => void) =>
    createImagePasteHandler({ sessionId: () => SESSION, insertText, onError });

  it("saves the image and inserts the returned absolute path at the cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { path: "/Users/me/.mulmoterminal/drops/s1/abc.png" })),
    );
    const insertText = vi.fn();
    const onError = vi.fn();
    const event = pasteEvent(["image/png"], png());

    expect(handler(insertText, onError)(event)).toBe(true);
    // Claimed synchronously — xterm's own paste handlers run in this same tick.
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();

    // Trailing space: pasting a second screenshot inserts at the cursor this one left behind,
    // and two paths run together name neither file (measured in a browser, #938).
    await vi.waitFor(() => expect(insertText).toHaveBeenCalledWith("/Users/me/.mulmoterminal/drops/s1/abc.png "));
    expect(onError).not.toHaveBeenCalled();
  });

  // #3506: a remote cell's screenshot is saved on its host, where its agent can read it.
  it("saves on the cell's host when it has one", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<ReturnType<typeof jsonResponse>>>(async () => jsonResponse(200, { path: "/srv/remote/.drops/abc.png" }));
    vi.stubGlobal("fetch", fetchMock);
    const insertText = vi.fn();
    createImagePasteHandler({ sessionId: () => SESSION, insertText, onError: vi.fn(), host: () => "lx" })(pasteEvent(["image/png"], png()));
    await vi.waitFor(() => expect(insertText).toHaveBeenCalledWith("/srv/remote/.drops/abc.png "));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([`/remote/lx/api/session/${SESSION}/drop`]);
  });

  it("quotes a path that a shell would otherwise split", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { path: "/Users/me/My Dir/abc.png" })),
    );
    const insertText = vi.fn();
    handler(insertText, vi.fn())(pasteEvent(["image/png"], png()));
    await vi.waitFor(() => expect(insertText).toHaveBeenCalledWith("'/Users/me/My Dir/abc.png' "));
  });

  // The point of folding #938 into #993: a pasted image travels the SAME upload as a dropped
  // file, so there is one endpoint, one size cap and one retention policy rather than two.
  it("uploads through the session's drop route, as raw bytes", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { path: "/drops/x.png" }));
    vi.stubGlobal("fetch", fetchMock);
    handler(vi.fn(), vi.fn())(pasteEvent(["image/png"], png()));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/session/${SESSION}/drop`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(File); // bytes, not a base64 data URL
  });

  // The whole point of the type check: a text paste must reach xterm untouched.
  it("declines a text paste without touching the event or the network", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const insertText = vi.fn();
    const event = pasteEvent(["text/plain"], null);

    expect(handler(insertText, vi.fn())(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertText).not.toHaveBeenCalled();
  });

  it("reports a failed upload instead of leaving the paste looking like nothing happened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(413, { error: "image too large" })),
    );
    const insertText = vi.fn();
    const onError = vi.fn();
    handler(insertText, onError)(pasteEvent(["image/png"], png()));
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(insertText).not.toHaveBeenCalled();
  });

  // A saved path is granted to ONE session by `--add-dir`. Handing it to whatever session arrived
  // while the bytes were in flight gives that session a path it was never granted and cannot read
  // — so the path is dropped and the user is told to paste again (flagged by Codex).
  it("does not insert a path into a session that arrived mid-upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { path: "/drops/old-session/abc.png" })),
    );
    let current: string | null = SESSION;
    const insertText = vi.fn();
    const onError = vi.fn();
    const onPaste = createImagePasteHandler({ sessionId: () => current, insertText, onError });

    onPaste(pasteEvent(["image/png"], png()));
    current = "99999999-8888-7777-6666-555555555555"; // the cell switched while the upload ran

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(insertText).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toContain("different session");
  });

  // The save directory is granted to a session at spawn time, so there is nowhere to put the
  // bytes before one exists. The event is still claimed — the image must not reach the terminal
  // as garbage — and the reason is said out loud.
  it("says so when the cell has no session yet", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn();
    const event = pasteEvent(["image/png"], png());

    expect(createImagePasteHandler({ sessionId: () => null, insertText: vi.fn(), onError })(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("no session"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
