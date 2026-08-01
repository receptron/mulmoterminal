import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import { filesGotoIndex, filesClose, useFilesView } from "../../../src/composables/useFilesView";

// Drives the real singleton router (jsdom web-history) — the composables are bound to
// it. Each test starts from the grid, which is the only view there is.
const settle = () => flushPromises();

describe("useFilesView return-to-origin", () => {
  beforeEach(async () => {
    await router.push("/terminals");
    await settle();
  });

  it("returns to the grid when Files was opened from the grid", async () => {
    await router.push("/terminals");
    await settle();

    filesGotoIndex("/proj");
    await settle();
    expect(router.currentRoute.value.name).toBe("files");

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("keeps the grid origin when the root dir changes while already in Files", async () => {
    await router.push("/terminals");
    await settle();
    filesGotoIndex("/proj");
    await settle();

    // Changing the browsed root re-pushes /files while already open — origin must hold.
    filesGotoIndex("/proj/sub");
    await settle();
    expect(router.currentRoute.value.name).toBe("files");

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });

  it("exposes the ?cwd= query as the browsed root", async () => {
    filesGotoIndex("/work/app");
    await settle();
    expect(useFilesView().cwd.value).toBe("/work/app");
  });

  // Regression (codex #273, mirrored here): the origin rides the history entry, so a /files
  // reached WITHOUT filesGotoIndex (browser back/forward, direct load) must fall back to the
  // default view — never a stale origin captured by an earlier open.
  //
  // What this can still discriminate, now that there is only one view: the fresh entry carries NO
  // captured origin of its own. It used to capture chat and expect the grid — deliberately
  // opposite values — and that version died with the second view, since every origin is now the
  // grid and the two answers coincide. So the claim is made about the history STATE, which is
  // where the staleness would live, rather than about the landing route.
  it("falls back to the default view for a history-driven /files, ignoring an earlier open's origin", async () => {
    await router.push("/terminals");
    await settle();
    filesGotoIndex("/proj"); // captures /terminals into THAT entry's state
    await settle();
    expect(router.options.history.state.returnPath).toBe("/terminals");

    await router.push("/files"); // fresh /files entry, no captured origin
    await settle();
    expect(router.options.history.state.returnPath).toBeUndefined();

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });
});
