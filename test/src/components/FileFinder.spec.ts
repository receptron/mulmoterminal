import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FileFinder from "../../../src/components/FileFinder.vue";

// The "open a file by name" panel (#2099). What it RANKS is filePathMatch's job and is tested
// there; this file is about the panel — that it asks the right question, that the keyboard reaches
// every row, and that it says out loud when the list it is showing is not the whole project.

const PATHS = ["src/components/FilesPane.vue", "src/components/TerminalGrid.vue", "README.md"];

let lastUrl = "";

const answering = (body: unknown, ok = true, status = 200) => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    lastUrl = String(input);
    return { ok, status, json: async () => body };
  }) as unknown as typeof fetch;
};

// jsdom implements no scrolling at all, so the real method is absent rather than inert. Stubbed
// rather than guarded in the component: in every browser it exists, and a `typeof` check there
// would be code written for this environment and nothing else.
type Scrollable = { scrollIntoView?: (arg?: unknown) => void };
const scrolled = vi.fn();

const realFetch = globalThis.fetch;
beforeEach(() => {
  answering({ paths: PATHS, truncated: false, source: "git" });
  scrolled.mockClear();
  (Element.prototype as Scrollable).scrollIntoView = scrolled;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (Element.prototype as Scrollable).scrollIntoView;
});

const open = async (props: { cwd?: string | null } = {}) => {
  const w = mount(FileFinder, { props: { cwd: "/proj", ...props }, attachTo: document.body });
  await flushPromises();
  return w;
};

const rowTexts = (w: Awaited<ReturnType<typeof open>>) => w.findAll('[data-testid="file-finder-row"]').map((r) => r.text());
const type = async (w: Awaited<ReturnType<typeof open>>, text: string) => {
  await w.find('[data-testid="file-finder-input"]').setValue(text);
  await flushPromises();
};

describe("FileFinder — what it asks for", () => {
  it("asks for the project it was given", async () => {
    await open();
    expect(lastUrl).toContain("/api/files/browse/index?cwd=%2Fproj");
  });

  // An absent cwd is how the server is told to use its default workspace; `cwd=` is a root it
  // cannot resolve.
  it("sends no cwd at all when the pane has no root", async () => {
    await open({ cwd: null });
    expect(lastUrl).toBe("/api/files/browse/index?");
  });

  it("shows every candidate before the first keystroke, rather than nothing", async () => {
    expect(rowTexts(await open())).toHaveLength(3);
  });

  it("says what went wrong when the list cannot be read", async () => {
    answering({ error: "not found" }, false, 404);
    const w = await open();
    expect(w.find('[data-testid="file-finder-error"]').text()).toBe("not found");
    expect(w.findAll('[data-testid="file-finder-row"]')).toHaveLength(0);
  });

  it("treats a body with no paths array as a failure rather than an empty project", async () => {
    answering({ truncated: false });
    const w = await open();
    expect(w.find('[data-testid="file-finder-error"]').exists()).toBe(true);
  });

  it("drops an entry that is not a string rather than rendering a row that opens nothing", async () => {
    answering({ paths: ["a.ts", 7, null], truncated: false, source: "git" });
    expect(rowTexts(await open())).toEqual(["a.ts"]);
  });
});

describe("FileFinder — letting go", () => {
  // Its deadline is the SLOW one, so a panel closed a second after it opened would otherwise keep a
  // request alive for up to a minute and then write into refs nobody renders (Codex on #2102).
  it("aborts the index request when the panel is closed", async () => {
    let seen: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return { ok: true, status: 200, json: async () => ({ paths: PATHS, truncated: false, source: "git" }) };
    }) as unknown as typeof fetch;
    const w = await open();
    expect(seen?.aborted).toBe(false);
    w.unmount();
    expect(seen?.aborted).toBe(true);
  });
});

describe("FileFinder — filtering", () => {
  it("narrows to what the fragment matches", async () => {
    const w = await open();
    await type(w, "fpane");
    expect(rowTexts(w)).toEqual(["FilesPane.vuesrc/components"]);
  });

  it("says so when nothing matches", async () => {
    const w = await open();
    await type(w, "zzzz");
    expect(w.find('[data-testid="file-finder-empty"]').exists()).toBe(true);
  });

  it("shows the file's own name first and its directory after it", async () => {
    const w = await open();
    await type(w, "readme");
    expect(rowTexts(w)).toEqual(["README.md"]);
  });
});

