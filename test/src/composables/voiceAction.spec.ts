import { describe, it, expect } from "vitest";

import { modelReadiness, voiceAction } from "../../../src/composables/voiceAction";

const state = (over: Partial<Parameters<typeof voiceAction>[0]> = {}) => ({ listening: false, available: false, downloading: false, ...over });

describe("voiceAction", () => {
  it("stops a capture that is running", () => {
    expect(voiceAction(state({ listening: true }))).toBe("stop");
  });

  // Stopping outranks everything: a press while listening must never start a download.
  it("stops even when a download is also in progress", () => {
    expect(voiceAction(state({ listening: true, downloading: true, available: true }))).toBe("stop");
  });

  it("starts a capture when the model is ready", () => {
    expect(voiceAction(state({ available: true }))).toBe("start");
  });

  it("offers to download when there is no model yet", () => {
    expect(voiceAction(state())).toBe("download");
  });

  // The guard that matters: the button looks like it is doing nothing while a download runs,
  // so an impatient user clicks it repeatedly. Each click must not re-POST the download.
  it("does nothing while a download is already running", () => {
    expect(voiceAction(state({ downloading: true }))).toBe("none");
  });

  it("prefers starting over downloading once the model has landed", () => {
    expect(voiceAction(state({ available: true, downloading: true }))).toBe("start");
  });
});

describe("modelReadiness", () => {
  it("is ready only when the platform can run it AND the model finished", () => {
    expect(modelReadiness({ capable: true, model: { state: "ready" } })).toEqual({ ready: true, downloading: false });
  });

  it("is not ready on a platform that cannot run it, however ready the model", () => {
    expect(modelReadiness({ capable: false, model: { state: "ready" } }).ready).toBe(false);
  });

  it("is not ready while the model is still downloading", () => {
    expect(modelReadiness({ capable: true, model: { state: "downloading" } })).toEqual({ ready: false, downloading: true });
  });

  // A status blip must degrade to "not ready" rather than throwing inside the poll that
  // produced it — that is what the optional chaining is for.
  it.each([[null], [undefined], [{}], [{ capable: true }], [{ model: {} }], [{ capable: "yes" }]])("degrades to not-ready for %j", (status) => {
    expect(modelReadiness(status as never)).toEqual({ ready: false, downloading: false });
  });
});
