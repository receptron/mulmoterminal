import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { grantPathFor } from "../../../src/composables/symlinkedMedia";
import { openFileMedia, useOpenFile, type OpenFile } from "../../../src/composables/useOpenFile";
import { SYMLINK_ESCAPE, SYMLINK_ESCAPE_FIELD, SYMLINK_ESCAPE_PATH_FIELD } from "../../../common/symlinkEscape";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";

// #3301. Media opened by a path inside the project whose symlink leads out is refused by the
// project's routes, as it must be; the pane shows it through a one-file grant instead. Only that
// refusal does this — any other 403, any other kind, and the read fails as before.
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeCmEditor("") };
});

// The absolute path is the SERVER's, deliberately unlike anything this side could rebuild from its
// own cwd: the pane must grant what the server resolved, not a path of its own making.
const RESOLVED = "/server/resolved/data/media/clip.mp4";
const symlinkRefusal = (absolutePath: unknown = RESOLVED) => ({
  error: "path escapes the project root",
  [SYMLINK_ESCAPE_FIELD]: SYMLINK_ESCAPE,
  [SYMLINK_ESCAPE_PATH_FIELD]: absolutePath,
});
const SYMLINK_REFUSAL = symlinkRefusal();
const PLAIN_REFUSAL = { error: "path escapes the project root" };
const GRANTED_URL = "/api/files/granted/abc/clip.mp4";

describe("grantPathFor", () => {
  it.each(["clip.mp4", "data/media/photo.png", "a/b/sound.mp3", "doc.pdf", "PHOTO.JPG"])("takes media behind a symlink: %s", (pathRel) => {
    expect(grantPathFor(403, SYMLINK_REFUSAL, pathRel)).toBe(RESOLVED);
  });

  it.each([
    ["a 403 that is not a symlink's", 403, PLAIN_REFUSAL, "clip.mp4"],
    ["another status", 404, SYMLINK_REFUSAL, "clip.mp4"],
    ["a success", 200, { version: "v1" }, "clip.mp4"],
    ["a text file", 403, SYMLINK_REFUSAL, "notes.md"],
    ["a page, which the pane previews through its own route", 403, SYMLINK_REFUSAL, "index.html"],
    ["a file with no extension", 403, SYMLINK_REFUSAL, "Makefile"],
    ["a body that is not an object", 403, "symlink", "clip.mp4"],
    ["no body", 403, null, "clip.mp4"],
    ["a field with another value", 403, { [SYMLINK_ESCAPE_FIELD]: "path", [SYMLINK_ESCAPE_PATH_FIELD]: RESOLVED }, "clip.mp4"],
    ["a symlink refusal with no path", 403, { error: "x", [SYMLINK_ESCAPE_FIELD]: SYMLINK_ESCAPE }, "clip.mp4"],
    ["a symlink refusal with an empty path", 403, symlinkRefusal(""), "clip.mp4"],
    ["a symlink refusal whose path is not a string", 403, symlinkRefusal(42), "clip.mp4"],
  ])("leaves %s alone", (_label, status, body, pathRel) => {
    expect(grantPathFor(status, body, pathRel)).toBeNull();
  });
});

type Reply = { status: number; body: unknown };
interface Answers {
  version: Reply;
  text?: Reply;
  grant?: Reply;
}

/** The routes an open makes, answered as told, with what the grant was asked for. */
function serve(answers: Answers): { granted: string[] } {
  const granted: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://x");
    const reply = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status });
    if (url.pathname === "/api/files/grant") {
      granted.push(typeof init?.body === "string" ? init.body : "");
      return reply(answers.grant ?? { status: 200, body: { url: GRANTED_URL } });
    }
    if (url.pathname.endsWith("/version")) return reply(answers.version);
    return reply(answers.text ?? { status: 200, body: { text: "", version: "v1" } });
  };
  return { granted };
}

function mountOpenFile(cwd: string | null = "/proj"): { file: OpenFile; mediaSrc: () => string; unmount: () => void } {
  let file!: OpenFile;
  let media!: ReturnType<typeof openFileMedia>;
  const host = mount(
    defineComponent({
      setup() {
        file = useOpenFile(() => cwd);
        media = openFileMedia(file, () => cwd);
        return () => h("div");
      },
    }),
  );
  file.attach(document.createElement("div"));
  return { file, mediaSrc: () => media.mediaSrc.value, unmount: () => host.unmount() };
}

