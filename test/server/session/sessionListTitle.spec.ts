// @vitest-environment node
import { describe, it, expect } from "vitest";

import { sessionListTitle, UNTITLED_SESSION } from "../../../server/session/sessionListTitle.js";

const NONE = { memo: undefined, liveAiTitle: undefined, diskAiTitle: null, diskLastPrompt: null, firstUserMsg: null };

describe("sessionListTitle", () => {
  it("prefers the live AI title over every disk source", () => {
    const title = sessionListTitle({ memo: undefined, liveAiTitle: "live", diskAiTitle: "disk-ai", diskLastPrompt: "prompt", firstUserMsg: "first" });
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
    expect(sessionListTitle({ memo: undefined, liveAiTitle: "", diskAiTitle: "disk-ai", diskLastPrompt: "prompt", firstUserMsg: "first" })).toBe("disk-ai");
    expect(sessionListTitle({ memo: undefined, liveAiTitle: "", diskAiTitle: "", diskLastPrompt: "prompt", firstUserMsg: "first" })).toBe("prompt");
    expect(sessionListTitle({ memo: undefined, liveAiTitle: "", diskAiTitle: "", diskLastPrompt: "", firstUserMsg: "first" })).toBe("first");
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
    expect(sessionListTitle({ memo: undefined, liveAiTitle: "", diskAiTitle: "", diskLastPrompt: "", firstUserMsg: "" })).toBe(UNTITLED_SESSION);
  });

  // The point of the memo (#1084): every other tier is what the AGENT said, so the one line the
  // user wrote about what this session is FOR has to outrank all of them.
  it("lets the user's memo win over every generated title", () => {
    const title = sessionListTitle({ memo: "#1077 の検証", liveAiTitle: "live", diskAiTitle: "disk-ai", diskLastPrompt: "prompt", firstUserMsg: "first" });
    expect(title).toBe("#1077 の検証");
  });

  // An erased memo is DELETED from the store, so the map lookup feeding this is `undefined`.
  // "" reaching here anyway (a hand-edited log line) must not pin a blank title on the row.
  it("falls through an absent or empty memo", () => {
    expect(sessionListTitle({ ...NONE, liveAiTitle: "live" })).toBe("live");
    expect(sessionListTitle({ ...NONE, memo: "", liveAiTitle: "live" })).toBe("live");
  });
});