describe("FileFinder — the keyboard", () => {
  const press = async (w: Awaited<ReturnType<typeof open>>, key: string) => {
    await w.find('[data-testid="file-finder"]').trigger("keydown", { key });
    await flushPromises();
  };
  const selected = (w: Awaited<ReturnType<typeof open>>) =>
    w.findAll('[data-testid="file-finder-row"]').findIndex((r) => r.attributes("aria-selected") === "true");

  it("starts on the first row", async () => {
    expect(selected(await open())).toBe(0);
  });

  it("walks down and back up", async () => {
    const w = await open();
    await press(w, "ArrowDown");
    expect(selected(w)).toBe(1);
    await press(w, "ArrowUp");
    expect(selected(w)).toBe(0);
  });

  // A selection the reader cannot see is a selection they will open by accident.
  it("keeps the row it moved to on screen", async () => {
    const w = await open();
    await press(w, "ArrowDown");
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("wraps at the ends, so a short list is faster to leave by going round", async () => {
    const w = await open();
    await press(w, "ArrowUp");
    expect(selected(w)).toBe(2);
  });

  // The keyboard is in a text field. Home and End move the CARET there, and a list that took them
  // would make the query unusable to edit.
  it("leaves Home and End to the caret in the query field", async () => {
    const w = await open();
    await press(w, "ArrowDown");
    await press(w, "End");
    expect(selected(w)).toBe(1);
    await press(w, "Home");
    expect(selected(w)).toBe(1);
  });

  it("picks the selected row with Enter", async () => {
    const w = await open();
    await press(w, "ArrowDown");
    await press(w, "Enter");
    expect(w.emitted("pick")).toEqual([["src/components/TerminalGrid.vue"]]);
  });

  it("closes on Escape without picking anything", async () => {
    const w = await open();
    await press(w, "Escape");
    expect(w.emitted("close")).toHaveLength(1);
    expect(w.emitted("pick")).toBeUndefined();
  });

  // Typing moves what is under the cursor, so keeping the old position would open whatever row
  // happens to be there now — which is not the row the user was looking at.
  it("goes back to the top when the query changes", async () => {
    const w = await open();
    await press(w, "ArrowDown");
    await type(w, "s");
    expect(selected(w)).toBe(0);
  });

  // An IME candidate list uses the arrows and Enter to choose 変換 candidates; that keystroke
  // belongs to the composition, never to this panel.
  it("leaves the arrows to an IME while composing", async () => {
    const w = await open();
    await w.find('[data-testid="file-finder"]').trigger("keydown", { key: "ArrowDown", isComposing: true });
    expect(selected(w)).toBe(0);
  });

  it("does nothing on Enter when nothing matched", async () => {
    const w = await open();
    await type(w, "zzzz");
    await press(w, "Enter");
    expect(w.emitted("pick")).toBeUndefined();
  });
});

describe("FileFinder — picking with the mouse", () => {
  it("opens the row that was clicked", async () => {
    const w = await open();
    await w.findAll('[data-testid="file-finder-row"]')[2]?.trigger("click");
    expect(w.emitted("pick")).toEqual([["README.md"]]);
  });
});

// Silence about a list that is not the whole project is the one wrong answer a finder can give:
// "it is not there" and "I did not look at all of it" are different sentences.
describe("FileFinder — what is NOT in the list", () => {
  it("says when the project has more files than it lists", async () => {
    answering({ paths: PATHS, truncated: true, source: "git" });
    const w = await open();
    expect(w.find('[data-testid="file-finder-truncated"]').exists()).toBe(true);
  });

  it("says when the directory is not a repository, so .gitignore filtered nothing", async () => {
    answering({ paths: PATHS, truncated: false, source: "walk" });
    const w = await open();
    expect(w.find('[data-testid="file-finder-unignored"]').exists()).toBe(true);
  });

  it("says neither when git answered in full", async () => {
    const w = await open();
    expect(w.find('[data-testid="file-finder-truncated"]').exists()).toBe(false);
    expect(w.find('[data-testid="file-finder-unignored"]').exists()).toBe(false);
  });
});
