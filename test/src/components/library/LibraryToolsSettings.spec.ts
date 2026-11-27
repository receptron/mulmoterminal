// Claude Code's settings for a directory, inside the kept Library: shown again, they are read again,
// and a read that fails then keeps the ones shown.
import { describe, it, expect, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const settings = (allow: string) => ({
  cwd: "/w/app",
  files: [{ source: "user", path: "/h/.claude/settings.json", state: "ok" }],
  permissions: { allow: [{ value: allow, source: "user" }], ask: [], deny: [] },
  env: [],
  hooks: [],
  other: [],
});
const { loadToolSettings } = vi.hoisted(() => ({ loadToolSettings: vi.fn() }));
vi.mock("../../../../src/composables/libraryApi", () => ({ loadToolSettings }));

const LibraryToolsSettings = (await import("../../../../src/components/library/LibraryToolsSettings.vue")).default;

describe("LibraryToolsSettings", () => {
  it("reads the settings again each time the Library is shown, keeping them through a failed read", async () => {
    loadToolSettings.mockResolvedValueOnce(settings("Bash(npm test)")).mockResolvedValueOnce(settings("Bash(yarn test)")).mockResolvedValue(null);
    const { wrapper, showAgain } = mountUnderOverlay(LibraryToolsSettings, { cwd: "/w/app" });
    await flushPromises();
    expect(wrapper.text()).toContain("Bash(npm test)");
    await showAgain();
    expect(wrapper.text()).toContain("Bash(yarn test)");
    await showAgain();
    expect(wrapper.text()).toContain("Bash(yarn test)");
    wrapper.unmount();
  });
});
