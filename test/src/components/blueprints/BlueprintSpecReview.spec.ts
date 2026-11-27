// The panel at a review gate: an app build has a specification to read and talk over; a document build has files to
// read instead, and keeps only the conversation, where what the person sends changes those files.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";
import { defineComponent, h, ref } from "vue";
import { provideOverlayVisible } from "../../../../src/composables/overlayVisibility";

const { loadSpec, sendSpecMessage } = vi.hoisted(() => ({ loadSpec: vi.fn(), sendSpecMessage: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", () => ({ loadSpec, sendSpecMessage }));

import BlueprintSpecReview from "../../../../src/components/blueprints/BlueprintSpecReview.vue";

const specView = (spec: string | null, chat: { role: "person" | "agent"; text: string; atMs: number }[] = []) => ({
  ok: true,
  value: { spec, openQuestions: null, chat, revising: false },
});
// A document build's gate names files to read and does not expect a spec; an app build's gate does.
const panel = (revisionSessionId: string | null = null, expectsSpec = false, chatCount = 0) =>
  mount(BlueprintSpecReview, { props: { runId: "run-00000001", revisionSessionId, chatCount, projectDir: "/work/app", expectsSpec } });

describe("the specification panel", () => {
  beforeEach(() => {
    loadSpec.mockReset();
  });

  it("shows the specification and where it is, at an app build's gate", async () => {
    loadSpec.mockResolvedValue(specView("# spec"));
    const wrapper = panel(null, true);
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-spec-review"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("/work/app/.blueprint/spec.md");
  });

  it("stays while a conversation about the specification exists, or a revision is under way", async () => {
    loadSpec.mockResolvedValue(specView(null, [{ role: "person", text: "本の削除も", atMs: 1 }]));
    const talked = panel(null, false, 1);
    await flushPromises();
    expect(talked.find('[data-testid="blueprint-spec-review"]').exists()).toBe(true);
    loadSpec.mockResolvedValue(specView(null));
    const revising = panel("s9");
    await flushPromises();
    expect(revising.find('[data-testid="blueprint-spec-review"]').exists()).toBe(true);
  });

  it("stays at an app build's gate when its spec is missing, so the conversation that can rewrite it is there", async () => {
    loadSpec.mockResolvedValue(specView(null));
    const wrapper = panel(null, true);
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-spec-review"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="blueprint-spec-input"]').exists()).toBe(true);
  });

  it("stays while a revision is under way even when the spec could not be read, so its progress and error are there", async () => {
    loadSpec.mockResolvedValue({ ok: false, error: "the spec could not be read" });
    const wrapper = panel("s9");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-spec-review"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="blueprint-spec-revising"]').exists()).toBe(true);
  });

  it("stays when its own read shows a conversation the run record it was given does not have yet", async () => {
    loadSpec.mockResolvedValue(specView(null, [{ role: "person", text: "本の削除も", atMs: 1 }]));
    const wrapper = panel(null, false, 0);
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-spec-review"]').exists()).toBe(true);
  });

  it("stays when the run has a conversation about the spec even if the spec could not be read, showing why", async () => {
    loadSpec.mockResolvedValue({ ok: false, error: "the spec could not be read" });
    const wrapper = panel(null, false, 2);
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-spec-review"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("the spec could not be read");
  });

  it("keeps only the conversation at a document build's gate, in its own words, and sends what the person writes", async () => {
    loadSpec.mockResolvedValue(specView(null));
    sendSpecMessage.mockReset();
    sendSpecMessage.mockResolvedValue({ ok: true, value: {} });
    const wrapper = panel();
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-spec-body"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain(".blueprint/spec.md");
    expect(wrapper.text()).toContain("Send changes or answers");
    await wrapper.get('[data-testid="blueprint-spec-input"]').setValue("集合は 9 時です");
    await wrapper.get('[data-testid="blueprint-spec-send"]').trigger("submit");
    await flushPromises();
    expect(sendSpecMessage).toHaveBeenCalledWith("run-00000001", "集合は 9 時です");
  });

  it("shows a failed check after a revision, with what the check said", async () => {
    loadSpec.mockResolvedValue(
      specView(null, [
        { role: "person", text: "第2章を短くして", atMs: 1 },
        { role: "agent", text: "outline.json: part 2 has no file", atMs: 2, outcome: "check-failed" },
      ] as never),
    );
    const wrapper = panel(null, false, 2);
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-revision-check-failed"]').text()).toContain("The check after the change did not pass");
    expect(wrapper.text()).toContain("outline.json: part 2 has no file");
  });
});

// The Blueprints screen is kept while closed; the spec may have been edited in the meantime.
describe("the spec shown again", () => {
  it("reads the spec again each time the screen is shown", async () => {
    loadSpec.mockReset();
    loadSpec.mockResolvedValue(specView("# spec"));
    const visible = ref(true);
    const props = { runId: "run-00000001", revisionSessionId: null, chatCount: 0, projectDir: "/work/app", expectsSpec: true };
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(BlueprintSpecReview, props)) });
    const wrapper = mount(Host);
    await flushPromises();
    visible.value = false;
    await flushPromises();
    visible.value = true;
    await flushPromises();
    expect(loadSpec).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});

describe("a reply landing while the screen is hidden", () => {
  it("reads the spec on showing, not while hidden", async () => {
    loadSpec.mockReset();
    loadSpec.mockResolvedValue(specView("# spec"));
    const chat = ref(0);
    const { wrapper, visible } = mountUnderOverlay(BlueprintSpecReview, () => ({
      runId: "run-00000001",
      revisionSessionId: null,
      chatCount: chat.value,
      projectDir: "/work/app",
      expectsSpec: true,
    }));
    await flushPromises();
    visible.value = false;
    await flushPromises();
    loadSpec.mockClear();
    chat.value = 1;
    await flushPromises();
    expect(loadSpec).not.toHaveBeenCalled();
    visible.value = true;
    await flushPromises();
    expect(loadSpec).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
