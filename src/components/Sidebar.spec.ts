import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Sidebar from "./Sidebar.vue";
import type { Session, Filter } from "../composables/useSessions";

// Sidebar is now presentational: App.vue owns the list + filter and passes them
// in. These tests drive it purely through props/emits.

function row(over: Partial<Session> & { id: string }): Session {
  return { title: over.id, mtime: 1, working: false, waiting: false, ...over };
}

function mountSidebar(over: { sessions: Session[]; activeId?: string | null; filter?: Filter }) {
  return mount(Sidebar, {
    props: {
      sessions: over.sessions,
      loading: false,
      error: null,
      activeId: over.activeId ?? null,
      filter: over.filter ?? "all",
    },
  });
}

describe("Sidebar", () => {
  it("renders sessions and shows the working spinner", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", title: "Alpha", working: true }), row({ id: "b", title: "Beta" })],
    });
    const items = wrapper.findAll(".item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Alpha");
    // Only the working session shows the spinner.
    expect(items[0].find(".spinner").exists()).toBe(true);
    expect(items[1].find(".spinner").exists()).toBe(false);
  });

  it("bolds a waiting session via the .waiting class", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", waiting: true }), row({ id: "b", waiting: false })],
    });
    const items = wrapper.findAll(".item");
    expect(items[0].classes()).toContain("waiting");
    expect(items[1].classes()).not.toContain("waiting");
  });

  it("hides the spinner while a session is waiting for input", () => {
    // A waiting session keeps `working` true server-side, but it is blocked on
    // the user — spinning there reads as "thinking", so suppress it.
    const wrapper = mountSidebar({ sessions: [row({ id: "a", working: true, waiting: true })] });
    const item = wrapper.find(".item");
    expect(item.find(".spinner").exists()).toBe(false);
    expect(item.classes()).toContain("waiting");
  });

  it("hides the spinner on the active session even while it is working", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", working: true }), row({ id: "b", working: true })],
      activeId: "a",
    });
    const items = wrapper.findAll(".item");
    expect(items[0].find(".spinner").exists()).toBe(false); // active
    expect(items[1].find(".spinner").exists()).toBe(true); // background
  });

  it("shows only unread rows when the filter prop is 'unread'", () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", waiting: true }), row({ id: "b", waiting: false })],
      filter: "unread",
    });
    const items = wrapper.findAll(".item");
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain("a");
  });

  it("emits update:filter when an unread chip is clicked, with its count", async () => {
    const wrapper = mountSidebar({
      sessions: [row({ id: "a", waiting: true }), row({ id: "b" })],
    });
    const unreadChip = wrapper.findAll(".chip")[1];
    expect(unreadChip.text()).toContain("(1)");
    await unreadChip.trigger("click");
    expect(wrapper.emitted("update:filter")?.[0]).toEqual(["unread"]);
  });

  it("emits refresh when the sort button is clicked", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a" })] });
    await wrapper.find(".sort-btn").trigger("click");
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("emits select with the session id + agent on click", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "a", title: "Alpha" })] });
    await wrapper.find(".item").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["a", "claude"]);
  });

  it("emits the codex agent + shows a badge for a codex row", async () => {
    const wrapper = mountSidebar({ sessions: [row({ id: "c", title: "Cx", agent: "codex" })] });
    expect(wrapper.find(".agent-badge").exists()).toBe(true);
    await wrapper.find(".item").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["c", "codex"]);
  });
});
