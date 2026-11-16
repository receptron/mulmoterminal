// presentBrep's View divides a `height: 100%` column between the model and a part that scrolls,
// so its registration has to give it a definite frame; and it needs no runtime, because
// everything it shows travels in the tool result.
import { describe, it, expect } from "vitest";
import { plugin as brepPlugin } from "@gui-chat-plugin/brep/vue";
import { getPlugin } from "../../src/plugins-registry";
import { CANVAS_CARD_HEIGHT_VAR } from "../../src/composables/useCanvasCardHeight";

describe("presentBrep registration", () => {
  const registration = getPlugin("presentBrep");

  it("is registered with a stylesheet slot", () => {
    // Vitest stubs `?inline` CSS to "", so the content is checked by `yarn build`, not here.
    expect(registration).toBeDefined();
    expect(typeof registration?.css).toBe("string");
  });

  it("is the package's own View, with no runtime provider around it", () => {
    expect(registration?.viewComponent).toBe(brepPlugin.viewComponent);
  });

  it("gets the measured card height, since the View fills its frame", () => {
    expect(registration?.height).toContain(CANVAS_CARD_HEIGHT_VAR);
  });
});
