// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stageFile, stagedInsertText, filesFromClipboard, MAX_STAGED_BYTES, MAX_STAGED_FILES } from "../../../src/composables/useStagedFiles";

// A File stand-in: the composable only reads `size` and `name`, and hands the object to
// FileReader — which is stubbed below. Avoids needing a DOM for logic that has none.
const fakeFile = (name: string, size = 10) => ({ name, size }) as unknown as File;

// Minimal FileReader: resolves every read to a fixed data URL, or errors when told to.
function installFileReader(mode: "ok" | "error" = "ok") {
  class StubReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      queueMicrotask(() => {
        if (mode === "error") this.onerror?.();
        else {
          this.result = "data:image/png;base64,aGVsbG8=";
          this.onload?.();
        }
      });
    }
  }
  vi.stubGlobal("FileReader", StubReader);
}

const okFetch = (staged: string) => vi.fn(async () => ({ ok: true, json: async () => ({ path: staged }) }) as unknown as Response);

describe("stageFile", () => {
  beforeEach(() => installFileReader());
  afterEach(() => vi.unstubAllGlobals());

  it("returns the path the server staged the bytes at", async () => {
    vi.stubGlobal("fetch", okFetch("/staged/a.png"));
    expect(await stageFile(fakeFile("a.png"))).toBe("/staged/a.png");
  });

  it("posts the file's name alongside the data URL", async () => {
    const fetchMock = okFetch("/staged/a.png");
    vi.stubGlobal("fetch", fetchMock);
    await stageFile(fakeFile("shot.png"));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.name).toBe("shot.png");
    expect(body.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  // Checked client-side too, so an oversized file fails instantly instead of after uploading
  // megabytes only to be refused.
  it("refuses an oversized file without calling the server", async () => {
    const fetchMock = okFetch("/staged/a.png");
    vi.stubGlobal("fetch", fetchMock);
    expect(await stageFile(fakeFile("big.png", MAX_STAGED_BYTES + 1))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "too big" }) }) as unknown as Response));
    expect(await stageFile(fakeFile("a.png"))).toBeNull();
  });

  it("returns null when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await stageFile(fakeFile("a.png"))).toBeNull();
  });

  it("returns null when the response has no path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response));
    expect(await stageFile(fakeFile("a.png"))).toBeNull();
  });

  it("returns null when the file cannot be read", async () => {
    installFileReader("error");
    vi.stubGlobal("fetch", okFetch("/staged/a.png"));
    expect(await stageFile(fakeFile("a.png"))).toBeNull();
  });
});

describe("stagedInsertText", () => {
  beforeEach(() => installFileReader());
  afterEach(() => vi.unstubAllGlobals());

  it("joins the staged paths into insertable text", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ path: `/staged/${++n}.png` }) }) as unknown as Response));
    expect(await stagedInsertText([fakeFile("a.png"), fakeFile("b.png")])).toBe("/staged/1.png /staged/2.png");
  });

  it("quotes a staged path that needs it", async () => {
    vi.stubGlobal("fetch", okFetch("/staged/my file.png"));
    expect(await stagedInsertText([fakeFile("a.png")])).toBe("'/staged/my file.png'");
  });

  // One unreadable file in a multi-file drop shouldn't discard the others.
  it("keeps the files that succeeded when one fails", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        return (n === 1 ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ path: "/staged/b.png" }) }) as unknown as Response;
      }),
    );
    expect(await stagedInsertText([fakeFile("a.png"), fakeFile("b.png")])).toBe("/staged/b.png");
  });

  it("returns an empty string when nothing survived", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response));
    expect(await stagedInsertText([fakeFile("a.png")])).toBe("");
  });

  it("caps how many files one drop stages", async () => {
    const fetchMock = okFetch("/staged/a.png");
    vi.stubGlobal("fetch", fetchMock);
    const many = Array.from({ length: MAX_STAGED_FILES + 5 }, (_, i) => fakeFile(`f${i}.png`));
    await stagedInsertText(many);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_STAGED_FILES);
  });

  it("does nothing for an empty list", async () => {
    const fetchMock = okFetch("/staged/a.png");
    vi.stubGlobal("fetch", fetchMock);
    expect(await stagedInsertText([])).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("filesFromClipboard", () => {
  it("returns the clipboard's files", () => {
    const a = fakeFile("a.png");
    expect(filesFromClipboard({ files: [a] } as unknown as DataTransfer)).toEqual([a]);
  });

  // A text paste has to fall through to xterm untouched — that is the common case, and
  // intercepting it would break ordinary pasting.
  it("returns nothing for a text-only paste", () => {
    expect(filesFromClipboard({ files: [] } as unknown as DataTransfer)).toEqual([]);
    expect(filesFromClipboard(null)).toEqual([]);
  });
});
