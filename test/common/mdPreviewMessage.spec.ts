import { describe, it, expect } from "vitest";
import { MD_PREVIEW_FROM_FRAME, MD_PREVIEW_FROM_HOST, mdPreviewFrameMessage } from "../../common/mdPreviewMessage";

// #2157. What the preview document posts arrives on the same `message` listener as everything
// else the app hears, from a document whose origin is the string "null" and identifies nobody.
// The host checks WHICH WINDOW sent it; this is the check on what was sent.

const frame = (over: Record<string, unknown>) => ({ source: MD_PREVIEW_FROM_FRAME, ...over });

describe("mdPreviewFrameMessage", () => {
  it("reads a document announcing that it can be scrolled", () => {
    expect(mdPreviewFrameMessage(frame({ kind: "ready" }))).toEqual({ kind: "ready" });
  });

  it("reads a reported position", () => {
    expect(mdPreviewFrameMessage(frame({ kind: "scroll", scrollY: 420 }))).toEqual({ kind: "scroll", scrollY: 420 });
  });

  it("keeps the top of a document as a position like any other", () => {
    expect(mdPreviewFrameMessage(frame({ kind: "scroll", scrollY: 0 }))).toEqual({ kind: "scroll", scrollY: 0 });
  });

  // The window carries other traffic — Vite's HMR, plugin frames, anything an extension posts.
  it.each([[{ kind: "scroll", scrollY: 1 }], [{ source: MD_PREVIEW_FROM_HOST, scrollY: 1 }], [{ source: "other", kind: "ready" }]])(
    "ignores %j, which is not this document speaking",
    (data) => {
      expect(mdPreviewFrameMessage(data)).toBeNull();
    },
  );

  it.each([[null], [undefined], ["ready"], [7], [[MD_PREVIEW_FROM_FRAME]]])("ignores %j, which is not a message at all", (data) => {
    expect(mdPreviewFrameMessage(data)).toBeNull();
  });

  it("ignores a kind it has no meaning for", () => {
    expect(mdPreviewFrameMessage(frame({ kind: "scrollTo", scrollY: 10 }))).toBeNull();
  });

  // A position that is not a number would be stored and handed back to `scrollTo`, which reads
  // anything it cannot use as 0 — so the reader silently loses their place rather than the
  // message being refused.
  it.each([[undefined], ["100"], [null], [Number.NaN], [Number.POSITIVE_INFINITY], [{}]])("refuses %j as a position", (scrollY) => {
    expect(mdPreviewFrameMessage(frame({ kind: "scroll", scrollY }))).toBeNull();
  });

  // Nothing is above the top of a document; a negative offset can only come from something that
  // is not the reporter, and it would read as "the position was forgotten".
  it("refuses a position above the top of the document", () => {
    expect(mdPreviewFrameMessage(frame({ kind: "scroll", scrollY: -1 }))).toBeNull();
  });

  // #2259. The host opens what this lets through with `window.open`, and the document is a file
  // nobody sanitised — so only an absolute http(s) URL is a link to follow.
  it.each([["https://www.youtube.com/watch?v=x"], ["http://example.com/a b"]])("accepts %s to open", (href) => {
    expect(mdPreviewFrameMessage(frame({ kind: "navigate", href }))).toEqual({ kind: "navigate", href: new URL(href).href });
  });

  it.each([["javascript:alert(1)"], ["file:///etc/passwd"], ["data:text/html,x"], ["docs/a.md"], ["#top"], [""], [7], [undefined]])(
    "refuses %j as a link to open",
    (href) => {
      expect(mdPreviewFrameMessage(frame({ kind: "navigate", href }))).toBeNull();
    },
  );
});
