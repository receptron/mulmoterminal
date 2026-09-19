import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useOpenFile, type OpenFile } from "../../../src/composables/useOpenFile";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";

// The open file, driven without a pane — which is possible now (#2158). These are what survived the
// differential harness that proved the lift: its generator (the answers the two endpoints can give
// — text, 415, a read that fails, a write that conflicts, a backup store that refuses) and its
// property (what the buffer says about itself afterwards, and what was sent).
//
// The pane's own specs cover the same ground THROUGH the markup and keep doing so. What is here is
// the half of it a mounted pane cannot reach cheaply: the failure paths, which used to need a real
// editor and a clicked banner to arrange and are now one call each.
const fakeEditor = fakeCmEditor("in the buffer");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});

type Reply = { ok: boolean; status?: number; body: unknown };
interface Server {
  text?: (path: string) => Reply;
  write?: Reply;
  backup?: Reply;
  version?: string;
}

/** A reply as the real `fetch` would hand it back. Built rather than asserted into shape, so `ok`
 *  follows from the status the way a browser's does and nothing here needs a cast. */
const replied = (reply: Reply): Response => new Response(JSON.stringify(reply.body), { status: reply.status ?? (reply.ok ? 200 : 500) });

/** Every request the open file can make, and a log of what was sent. */
function serve(server: Server): { calls: string[]; bodies: string[] } {
  const calls: string[] = [];
  const bodies: string[] = [];
  const answer: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "https://x");
    const path = url.searchParams.get("path") ?? "";
    const keepalive = init?.keepalive === true ? ":keepalive" : "";
    if (typeof init?.body === "string") bodies.push(init.body);
    if (url.pathname.endsWith("/version")) {
      calls.push(`version:${path}`);
      return replied({ ok: true, body: { version: server.version ?? "v1" } });
    }
    if (url.pathname.endsWith("/write")) {
      calls.push(`write:${path}${keepalive}`);
      return replied(server.write ?? { ok: true, body: { version: "v2" } });
    }
    if (url.pathname.endsWith("/backup")) {
      calls.push(`backup:${path}${keepalive}`);
      return replied(server.backup ?? { ok: true, body: { stored: true } });
    }
    calls.push(`text:${path}`);
    return replied(server.text?.(path) ?? { ok: true, body: { text: "on disk", version: "v1" } });
  };
  globalThis.fetch = answer;
  return { calls, bodies };
}

/** A component context, because the composable owns a `pagehide` listener and the disk watch — the
 *  two things about an open file that outlive any one read. Unmounting the host ends both. */
function mountOpenFile(): { file: OpenFile; unmount: () => void } {
  let file!: OpenFile;
  const host = mount(
    defineComponent({
      setup() {
        file = useOpenFile(() => "/proj");
        return () => h("div");
      },
    }),
  );
  file.attach(document.createElement("div"));
  return { file, unmount: () => host.unmount() };
}

/** Open a file and let every request settle. */
async function opened(file: OpenFile, pathRel = "notes.md"): Promise<void> {
  await file.load(pathRel);
  await flushPromises();
}

