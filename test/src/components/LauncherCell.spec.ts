import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import LauncherCell from "../../../src/components/LauncherCell.vue";

// Stub the terminal so no xterm/WebSocket is needed; it just forwards the props the
// cell passes and can emit session/exit.
vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["persistKey", "sessionId", "connectKey", "cwd", "launcher"],
    emits: ["session", "exit"],
    template: '<div class="stub-term" />',
  },
}));

const LAUNCHER = { index: 1, label: "zsh" };
const baseProps = { uid: 7, expanded: false, launcher: LAUNCHER, session: null, cwd: "/work/proj", home: "/work" };
const mountCell = (extra: Record<string, unknown> = {}) => mount(LauncherCell, { props: { ...baseProps, ...extra } });

describe("LauncherCell header zoom", () => {
  // #965: the whole cell — header included — sits in one wrapper, so the focus zoom can be
  // cancelled about the cell's own centre. A second element child, or content left outside the
  // wrapper, would scale with the frame and resample the terminal's canvas.
  it("keeps its whole content in the focus-zoom wrapper", () => {
    const root = mountCell().element;
    expect(root.children).toHaveLength(1);
    expect(root.children[0].className).toContain("group-[.focused]/cell:scale-[calc(1/var(--focus-zoom))]");
  });

  it("shows the label + dir and runs the configured launcher in its directory", () => {
    const w = mountCell();
    expect(w.find(".cell-cmd").text()).toContain("zsh");
    const term = w.findComponent({ name: "TerminalView" });
    expect(term.props("launcher")).toEqual({ index: 1 });
    expect(term.props("cwd")).toBe("/work/proj");
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
    const w = mountCell({ zoomed: true }); // some other cell is zoomed → this is a thumbnail
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("does not zoom on a header-background click while expanded (restore via the ⤡ button)", async () => {
    const w = mountCell({ expanded: true });
    expect(w.find(".cell-header").classes()).not.toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });

  // #2007. A launcher cell has no `toggle-park` in its event binding (cellShellEvents), so a park
  // button here is one that clicks and does nothing. It shipped that way for eleven releases: the
  // guard in CellChromeButtons asked whether `parked` was undefined, and Vue casts an absent
  // boolean prop to `false`. Mounted here rather than only on the buttons because this — a cell
  // the user actually opens — is where it was visible.
  it("offers no park button: a launched program is not a session to set aside", () => {
    expect(mountCell().find('[data-testid="cell-park-btn"]').exists()).toBe(false);
    expect(mountCell({ expanded: true }).find('[data-testid="cell-park-btn"]').exists()).toBe(false);
  });
});
