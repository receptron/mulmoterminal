import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";

// #2446. The grid registers its terminals with the palette; going to one from another screen brings
// the grid back as well.
const route = vi.hoisted(() => ({ name: "terminals" as string, pushed: [] as string[] }));
vi.mock("../../../src/router", () => ({
  router: {
    currentRoute: {
      get value() {
        return { name: route.name };
      },
    },
    push: (path: string) => {
      route.pushed.push(path);
      return Promise.resolve();
    },
  },
}));

import type { Cell } from "../../../src/components/gridTabs";

const { usePaletteTerminals } = await import("../../../src/composables/usePaletteTerminals");
const { paletteTerminals } = await import("../../../src/composables/commandPalette");

const rows = [
  { uid: 1, cwd: "/home/me/app", agent: "claude", memo: null, summary: null },
  { uid: 2, cwd: null, agent: null, memo: null, summary: null },
];

let gridFull = false;
let actingUid: number | null = null;
let actingCell: Cell | null = null;
const workspace = ref<string | null>("/home/me/ws");
const mountGrid = (jump: (uid: number) => void) =>
  mount(
    defineComponent({
      setup() {
        usePaletteTerminals(
          () => rows,
          ref("/home/me"),
          { jumpToTerminal: jump, currentUid: () => actingUid, currentCell: () => actingCell },
          { presets: ref([{ label: "app", path: "/home/me/app" }]), defaultCwd: workspace, full: () => gridFull, openSessionIds: ref(["s-open"]) },
        );
        return () => h("div");
      },
    }),
  );

describe("usePaletteTerminals", () => {
  beforeEach(() => {
    route.name = "terminals";
    route.pushed = [];
  });

  it("lists the cells that have a directory, and withdraws them on unmount", () => {
    const w = mountGrid(() => {});
    expect(paletteTerminals.value?.list().map((terminal) => terminal.path)).toEqual(["~/app"]);
    w.unmount();
    expect(paletteTerminals.value).toBeNull();
  });

  it("jumps on the grid without navigating", () => {
    const jump = vi.fn();
    const w = mountGrid(jump);
    paletteTerminals.value?.goTo(1);
    expect(jump).toHaveBeenCalledWith(1);
    expect(route.pushed).toEqual([]);
    w.unmount();
  });

  it("brings the grid back when picked from another screen", () => {
    route.name = "wiki";
    const jump = vi.fn();
    const w = mountGrid(jump);
    paletteTerminals.value?.goTo(1);
    expect(route.pushed).toEqual(["/terminals"]);
    expect(jump).toHaveBeenCalledWith(1);
    w.unmount();
  });

  it("does nothing for a terminal that is no longer in the grid", () => {
    route.name = "wiki";
    const jump = vi.fn();
    const w = mountGrid(jump);
    paletteTerminals.value?.goTo(99);
    expect(route.pushed).toEqual([]);
    expect(jump).not.toHaveBeenCalled();
    w.unmount();
  });

  // #2484. The grid holds the loaded presets, so it hands the palette the launch directories.
  it("offers the workspace and the recent directories to start a terminal in", () => {
    const w = mountGrid(() => {});
    expect(paletteTerminals.value?.launchDirs().map((dir) => dir.path)).toEqual(["/home/me/ws", "/home/me/app"]);
    w.unmount();
  });

  // #2498. The grid names the sessions it already has, which a resume row must not offer again.
  it("names the sessions the grid already has open", () => {
    const w = mountGrid(() => {});
    expect(paletteTerminals.value?.openSessionIds()).toEqual(["s-open"]);
    w.unmount();
  });

  it("says whether the grid is full, asked at the moment the palette lists", () => {
    const w = mountGrid(() => {});
    gridFull = true;
    expect(paletteTerminals.value?.full()).toBe(true);
    gridFull = false;
    expect(paletteTerminals.value?.full()).toBe(false);
    w.unmount();
  });

  // #2487. A start runs where the acting terminal is; with none (or one with no directory yet), in
  // the workspace; before the workspace is known, nowhere.
  it("starts in the acting terminal's directory, else the workspace, else nowhere", () => {
    const w = mountGrid(() => {});
    actingUid = 1;
    expect(paletteTerminals.value?.startDir()).toEqual({ path: "/home/me/app", label: "~/app" });
    actingUid = 2;
    expect(paletteTerminals.value?.startDir()?.path).toBe("/home/me/ws");
    actingUid = null;
    expect(paletteTerminals.value?.startDir()?.path).toBe("/home/me/ws");
    workspace.value = null;
    expect(paletteTerminals.value?.startDir()).toBeNull();
    workspace.value = "/home/me/ws";
    w.unmount();
  });

  // #2523. Whose prompts the palette lists: the acting cell's, when it runs an agent with a session.
  it("names the acting agent terminal as the source of prompts, and no other kind", () => {
    const w = mountGrid(() => {});
    actingCell = { uid: 4, session: "s-4", cwd: "/home/me/app", agent: "codex" };
    expect(paletteTerminals.value?.promptSource()).toEqual({ uid: 4, slotKey: "cell-4", session: "s-4", agent: "codex", cwd: "/home/me/app", host: null });
    actingCell = { uid: 5, session: null, cwd: "/home/me/app" };
    expect(paletteTerminals.value?.promptSource()).toBeNull();
    actingCell = null;
    w.unmount();
  });
});
