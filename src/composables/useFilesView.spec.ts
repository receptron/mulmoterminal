import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { router } from "../router";
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
});
