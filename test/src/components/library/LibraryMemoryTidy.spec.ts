// "Ask for a tidy-up" on a project in Memory (#3334): asks for that project's folder, once at a time,
// and says why when it was refused.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const asked: string[] = [];
let answer: string | null = null;
let hold: Promise<void> | null = null;
vi.mock("../../../../src/components/library/libraryPromoteStart", () => ({
  startMemoryTidy: async (slug: string) => {
    asked.push(slug);
    if (hold !== null) await hold;
    return answer;
  },
}));

const LibraryMemoryTidy = (await import("../../../../src/components/library/LibraryMemoryTidy.vue")).default;

beforeEach(() => {
  asked.length = 0;
  answer = null;
  hold = null;
});

describe("LibraryMemoryTidy", () => {
  it("asks for the project's folder, and clears any refusal when it started", async () => {
    const wrapper = mount(LibraryMemoryTidy, { props: { slug: "-w-app" } });
    await wrapper.get('[data-testid="memory-tidy-ask--w-app"]').trigger("click");
    await flushPromises();
    expect(asked).toEqual(["-w-app"]);
    expect(wrapper.emitted("refused")).toEqual([[null], [null]]);
  });

  it("hands up why it was refused, for the heading's owner to say", async () => {
    answer = "libraryView.memory.tidyAsk.noDir";
    const wrapper = mount(LibraryMemoryTidy, { props: { slug: "-w-app" } });
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("refused")?.at(-1)?.[0]).toMatch(/\S/);
  });

  it("asks once while one is starting", async () => {
    let release: () => void = () => {};
    hold = new Promise((resolve) => (release = resolve));
    const wrapper = mount(LibraryMemoryTidy, { props: { slug: "-w-app" } });
    await wrapper.get("button").trigger("click");
    await wrapper.get("button").trigger("click");
    release();
    await flushPromises();
    expect(asked).toEqual(["-w-app"]);
  });
});
