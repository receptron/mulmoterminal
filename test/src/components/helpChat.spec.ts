import { describe, it, expect, vi, beforeEach } from "vitest";

// A plain `{ value }` stands in for the launcher's ref: helpChat reads `launchAgent.value` and nothing
// else, and a real ref cannot be made here — vi.hoisted runs before the imports it would need.
const launcher = vi.hoisted(() => ({ agent: { value: "claude" as "claude" | "codex" }, start: vi.fn(async () => null) }));
vi.mock("../../../src/composables/useChatLauncher", () => ({ launchAgent: launcher.agent, startCollectionChat: launcher.start }));

import { openHelpChat, HELP_SKILL } from "../../../src/components/helpChat";

beforeEach(() => {
  launcher.start.mockClear();
  launcher.agent.value = "claude";
});

describe("openHelpChat", () => {
  it("seeds the bundled help skill as a slash command for claude", async () => {
    await openHelpChat();
    expect(launcher.start).toHaveBeenCalledWith(`/${HELP_SKILL}`, expect.anything());
  });

  // codex's parser drops an unknown `/word`; the seed has to be the sentence form (skillSeed).
  it("seeds it as a sentence for codex", async () => {
    launcher.agent.value = "codex";
    await openHelpChat();
    expect(launcher.start).toHaveBeenCalledWith(`Use the "${HELP_SKILL}" skill.`, expect.anything());
  });

  // The question is about the app, so the chat runs in the workspace whatever collection is open —
  // `project: null` is the explicit "no project", as opposed to undefined, which inherits the surface's.
  it("always asks for the workspace, never the collection on screen", async () => {
    await openHelpChat();
    expect(launcher.start).toHaveBeenCalledWith(`/${HELP_SKILL}`, { project: null });
  });
});
