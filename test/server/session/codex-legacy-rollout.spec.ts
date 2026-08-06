import { describe, expect, it } from "vitest";
import { parseLegacyCodexRolloutId } from "../../../server/session/codex-legacy-rollout.js";

const session = "11111111-1111-4111-8111-111111111111";
const first = "22222222-2222-4222-8222-222222222222";
const last = "33333333-3333-4333-8333-333333333333";

describe("parseLegacyCodexRolloutId", () => {
  it("uses the last valid matching row and ignores malformed rows", () => {
    expect(parseLegacyCodexRolloutId(`bad\n${session}\t${first}\n${session}\tnope\n${session}\t${last}\n`, session)).toBe(last);
  });
  it("rejects empty or invalid ids", () => {
    expect(parseLegacyCodexRolloutId(`${session}\t${first}\n`, "")).toBeNull();
    expect(parseLegacyCodexRolloutId(`${session}\t${first}\n`, "not-a-uuid")).toBeNull();
  });
});
