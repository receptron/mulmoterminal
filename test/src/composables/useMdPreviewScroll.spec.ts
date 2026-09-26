import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineComponent, h, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { useMdPreviewScroll } from "../../../src/composables/useMdPreviewScroll";
import { MD_PREVIEW_FROM_FRAME, MD_PREVIEW_FROM_HOST } from "../../../common/mdPreviewMessage";

// #2157. The preview document is opaque-origin, so the pane cannot read its scroll and cannot
// name it by origin either. Everything here is about the one thing left to check — WHICH WINDOW
// spoke — and about the answer the host owes a document that has just loaded.

/** A stand-in for the frame's `contentWindow`: identity is what the host checks, and `postMessage`
 *  is the only thing it ever calls on it. */
const fakeWindow = () => {
  const sent: unknown[] = [];
  const target = { postMessage: (data: unknown) => sent.push(data) };
  return { target, sent };
};

const host = (frame: () => HTMLIFrameElement | null, scrollTop: Ref<number>) =>
  mount(
    defineComponent({
      setup() {
        useMdPreviewScroll(frame, scrollTop);
        return () => h("div");
      },
    }),
  );

/** Post as a window would: the host reads `source` off the event, which `window.dispatchEvent`
 *  will not set, so the event is built with it. */
const arrive = (source: unknown, data: unknown) => {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
};

const scrolled = (scrollY: number) => ({ source: MD_PREVIEW_FROM_FRAME, kind: "scroll", scrollY });
const ready = { source: MD_PREVIEW_FROM_FRAME, kind: "ready" };

describe("useMdPreviewScroll", () => {
  let frame: { target: { postMessage: (data: unknown) => void }; sent: unknown[] };
  let scrollTop: Ref<number>;
  const iframe = () => ({ contentWindow: frame.target }) as unknown as HTMLIFrameElement;

  beforeEach(() => {
    frame = fakeWindow();
    scrollTop = ref(0);
  });

  it("follows the position its own frame reports", () => {
    host(iframe, scrollTop);
    arrive(frame.target, scrolled(317));
    expect(scrollTop.value).toBe(317);
  });

  // The document knows nothing when it loads — including after a reload the pane did not ask
  // for, which is what happens every time the file changes on disk. The host holds the place.
  it("answers a fresh document with the place it is holding", () => {
    scrollTop.value = 240;
    host(iframe, scrollTop);
    arrive(frame.target, ready);
    expect(frame.sent).toEqual([{ source: MD_PREVIEW_FROM_HOST, scrollY: 240 }]);
  });

  it("answers the top for a file nothing is remembered about", () => {
    host(iframe, scrollTop);
    arrive(frame.target, ready);
    expect(frame.sent).toEqual([{ source: MD_PREVIEW_FROM_HOST, scrollY: 0 }]);
  });

  // Two panes can be mounted at once — the Files view and the pane beside a zoomed cell — and
  // they hear each other's frames on the same window. The position of one must not become the
  // position of the other.
  it("ignores a message from a window that is not its frame", () => {
    const other = fakeWindow();
    host(iframe, scrollTop);
    arrive(other.target, scrolled(999));
    arrive(window, scrolled(888));
    expect(scrollTop.value).toBe(0);
    expect(other.sent).toEqual([]);
  });

  // The frame element outlives each document in it: a reload swaps `contentWindow`, and a
  // message posted by the document being replaced must not overwrite the place the new one is
  // about to be given.
  it("ignores the window its frame used to have", () => {
    const old = fakeWindow();
    let current = old;
    host(() => ({ contentWindow: current.target }) as unknown as HTMLIFrameElement, scrollTop);
    arrive(old.target, scrolled(100));
    current = fakeWindow();
    arrive(old.target, scrolled(900));
    expect(scrollTop.value).toBe(100);
  });

  it("ignores traffic that is not this document speaking", () => {
    host(iframe, scrollTop);
    arrive(frame.target, { source: "vite:hmr", kind: "scroll", scrollY: 500 });
    arrive(frame.target, { source: MD_PREVIEW_FROM_FRAME, kind: "scroll", scrollY: "500" });
    expect(scrollTop.value).toBe(0);
  });

  // A pane that has been torn down still has its listener on a window that outlives it.
  it("stops listening when the pane goes away", () => {
    const wrapper = host(iframe, scrollTop);
    wrapper.unmount();
    arrive(frame.target, scrolled(555));
    expect(scrollTop.value).toBe(0);
  });

  // The pane can be mounted before the frame is in the document at all (the preview is only
  // rendered once a file is open), and a message arriving then must not throw.
  it("survives a message with no frame to compare against", () => {
    host(() => null, scrollTop);
    expect(() => arrive(frame.target, scrolled(42))).not.toThrow();
    expect(scrollTop.value).toBe(0);
  });

  // #2259. The frame has no `allow-popups`, so it asks; the host opens it, isolated from the app.
  it("opens an external link its own frame asks for", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    host(iframe, scrollTop);
    arrive(frame.target, { source: MD_PREVIEW_FROM_FRAME, kind: "navigate", href: "https://www.youtube.com/" });
    expect(open).toHaveBeenCalledWith("https://www.youtube.com/", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("opens nothing another window asks for", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    host(iframe, scrollTop);
    arrive(fakeWindow().target, { source: MD_PREVIEW_FROM_FRAME, kind: "navigate", href: "https://example.com/" });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
