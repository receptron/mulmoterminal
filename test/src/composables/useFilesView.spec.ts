import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../../../src/router/index";
import { filesGotoIndex, filesClose, useFilesView } from "../../../src/composables/useFilesView";

// Drives the real singleton router (jsdom web-history) — the composables are bound to
// it. Each test starts from chat, then navigates to the origin under test.
const settle = () => flushPromises();

describe("useFilesView return-to-origin", () => {
  beforeEach(async () => {
    await router.push({ name: "chat" });
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

  // Regression (codex #273, mirrored here): the origin rides the history entry, so a /files
  // reached WITHOUT filesGotoIndex (browser back/forward, direct load) must fall back to the
  // default view — never a stale origin captured by an earlier open.
  //
  // The earlier open captures CHAT and the fallback is the grid (#1190), deliberately opposite
  // values. Written the other way round the two answers coincide, and the test passes whether the
  // stale origin was ignored or reused — which is the whole thing it exists to catch.
  it("falls back to the default view for a history-driven /files, ignoring an earlier open's origin", async () => {
    await router.push({ name: "chat" });
    await settle();
    filesGotoIndex("/proj"); // captures /chat into that entry's state
    await settle();

    await router.push("/terminals");
    await settle();
    await router.push("/files"); // fresh /files entry, no captured origin
    await settle();

    filesClose();
    await settle();
    expect(router.currentRoute.value.name).toBe("terminals");
  });
});
