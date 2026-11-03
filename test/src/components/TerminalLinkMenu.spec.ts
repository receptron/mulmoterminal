// The right-click menu on a printed path (#3238): opens where it was asked for, offers the four
// actions, and closes on a pick, on Escape and on a click elsewhere.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalLinkMenu from "../../../src/components/TerminalLinkMenu.vue";
import { closeLinkMenu, linkMenuRequest, requestLinkMenu } from "../../../src/composables/terminalLinkMenu";

const writeText = vi.fn(() => Promise.resolve());
const paneOpener = vi.fn<(...args: unknown[]) => boolean>(() => false);
vi.mock("../../../src/composables/filesPaneOpener", () => ({
  tryOpenInPane: (...args: unknown[]) => paneOpener(...args),
  openOutsideFile: vi.fn(),
}));
const gotoFile = vi.fn<(...args: unknown[]) => void>();
vi.mock("../../../src/composables/useFilesView", () => ({ filesGotoFile: (...args: unknown[]) => gotoFile(...args) }));

const panel = () => document.body.querySelector<HTMLElement>("[data-testid=terminal-link-menu]");
const item = (id: string) => document.body.querySelector<HTMLButtonElement>(`[data-testid=${id}]`);

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => {
  closeLinkMenu();
  vi.useRealTimers();
  vi.restoreAllMocks();
  writeText.mockClear();
  paneOpener.mockClear();
  gotoFile.mockClear();
});

const open = async (text = "docs/a.md") => {
  const wrapper = mount(TerminalLinkMenu, { attachTo: document.body });
  requestLinkMenu({ text, cwd: "/proj", location: undefined, point: { top: 40, left: 60 } });
  await nextTick();
  await nextTick();
  return wrapper;
};

describe("TerminalLinkMenu", () => {
  it("is absent until a terminal asks, then opens at the pointer with the path and four items", async () => {
    const wrapper = mount(TerminalLinkMenu, { attachTo: document.body });
    expect(panel()).toBeNull();
    requestLinkMenu({ text: "docs/a.md", cwd: "/proj", location: undefined, point: { top: 40, left: 60 } });
    await nextTick();
    await nextTick();
    expect(panel()?.style.top).toBe("40px");
    expect(panel()?.style.left).toBe("60px");
    expect(panel()?.textContent).toContain("docs/a.md");
    expect(document.body.querySelectorAll("[data-testid=terminal-link-menu] [role=menuitem]")).toHaveLength(4);
    wrapper.unmount();
  });

  it("opens the path in a new tab through its route, and closes", async () => {
    const wrapper = await open();
    item("link-open-tab")?.click();
    expect(window.open).toHaveBeenCalledWith("/api/files/browse/md?cwd=%2Fproj&path=docs%2Fa.md", "_blank", "noopener,noreferrer");
    await nextTick();
    expect(linkMenuRequest.value).toBeNull();
    expect(panel()).toBeNull();
    wrapper.unmount();
  });

  it("asks the pane first for the pane item, and goes to the Files view for that item", async () => {
    const wrapper = await open("src/a.ts");
    item("link-open-pane")?.click();
    expect(paneOpener).toHaveBeenCalledWith("src/a.ts", "/proj", undefined, false);
    expect(gotoFile).toHaveBeenCalledWith("/proj", "src/a.ts", undefined);
    gotoFile.mockClear();
    requestLinkMenu({ text: "src/a.ts", cwd: "/proj", location: { line: 7, col: null }, point: { top: 1, left: 1 } });
    await nextTick();
    await nextTick();
    item("link-open-files")?.click();
    expect(gotoFile).toHaveBeenCalledWith("/proj", "src/a.ts", { line: 7, col: null });
    wrapper.unmount();
  });

  it("copies the absolute path and says so where the menu was", async () => {
    const wrapper = await open("docs/a.md");
    item("link-copy-path")?.click();
    expect(writeText).toHaveBeenCalledWith("/proj/docs/a.md");
    await nextTick();
    await nextTick();
    const notice = document.body.querySelector<HTMLElement>("[data-testid=terminal-link-notice]");
    expect(notice?.textContent?.trim()).toBe("Path copied");
    // Below the pointer, so the link it was opened on stays clickable while it shows.
    expect(notice?.style.top).toBe("68px");
    expect(notice?.className).not.toContain("pointer-events-none");
    wrapper.unmount();
  });

  // The terminal had the focus; the menu takes it for its first item and gives it back on close,
  // whether an item was picked or the menu was dismissed.
  it("gives the focus back to what had it, on a pick and on Escape", async () => {
    const box = document.createElement("textarea");
    document.body.append(box);
    box.focus();
    expect(document.activeElement).toBe(box);
    const wrapper = await open("docs/a.md");
    expect(document.activeElement).not.toBe(box);
    item("link-copy-path")?.click();
    await nextTick();
    expect(document.activeElement).toBe(box);
    requestLinkMenu({ text: "docs/a.md", cwd: "/proj", location: undefined, point: { top: 1, left: 1 } });
    await nextTick();
    await nextTick();
    expect(document.activeElement).not.toBe(box);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(document.activeElement).toBe(box);
    wrapper.unmount();
    box.remove();
  });

  it("takes the notice down again on its own", async () => {
    const wrapper = await open("docs/a.md");
    vi.useFakeTimers();
    item("link-copy-path")?.click();
    await nextTick();
    await nextTick();
    expect(document.body.querySelector("[data-testid=terminal-link-notice]")).not.toBeNull();
    vi.runAllTimers();
    await nextTick();
    expect(document.body.querySelector("[data-testid=terminal-link-notice]")).toBeNull();
    wrapper.unmount();
  });

  // The menu has closed by the time a write is refused, so the refusal has to be said — with the
  // path, so it can be taken by hand — not swallowed.
  it("says when the clipboard refuses the write, and shows the path", async () => {
    writeText.mockRejectedValueOnce(new Error("NotAllowedError"));
    const wrapper = await open("docs/a.md");
    item("link-copy-path")?.click();
    await nextTick();
    await nextTick();
    expect(document.body.querySelector("[data-testid=terminal-link-notice]")?.textContent?.trim()).toBe("The path could not be copied: /proj/docs/a.md");
    wrapper.unmount();
  });

  // A `role="menu"` is driven from the keyboard the way the other menus are: the arrows walk the
  // items and wrap, Home and End jump, and Tab leaves it rather than wandering off with it open.
  it("walks the items with the arrow keys, Home and End, and leaves on Tab", async () => {
    const wrapper = await open();
    const items = [...document.body.querySelectorAll<HTMLElement>("[data-testid=terminal-link-menu] [role=menuitem]")];
    const press = (key: string): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      document.activeElement?.dispatchEvent(event);
      return event;
    };
    expect(document.activeElement).toBe(items[0]);
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    press("End");
    expect(document.activeElement).toBe(items[3]);
    press("ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press("ArrowUp");
    expect(document.activeElement).toBe(items[3]);
    press("Home");
    expect(document.activeElement).toBe(items[0]);
    expect(press("Tab").defaultPrevented).toBe(true);
    await nextTick();
    expect(panel()).toBeNull();
    wrapper.unmount();
  });

  it("closes on Escape and on a pointer down elsewhere", async () => {
    const wrapper = await open();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(panel()).toBeNull();
    requestLinkMenu({ text: "docs/a.md", cwd: "/proj", location: undefined, point: { top: 1, left: 1 } });
    await nextTick();
    await nextTick();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(panel()).toBeNull();
    wrapper.unmount();
  });
});
