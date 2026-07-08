import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import LauncherCell from "./LauncherCell.vue";

// Stub the terminal so no xterm/WebSocket is needed; it just forwards the props the
// cell passes and can emit session/exit.
vi.mock("./Terminal.vue", () => ({
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

  it("does not zoom on a header-background click in the normal grid (only the ⤢ button)", async () => {
    const w = mountCell(); // zoomed: undefined → normal grid
    expect(w.find(".cell-header").classes()).not.toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });

  it("zooms on a header-background click when it's a filmstrip thumbnail", async () => {
    const w = mountCell({ zoomed: true }); // some other cell is zoomed → this is a thumbnail
    expect(w.find(".cell-header").classes()).toContain("is-zoomable");
    await w.find(".cell-header").trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });
});
