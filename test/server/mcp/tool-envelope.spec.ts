// @vitest-environment node
import { describe, it, expect } from "vitest";

import { interpretToolEnvelope } from "../../../server/mcp/tool-envelope.js";

describe("interpretToolEnvelope — the GUI publish", () => {
  // Publish only when there is data. Flip this and every plugin panel either stops rendering
  // or the GUI floods with empty results.
  it("publishes when the plugin returned data", () => {
    expect(interpretToolEnvelope({ data: { rows: [] } }).publish).not.toBeNull();
  });

  it("does not publish when there is no data", () => {
    expect(interpretToolEnvelope({ message: "noted" }).publish).toBeNull();
  });

  // null / false / 0 / "" are real data a view may render — only `undefined` means "nothing".
  it.each([[null], [false], [0], [""]])("treats %j as data worth publishing", (data) => {
    expect(interpretToolEnvelope({ data }).publish).not.toBeNull();
  });

  it("carries title, data and message through", () => {
    const r = interpretToolEnvelope({ data: 1, title: "T", message: "M" });
    expect(r.publish).toMatchObject({ title: "T", data: 1, message: "M" });
  });

  // The structured view falls back to the plain data when the plugin sent no separate form.
  it("uses jsonData when present, else data", () => {
    expect(interpretToolEnvelope({ data: 1, jsonData: 2 }).publish?.jsonData).toBe(2);
    expect(interpretToolEnvelope({ data: 1 }).publish?.jsonData).toBe(1);
  });
});

describe("interpretToolEnvelope — the narration to claude", () => {
  it("joins message and instructions", () => {
    expect(interpretToolEnvelope({ message: "saved", instructions: "now ask X" }).narration).toBe("saved\nnow ask X");
  });

  it("uses whichever of the two is present", () => {
    expect(interpretToolEnvelope({ message: "only message" }).narration).toBe("only message");
    expect(interpretToolEnvelope({ instructions: "only instructions" }).narration).toBe("only instructions");
  });

  // Lose this and claude gets "Done" instead of the plugin's instructions and stops following
  // up — a silent regression across all plugins.
  it("never returns an empty string", () => {
    expect(interpretToolEnvelope({}).narration).toBe("Done");
    expect(interpretToolEnvelope({ data: 1 }).narration).toBe("Done");
  });

  // filter(Boolean) drops empty strings, so a blank message must not produce a leading newline.
  it("does not join a blank part into the narration", () => {
    expect(interpretToolEnvelope({ message: "", instructions: "go" }).narration).toBe("go");
  });
});
