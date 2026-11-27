import { describe, it, expect } from "vitest";
import { defineComponent, h, onMounted } from "vue";
import { mount } from "@vue/test-utils";
import { useOverlayVisible } from "../../../src/composables/overlayVisibility";
import FullScreenOverlay from "../../../src/components/FullScreenOverlay.vue";
import { en } from "../../../src/i18n/en";

const REGION_LABEL = "Some region";
const CLOSE_LABEL = "Close some region";

const mountFrame = () =>
  mount(FullScreenOverlay, {
    props: { open: true, regionLabel: REGION_LABEL, closeLabel: CLOSE_LABEL },
    slots: { header: '<span data-testid="title">Title</span>', default: '<p data-testid="body">Body</p>' },
  });

describe("FullScreenOverlay", () => {
  it("names the region and the close button by the labels it is given", () => {
    const w = mountFrame();
    expect(w.attributes("role")).toBe("region");
    expect(w.attributes("aria-label")).toBe(REGION_LABEL);
    const button = w.get("header button");
    expect(button.attributes("aria-label")).toBe(CLOSE_LABEL);
    expect(button.attributes("data-tip")).toBe(en.tips.overlays.close);
  });

  // The header slot sits left of the spacer, so the close button is always the last thing in it,
  // and the body comes after the header rather than inside it.
  it("puts the header slot before the close button and the body after the header", () => {
    const w = mountFrame();
    const headerChildren = w.get("header").element.children;
    expect(headerChildren[0]?.getAttribute("data-testid")).toBe("title");
    expect(headerChildren[headerChildren.length - 1]?.tagName).toBe("BUTTON");
    expect(w.element.children[1]?.getAttribute("data-testid")).toBe("body");
  });

  it("emits close once per click, with nothing attached", async () => {
    const w = mountFrame();
    await w.get("header button").trigger("click");
    await w.get("header button").trigger("click");
    expect(w.emitted("close")).toEqual([[], []]);
  });

  // Created on the first open and only hidden after: what the body holds survives a close.
  it("creates the body on the first open and keeps it, hidden, after a close", async () => {
    let mounts = 0;
    const seen: boolean[] = [];
    const Body = defineComponent({
      setup() {
        const visible = useOverlayVisible();
        onMounted(() => mounts++);
        return () => {
          seen.push(visible.value);
          return h("p", { "data-testid": "body" }, "Body");
        };
      },
    });
    const w = mount(FullScreenOverlay, { props: { open: false, regionLabel: REGION_LABEL, closeLabel: CLOSE_LABEL }, slots: { default: () => h(Body) } });
    expect(w.find("[data-testid=body]").exists()).toBe(false);
    await w.setProps({ open: true });
    expect(w.get("[role=region]").attributes("style") ?? "").not.toContain("display: none");
    await w.setProps({ open: false });
    expect(w.find("[data-testid=body]").exists()).toBe(true);
    expect(w.get("[role=region]").attributes("style")).toContain("display: none");
    await w.setProps({ open: true });
    expect(mounts).toBe(1);
    expect(seen.at(-1)).toBe(true);
    expect(seen).toContain(false);
  });
});
