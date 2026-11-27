// @vitest-environment jsdom
// The tool-groups announcement as a cell's panes hear it: this machine's with no host, a remote
// host's (#3506) with its host, and both let go of when the pane goes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { onToolGroupsAnnounced, type HostedToolGroupsAnnouncement } from "../../../src/composables/useToolGroupsAnnounce";

const live = vi.hoisted(() => new Map<string, (data: unknown) => void>());
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      live.set(channel, cb);
      return () => live.delete(channel);
    },
  }),
}));

beforeEach(() => live.clear());

const listen = () => {
  const heard: HostedToolGroupsAnnouncement[] = [];
  const w = mount(
    defineComponent({
      setup() {
        onToolGroupsAnnounced((announcement) => heard.push(announcement));
        return () => h("div");
      },
    }),
  );
  return { w, heard };
};

describe("onToolGroupsAnnounced", () => {
  it("hands on this machine's announcements with no host, and a remote host's with it", () => {
    const { heard } = listen();
    live.get("tool-groups")?.({ sessionId: "s1", groups: ["render"] });
    live.get("remote-tool-groups")?.({ host: "lx", announcement: { sessionId: "s2" } });
    live.get("tool-groups")?.({ sessionId: "" });
    live.get("remote-tool-groups")?.({ host: "lx", announcement: { sessionId: "" } });
    expect(heard).toEqual([
      { sessionId: "s1", groups: ["render"], host: null },
      { sessionId: "s2", host: "lx" },
    ]);
  });

  it("lets go of both channels when the component goes", () => {
    const { w } = listen();
    expect([...live.keys()].sort()).toEqual(["remote-tool-groups", "tool-groups"]);
    w.unmount();
    expect([...live.keys()]).toEqual([]);
  });
});
