// @vitest-environment node
import { describe, it, expect } from "vitest";

import { buildPushDetail, pushWhere, shouldSuppressPush, NO_CWD_LABEL } from "../../../server/session/taskPushRules.js";

describe("buildPushDetail", () => {
  it("prefers the reply over the last prompt and the AI title", () => {
    expect(buildPushDetail({ reply: "did the thing", lastPrompt: "do the thing", aiTitle: "the thing" })).toBe("did the thing");
  });

  it("falls back to the last prompt when there is no reply", () => {
    expect(buildPushDetail({ reply: null, lastPrompt: "do the thing", aiTitle: "the thing" })).toBe("do the thing");
  });

  it("falls back to the AI title when there is neither reply nor last prompt", () => {
    expect(buildPushDetail({ reply: null, lastPrompt: undefined, aiTitle: "the thing" })).toBe("the thing");
  });

  // `||`, not `??`: an empty string at any tier means "nothing usable here", so it is skipped
  // rather than pinned as the body.
  it("skips an empty-string reply and takes the last prompt", () => {
    expect(buildPushDetail({ reply: "", lastPrompt: "do the thing", aiTitle: "the thing" })).toBe("do the thing");
  });

  it("skips an empty-string last prompt and takes the AI title", () => {
    expect(buildPushDetail({ reply: null, lastPrompt: "", aiTitle: "the thing" })).toBe("the thing");
  });

  it("returns the empty string when nothing is present", () => {
    expect(buildPushDetail({ reply: null, lastPrompt: undefined, aiTitle: undefined })).toBe("");
  });

  it("returns the empty string when every tier is empty", () => {
    expect(buildPushDetail({ reply: "", lastPrompt: "", aiTitle: "" })).toBe("");
  });
});

describe("shouldSuppressPush", () => {
  it("suppresses when the session is hidden", () => {
    expect(shouldSuppressPush(true, false)).toBe(true);
  });

  it("suppresses when the session is a translation worker", () => {
    expect(shouldSuppressPush(false, true)).toBe(true);
  });

  it("suppresses when both flags are set", () => {
    expect(shouldSuppressPush(true, true)).toBe(true);
  });

  it("does not suppress a real user task", () => {
    expect(shouldSuppressPush(false, false)).toBe(false);
  });
});

describe("pushWhere", () => {
  it("uses the working directory's basename when a cwd is present", () => {
    expect(pushWhere("/Users/isamu/ss/llm/mulmoterminal2")).toBe("mulmoterminal2");
  });

  it("falls back to the sentinel label when there is no cwd", () => {
    expect(pushWhere(null)).toBe(NO_CWD_LABEL);
    expect(pushWhere(null)).toBe("session");
  });
});