describe("useOpenFile", () => {
  let session: { file: OpenFile; unmount: () => void };

  beforeEach(() => {
    fakeEditor.setDoc.mockClear();
    fakeEditor.goTo.mockClear();
    fakeEditor.scrollLineToTop.mockClear();
  });
  afterEach(() => session?.unmount());

  it("puts what the server served into the editor, with the version it came from", async () => {
    serve({});
    session = mountOpenFile();
    await opened(session.file);

    expect(fakeEditor.setDoc).toHaveBeenCalledWith("on disk", "notes.md");
    expect(session.file.openPath.value).toBe("notes.md");
    expect(session.file.baseVersion.value).toBe("v1");
    expect(session.file.dirty.value).toBe(false);
  });

  // 415 is the one non-ok status that is not a failure. The buffer is emptied and marked clean, so
  // nothing can be written over content the editor never had (#2038).
  it("shows a file that is not text as unpreviewable, and refuses to save over it", async () => {
    const { calls } = serve({ text: () => ({ ok: false, status: 415, body: { error: "not text" } }) });
    session = mountOpenFile();
    await opened(session.file, "blob.bin");

    expect(session.file.unpreviewable.value).toBe("not text");
    expect(session.file.baseVersion.value).toBeNull();
    expect(session.file.fileError.value).toBeNull(); // nothing went wrong
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("", "blob.bin");

    await session.file.save();
    expect(calls.filter((c) => c.startsWith("write:"))).toEqual([]);
  });

  // The reason is in the body, not the status: "HTTP 500" is a mystery, "outside the project root"
  // is something the user can act on.
  it("reports why a read was refused, and keeps the file it had", async () => {
    serve({ text: (p) => (p === "gone.md" ? { ok: false, status: 500, body: { error: "boom" } } : { ok: true, body: { text: "on disk", version: "v1" } }) });
    session = mountOpenFile();
    await opened(session.file);
    await opened(session.file, "gone.md");

    expect(session.file.fileError.value).toBe("boom");
    expect(session.file.openPath.value).toBe("notes.md"); // the editor still shows what it had
  });

  it("falls back to the status when the body names no reason", async () => {
    serve({ text: () => ({ ok: false, status: 503, body: {} }) });
    session = mountOpenFile();
    await opened(session.file);

    expect(session.file.fileError.value).toBe("HTTP 503");
  });

  // 409 — the agent working in this directory got there first. Nothing was written, so the choice
  // goes to the user rather than to whoever asked last.
  it("raises the conflict rather than picking a loser, and overwrites from the disk's version", async () => {
    const { calls, bodies } = serve({ write: { ok: false, status: 409, body: { error: "changed", version: "v9" } } });
    session = mountOpenFile();
    await opened(session.file);
    await session.file.save();

    expect(session.file.conflict.value).toEqual({ version: "v9" });
    expect(session.file.fileError.value).toBeNull(); // a banner, not a failure
    expect(calls).toEqual(["text:notes.md", "write:notes.md"]);
    expect(bodies.at(-1)).toContain('"baseVersion":"v1"'); // the attempt went out on what was read

    serve({}); // the retry lands
    session.file.overwrite();
    await flushPromises();
    expect(session.file.conflict.value).toBeNull();
    expect(session.file.baseVersion.value).toBe("v2");
  });

  it("re-sends the retry against the version now on disk", async () => {
    serve({ write: { ok: false, status: 409, body: { error: "changed", version: "v9" } } });
    session = mountOpenFile();
    await opened(session.file);
    await session.file.save();

    const second = serve({});
    session.file.overwrite();
    await flushPromises();
    expect(second.bodies.at(-1)).toContain('"baseVersion":"v9"');
  });

  // "Kept as a backup either way" is the promise the banner makes. A store that refuses it turns
  // "discard" into a loss, so the buffer stays.
  it("does not discard when the backup store refuses the buffer", async () => {
    const { calls } = serve({ backup: { ok: false, status: 500, body: { error: "full" } } });
    session = mountOpenFile();
    await opened(session.file);
    fakeEditor.setDoc.mockClear();
    calls.length = 0;

    await session.file.discardAndReload();
    expect(session.file.fileError.value).toBe("could not back up your version — nothing was discarded");
    expect(calls.filter((c) => c.startsWith("text:"))).toEqual([]); // nothing was re-read
    expect(fakeEditor.setDoc).not.toHaveBeenCalled();
  });

  it("takes the disk's copy once the buffer is safely banked", async () => {
    const { calls } = serve({});
    session = mountOpenFile();
    await opened(session.file);
    calls.length = 0;

    await session.file.discardAndReload();
    await flushPromises();
    expect(calls).toEqual(["backup:notes.md", "text:notes.md"]); // banked first, then re-read
  });

  // Leaving is not allowed to lose what was typed. `flush` says whether the buffer is safe to leave
  // behind, and a caller that can stay must stay.
  it("says the buffer is safe when the save lands", async () => {
    serve({});
    session = mountOpenFile();
    await opened(session.file);
    session.file.dirty.value = true;

    expect(await session.file.flush()).toBe(true);
    expect(session.file.dirty.value).toBe(false);
  });

  it("says the buffer is safe when the save fails but the backup lands", async () => {
    const { calls } = serve({ write: { ok: false, status: 500, body: { error: "disk" } } });
    session = mountOpenFile();
    await opened(session.file);
    session.file.dirty.value = true;

    expect(await session.file.flush()).toBe(true);
    expect(calls).toContain("backup:notes.md");
  });

  it("refuses to leave when NEITHER the save nor the backup lands", async () => {
    serve({ write: { ok: false, status: 500, body: { error: "disk is full" } }, backup: { ok: false, status: 500, body: {} } });
    session = mountOpenFile();
    await opened(session.file);
    session.file.dirty.value = true;

    expect(await session.file.flush()).toBe(false);
    expect(session.file.dirty.value).toBe(true); // still unsaved, and the pane must not walk away
    expect(session.file.fileError.value).toBe("disk is full");
  });

  // Closing the tab is leaving too, and there is no awaiting an answer — so both go out, with
  // `keepalive` so the browser lets them outlive the page.
  it("sends the buffer both ways when the page goes away", async () => {
    const { calls } = serve({});
    session = mountOpenFile();
    await opened(session.file);
    session.file.dirty.value = true;
    calls.length = 0;

    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();
    expect(calls).toEqual(["backup:notes.md:keepalive", "write:notes.md:keepalive"]);
  });

  it("sends nothing when the page goes away with nothing unsaved", async () => {
    const { calls } = serve({});
    session = mountOpenFile();
    await opened(session.file);
    calls.length = 0;

    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();
    expect(calls).toEqual([]);
  });

  // The listener belongs to the composable, so the host going away has to take it with it —
  // otherwise a pane the user closed goes on writing files every time a tab is closed.
  it("stops listening for the page once its host is gone", async () => {
    const { calls } = serve({});
    session = mountOpenFile();
    await opened(session.file);
    session.file.dirty.value = true;
    session.unmount();
    calls.length = 0;

    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();
    expect(calls).toEqual([]);
  });

  // The pane re-roots in place, so a read already in flight would otherwise land in the NEW
  // project's tree and adopt the old one's content (Codex on #2102).
  it("drops a read that was in flight when the pane was torn down", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = async () => {
      await held;
      return replied({ ok: true, body: { text: "from the old project", version: "v1" } });
    };

    session = mountOpenFile();
    const reading = session.file.load("notes.md");
    await flushPromises(); // the read has taken its generation and is parked inside the fetch
    session.file.teardown();
    release();
    await reading;
    await flushPromises();

    expect(session.file.openPath.value).toBeNull();
    expect(fakeEditor.setDoc).not.toHaveBeenCalled();
  });
});
