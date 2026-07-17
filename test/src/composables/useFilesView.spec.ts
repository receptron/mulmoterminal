import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../src/router";
import { filesGotoIndex, filesClose, useFilesView } from "./useFilesView";

// Drives the real singleton router (jsdom web-history) — the composables are bound to
// it. Each test starts from chat, then navigates to the origin under test.
const settle = () => flushPromises();

describe("useFilesView return-to-origin", () => {
  beforeEach(async () => {
    await router.push("/");
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

  it("returns to chat when Files was opened from the single view", async () => {
    filesGotoIndex("/proj");
    await settle();
    expect(router.currentRoute.value.name).toBe("files");

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
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

  // Regression (codex #273, mirrored here): the origin rides the history entry, so a
  // /files reached WITHOUT filesGotoIndex (browser back/forward, direct load) must fall
  // back to chat — never a stale origin captured by an earlier open.
  it("falls back to chat for a history-driven /files, ignoring an earlier open's origin", async () => {
    await router.push("/terminals");
    await settle();
    filesGotoIndex("/proj"); // captures /terminals into that entry's state
    await settle();

    await router.push("/");
    await settle();
    await router.push("/files"); // fresh /files entry, no captured origin
    await settle();

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("chat");
  });
});
