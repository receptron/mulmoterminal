import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";

// The right-click menu on a tree row (#1859). What it OFFERS is filesRowActions' job and is
// tested there; this file is about the menu itself — that the gesture is only taken when there
// is something to offer, that the keyboard reaches it, and that it lets go of the keyboard again.

const fakeEditor = { setDoc: vi.fn(), getDoc: vi.fn(() => ""), destroy: vi.fn() };
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});

const ROWS = [
  { name: "README.md", dir: false, size: 10 },
  { name: "src", dir: true, size: 0 },
];

function mockFs() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/list")) return { ok: true, json: async () => ({ entries: ROWS }) };
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: "v1" }) };
    return { ok: true, json: async () => ({ ok: true, version: "v2" }) };
  }) as unknown as typeof fetch;
}

type PaneProps = { cwd?: string | null; insertTarget?: boolean; insertTargetCwd?: string | null; canvasTarget?: boolean; workspace?: string | null };

const mountPane = async (props: PaneProps = {}) => {
  const w = mount(FilesPane, {
    props: { cwd: "/proj", insertTarget: true, insertTargetCwd: "/proj", ...props },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
};

const menu = () => document.body.querySelector('[data-testid="files-row-menu"]');
const item = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="files-row-action-${id}"]`);
// Each item leads with a Material Symbols ligature, which renders as its own text node — the
// same strip TerminalCell.spec.ts does for the path menu.
const itemLabel = (text: string) => text.replace(/^\S+\s+/, "");
const labels = () => [...document.body.querySelectorAll('[data-testid="files-row-menu"] [role="menuitem"]')].map((b) => itemLabel(b.textContent?.trim() ?? ""));

/** A real event, so `defaultPrevented` means what it means in a browser. */
const rightClick = (el: Element, clientX = 40, clientY = 60) => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY });
  el.dispatchEvent(event);
  return event;
};

describe("the files tree's row menu", () => {
  beforeEach(mockFs);
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers both paths on a right-click, and inserts the one that is picked", async () => {
    const w = await mountPane();
    rightClick(w.findAll('[data-testid="files-row"]')[0].element);
    await flushPromises();

    expect(labels()).toEqual(["Show in folder", "Insert relative path", "Insert absolute path"]);
    item("insert-relative")?.click();
    await flushPromises();
    expect(w.emitted("insert-text")).toEqual([["README.md "]]);
    expect(menu()).toBeNull(); // picking is done
  });

  it("inserts the absolute path from a directory row", async () => {
    const w = await mountPane();
    rightClick(w.findAll('[data-testid="files-row"]')[1].element);
    await flushPromises();
    item("insert-absolute")?.click();
    await flushPromises();
    expect(w.emitted("insert-text")).toEqual([["/proj/src "]]);
  });

  // #1923: the row is where "show me this file" starts, so the entry that opens it in the Canvas
  // rides the same emit as the pane's own Canvas button — and carries the RELATIVE path, which is
  // what that button sends and what the receiver resolves against the pane's cwd.
  it("opens a renderable file in the Canvas from the row, without opening it first", async () => {
    const w = await mountPane({ canvasTarget: true, workspace: "/ws" });
    rightClick(w.findAll('[data-testid="files-row"]')[0].element); // README.md
    await flushPromises();

    expect(labels()).toEqual(["Open in the Canvas", "Show in folder", "Insert relative path", "Insert absolute path"]);
    item("open-canvas")?.click();
    await flushPromises();
    expect(w.emitted("open-in-canvas")).toEqual([["README.md"]]);
    expect(w.emitted("insert-text")).toBeUndefined();
    expect(menu()).toBeNull();
  });

  // A directory is not something a plugin renders, so the row keeps the two inserts it had. Its
  // file-manager entry words itself for a folder — "Show in folder" would promise its parent.
  it("does not offer the Canvas on a row nothing can render", async () => {
    const w = await mountPane({ canvasTarget: true, workspace: "/ws" });
    rightClick(w.findAll('[data-testid="files-row"]')[1].element); // src/
    await flushPromises();
    expect(labels()).toEqual(["Open this folder", "Insert relative path", "Insert absolute path"]);
  });

  // The full-screen view mounts the same pane with no terminal beside it, and until #2039 the
  // menu was empty there — so the right-click was left to the browser rather than swallowed for
  // nothing. Showing a row in the file manager needs no terminal, and is most useful exactly
  // there: it is how a produced file is handed to another app.
  it("still opens where there is no terminal, now that one entry needs none", async () => {
    const w = await mountPane({ insertTarget: false });
    const event = rightClick(w.findAll('[data-testid="files-row"]')[0].element);
    await flushPromises();

    expect(labels()).toEqual(["Show in folder"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("drops the relative path when the terminal is in another directory", async () => {
    const w = await mountPane({ insertTargetCwd: "/other" });
    rightClick(w.findAll('[data-testid="files-row"]')[0].element);
    await flushPromises();

    expect(labels()).toEqual(["Show in folder", "Insert absolute path"]);
  });

  it("opens from the keyboard, on both spellings of the menu key", async () => {
    const w = await mountPane();
    const row = w.findAll('[data-testid="files-row"]')[0];

    await row.trigger("keydown", { key: "F10", shiftKey: true });
    expect(menu()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(menu()).toBeNull();

    await row.trigger("keydown", { key: "ContextMenu" });
    expect(menu()).not.toBeNull();
  });

  // The whole point of the Shift+F10 entrance. Without the focus move the menu renders where a
  // keyboard user cannot reach it: the items are in a Teleport at the END of the document, a
  // page of tab stops from the tree they were opened in (Codex, PR #1912).
  it("is usable from the keyboard end to end: open, move, activate", async () => {
    const w = await mountPane();
    const row = w.findAll('[data-testid="files-row"]')[0];
    await row.trigger("keydown", { key: "F10", shiftKey: true });
    await flushPromises();
    // The first item, which since #2039 is the file-manager entry rather than an insert.
    expect(document.activeElement).toBe(item("reveal"));

    menu()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(item("insert-relative"));
    menu()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(item("insert-absolute"));
    menu()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(item("reveal")); // wraps

    menu()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(item("insert-relative"));

    (document.activeElement as HTMLElement).click(); // what Enter does on a button
    await flushPromises();
    expect(w.emitted("insert-text")).toEqual([["README.md "]]);
  });

  // Focus left on a removed menu item drops the keyboard to the top of the document — the same
  // rule the cell's path menu and the launch panel already follow.
  it("gives the keyboard back to the row when the menu is dismissed", async () => {
    const w = await mountPane();
    const row = w.findAll('[data-testid="files-row"]')[0].element as HTMLElement;
    row.focus();
    rightClick(row);
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(document.activeElement).toBe(row);
  });

  // But NOT after an insert. `insertText` ends in `term.focus()`, so the terminal is where the
  // user is about to type the sentence the path belongs to — taking the keyboard back to the
  // tree would be the pane undoing the thing it was just asked to do.
  it("does not take the keyboard back after inserting", async () => {
    const w = await mountPane();
    const row = w.findAll('[data-testid="files-row"]')[0].element as HTMLElement;
    row.focus();
    rightClick(row);
    await flushPromises();

    item("insert-relative")?.click();
    await flushPromises();
    expect(document.activeElement).not.toBe(row);
  });

  // ...but NOT when the user has already said where focus belongs by clicking somewhere else.
  it("closes on a click outside without taking focus back", async () => {
    const w = await mountPane();
    const row = w.findAll('[data-testid="files-row"]')[0].element as HTMLElement;
    rightClick(row);
    await flushPromises();

    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(menu()).toBeNull();
    expect(document.activeElement).not.toBe(row);
  });

  // A left-click still opens the file: the menu is an addition to the row, not a replacement.
  it("leaves the row's own click alone", async () => {
    const w = await mountPane();
    await w.findAll('[data-testid="files-row"]')[0].trigger("click");
    await flushPromises();
    expect(fakeEditor.setDoc).toHaveBeenCalledWith("# hello", "README.md");
  });
});