async function open(file: OpenFile, pathRel: string): Promise<void> {
  await file.load(pathRel);
  await flushPromises();
}

describe("opening a file behind a symlink out of the project", () => {
  let session: ReturnType<typeof mountOpenFile> | null = null;
  afterEach(() => session?.unmount());

  it("shows media through a grant for the absolute path the server resolved", async () => {
    const { granted } = serve({ version: { status: 403, body: SYMLINK_REFUSAL } });
    session = mountOpenFile();
    await open(session.file, "data/media/clip.mp4");
    expect(granted).toEqual([JSON.stringify({ path: RESOLVED })]);
    expect(session.file.fileError.value).toBeNull();
    expect(session.file.openPath.value).toBe("data/media/clip.mp4");
    expect(session.mediaSrc()).toBe(GRANTED_URL);
  });

  // The full-screen view with no `?cwd=` reads the server's default directory, which this side has
  // no path for — rebuilding one from the request would hand the grant a relative path (Codex, #3302).
  it("shows it from a pane with no cwd of its own", async () => {
    const { granted } = serve({ version: { status: 403, body: SYMLINK_REFUSAL } });
    session = mountOpenFile(null);
    await open(session.file, "data/media/clip.mp4");
    expect(granted).toEqual([JSON.stringify({ path: RESOLVED })]);
    expect(session.mediaSrc()).toBe(GRANTED_URL);
  });

  it("does not ask for a grant on a 403 that is not a symlink's", async () => {
    const { granted } = serve({ version: { status: 403, body: PLAIN_REFUSAL } });
    session = mountOpenFile();
    await open(session.file, "clip.mp4");
    expect(granted).toEqual([]);
    expect(session.file.fileError.value).toBe("path escapes the project root");
  });

  it("says the file is gone when the grant finds nothing there", async () => {
    serve({ version: { status: 403, body: SYMLINK_REFUSAL }, grant: { status: 404, body: { error: "file not found" } } });
    session = mountOpenFile();
    await open(session.file, "data/media/clip.mp4");
    expect(session.file.fileError.value).toBe("data/media/clip.mp4 is not there anymore.");
    expect(session.mediaSrc()).toBe("");
  });

  it("says why when the grant is refused", async () => {
    serve({ version: { status: 403, body: SYMLINK_REFUSAL }, grant: { status: 415, body: { error: "not a file a tab can show" } } });
    session = mountOpenFile();
    await open(session.file, "data/media/clip.mp4");
    expect(session.file.fileError.value).toMatch(/symbolic link that leads outside this folder/);
  });

  it("says why for a text file, which a grant does not serve", async () => {
    const { granted } = serve({ version: { status: 200, body: { version: "v1" } }, text: { status: 403, body: SYMLINK_REFUSAL } });
    session = mountOpenFile();
    await open(session.file, "data/linked/notes.md");
    expect(granted).toEqual([]);
    expect(session.file.fileError.value).toMatch(/^data\/linked\/notes\.md is behind a symbolic link/);
  });

  it("drops the granted URL when the file is closed", async () => {
    serve({ version: { status: 403, body: SYMLINK_REFUSAL } });
    session = mountOpenFile();
    await open(session.file, "data/media/clip.mp4");
    await session.file.close();
    expect(session.file.grantedMediaSrc.value).toBeNull();
    expect(session.mediaSrc()).toBe("");
  });

  it("keeps the open file's own URL when another file fails to open", async () => {
    serve({ version: { status: 403, body: SYMLINK_REFUSAL } });
    session = mountOpenFile();
    await open(session.file, "data/media/clip.mp4");
    serve({ version: { status: 403, body: PLAIN_REFUSAL } });
    await open(session.file, "elsewhere.mp4");
    expect(session.file.openPath.value).toBe("data/media/clip.mp4");
    expect(session.mediaSrc()).toBe(GRANTED_URL);
  });

  it("goes back to the raw route for the next media file that is inside", async () => {
    serve({ version: { status: 403, body: SYMLINK_REFUSAL } });
    session = mountOpenFile();
    await open(session.file, "data/media/clip.mp4");
    expect(session.mediaSrc()).toBe(GRANTED_URL);
    serve({ version: { status: 200, body: { version: "v9" } } });
    await open(session.file, "inside.mp4");
    expect(session.mediaSrc()).toMatch(/^\/api\/files\/raw\?/);
    expect(session.mediaSrc()).toContain("path=inside.mp4");
  });
});
