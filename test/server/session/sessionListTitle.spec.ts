// @vitest-environment node
import { describe, it, expect } from "vitest";

import { sessionListTitle, UNTITLED_SESSION } from "../../../server/session/sessionListTitle.js";

const NONE = { liveAiTitle: undefined, diskAiTitle: null, diskLastPrompt: null, firstUserMsg: null };

describe("sessionListTitle", () => {
  it("prefers the live AI title over every disk source", () => {
    const title = sessionListTitle({ liveAiTitle: "live", diskAiTitle: "disk-ai", diskLastPrompt: "prompt", firstUserMsg: "first" });
    expect(title).toBe("live");
  });

  it("falls through disk-ai, then last-prompt, then first user message when the live title is absent", () => {
    expect(sessionListTitle({ ...NONE, diskAiTitle: "disk-ai", diskLastPrompt: "prompt", firstUserMsg: "first" })).toBe("disk-ai");
    expect(sessionListTitle({ ...NONE, diskLastPrompt: "prompt", firstUserMsg: "first" })).toBe("prompt");
    expect(sessionListTitle({ ...NONE, firstUserMsg: "first" })).toBe("first");
  });

  // `||`, not `??`: an empty string at any tier means "nothing usable here", so it is skipped
  // rather than pinned as the title.
  it("skips an empty string at each tier and takes the next non-empty source", () => {
    expect(sessionListTitle({ liveAiTitle: "", diskAiTitle: "disk-ai", diskLastPrompt: "prompt", firstUserMsg: "first" })).toBe("disk-ai");
    expect(sessionListTitle({ liveAiTitle: "", diskAiTitle: "", diskLastPrompt: "prompt", firstUserMsg: "first" })).toBe("prompt");
    expect(sessionListTitle({ liveAiTitle: "", diskAiTitle: "", diskLastPrompt: "", firstUserMsg: "first" })).toBe("first");
  });

  // THE contract that makes this a `||` and not a `??`: a live title of "" must NOT win — it
  // is not the detail view's "the user cleared it", it means "fall through to disk".
  it("lets a real disk title win over an empty live title", () => {
    expect(sessionListTitle({ ...NONE, liveAiTitle: "", diskAiTitle: "実タイトル" })).toBe("実タイトル");
  });

  it("returns the sentinel when nothing is present", () => {
    expect(sessionListTitle(NONE)).toBe(UNTITLED_SESSION);
  });

  it("returns the sentinel when every tier is an empty string", () => {
    expect(sessionListTitle({ liveAiTitle: "", diskAiTitle: "", diskLastPrompt: "", firstUserMsg: "" })).toBe(UNTITLED_SESSION);
  });
});
