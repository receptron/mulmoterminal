// @vitest-environment node
//
// remoteView.ts had no spec at all, while its own header comment claimed "factories keep the
// mapping unit-testable". Nothing was in the way — every factory already takes its I/O as a
// dependency; the tests were simply never written.
//
// The failure messages matter more than they look: they are the ENTIRE error UI on the
// phone. There is no stack trace and no log the user can reach, so a wrong string is the
// whole diagnosis. And each factory ends in a bare `return` rather than an exhaustive
// switch — add a result kind and TypeScript stays silent while every new failure claims the
// last branch's message. That fall-through is what these tests pin.
import { describe, it, expect, vi } from "vitest";

import {
  createBuildRemoteView,
  mutateRemoteViewFailureMessage,
  remoteViewFailureMessage,
  remoteViewItemsFailureMessage,
} from "../../../server/backends/remoteView.js";

const SLUG = "tasks";

const view = (over: Record<string, unknown> = {}) => ({ id: "board", label: "Board", target: "mobile", file: "board.html", ...over });

// Enough of a LoadedCollection for the view lookup; the factory's I/O is injected.
const collection = (views: unknown[]) => ({ slug: SLUG, schema: { views } }) as never;

const buildWith = (html: string | null, i18n = { locale: "ja", dict: { a: "b" } }) =>
  createBuildRemoteView({
    readCustomViewHtml: vi.fn().mockResolvedValue(html) as never,
    readCustomViewI18n: vi.fn().mockResolvedValue(i18n) as never,
  });

describe("remoteViewFailureMessage", () => {
  it("names both the view and the collection when the view is missing", () => {
    const message = remoteViewFailureMessage({ kind: "view-not-found", viewId: "board" }, SLUG);
    expect(message).toContain("board");
    expect(message).toContain(SLUG);
  });

  // The remedy has to be in the sentence — the user cannot see anything else.
  it('tells the author to declare target: "mobile"', () => {
    expect(remoteViewFailureMessage({ kind: "not-mobile", viewId: "board" }, SLUG)).toContain('target: "mobile"');
  });

  it("gives the authoring path for a missing file", () => {
    expect(remoteViewFailureMessage({ kind: "file-missing", file: "board.html" }, SLUG)).toContain(`data/skills/${SLUG}/board.html`);
  });

  it("states the actual size when the view is too large", () => {
    expect(remoteViewFailureMessage({ kind: "too-large", bytes: 987654 }, SLUG)).toContain("987654");
  });

  // The fall-through: a kind added to the union later must not silently inherit the
  // too-large sentence, which would send the author to slim HTML that was never the problem.
  it("does not answer an unknown kind with the too-large sentence", () => {
    const unknown = { kind: "quota-exceeded" } as never;
    expect(remoteViewFailureMessage(unknown, SLUG)).not.toContain("slim the HTML");
  });

  it("gives each kind its own message", () => {
    const messages = [
      remoteViewFailureMessage({ kind: "view-not-found", viewId: "b" }, SLUG),
      remoteViewFailureMessage({ kind: "not-mobile", viewId: "b" }, SLUG),
      remoteViewFailureMessage({ kind: "file-missing", file: "b.html" }, SLUG),
      remoteViewFailureMessage({ kind: "too-large", bytes: 1 }, SLUG),
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("remoteViewItemsFailureMessage", () => {
  it("keeps not-mobile and too-large distinct", () => {
    const notMobile = remoteViewItemsFailureMessage({ kind: "not-mobile", viewId: "board" }, SLUG);
    const tooLarge = remoteViewItemsFailureMessage({ kind: "too-large", bytes: 5 }, SLUG);
    expect(notMobile).not.toBe(tooLarge);
  });

  // This one's too-large text is the user's only guidance for a page that won't load.
  it("offers every remedy it promises for an oversized page", () => {
    const message = remoteViewItemsFailureMessage({ kind: "too-large", bytes: 999999 }, SLUG);
    for (const remedy of ["fields", "limit"]) expect(message).toContain(remedy);
  });

  it("does not answer an unknown kind with the view-not-found sentence", () => {
    expect(remoteViewItemsFailureMessage({ kind: "brand-new" } as never, SLUG)).not.toContain("not found");
  });
});

describe("mutateRemoteViewFailureMessage", () => {
  const KINDS = [
    "too-large",
    "view-not-found",
    "not-mobile",
    "read-only-collection",
    "not-writable",
    "delete-not-allowed",
    "field-not-editable",
    "invalid-patch",
    "invalid-id",
    "item-not-found",
    "path-escape",
  ] as const;

  // A copy-pasted branch is invisible in review and produces an instruction for the wrong
  // problem; distinctness is the cheapest way to catch it.
  it("gives all eleven failure kinds their own message", () => {
    const messages = KINDS.map((kind) => mutateRemoteViewFailureMessage({ kind, viewId: "board", field: "title", bytes: 1 } as never, SLUG));
    expect(new Set(messages).size).toBe(KINDS.length);
  });

  // These two are opposite instructions: one says the collection cannot be written at all,
  // the other says to declare a field. Telling a dataSource-backed collection to declare
  // editableFields sends the user after a permission that cannot help.
  it("does not tell a read-only collection to declare editableFields", () => {
    expect(mutateRemoteViewFailureMessage({ kind: "read-only-collection" } as never, SLUG)).not.toContain("editableFields");
  });

  it("does not answer an unknown kind with the path-escape sentence", () => {
    expect(mutateRemoteViewFailureMessage({ kind: "something-new" } as never, SLUG)).not.toContain("escapes the workspace");
  });
});

describe("createBuildRemoteView", () => {
  it("builds a mobile view into a srcdoc with its byte count", async () => {
    const result = await buildWith("<p>hi</p>")(collection([view()]), "board", "ja");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.view).toMatchObject({ id: "board", label: "Board", target: "mobile" });
    expect(result.bytes).toBe(Buffer.byteLength(result.srcdoc, "utf8"));
  });

  it("reports an unknown view id rather than serving nothing", async () => {
    expect(await buildWith("<p>hi</p>")(collection([view()]), "missing", "ja")).toEqual({ kind: "view-not-found", viewId: "missing" });
  });

  // A desktop view's HTML assumes a contract the phone cannot provide, so it is refused
  // rather than rendered broken.
  it("refuses a desktop view", async () => {
    expect(await buildWith("<p>hi</p>")(collection([view({ target: "desktop" })]), "board", "ja")).toEqual({ kind: "not-mobile", viewId: "board" });
  });

  // Ordering: the view has to exist before its target can be judged.
  it("reports a missing id, not not-mobile, on a collection with no views", async () => {
    expect(await buildWith("<p>hi</p>")(collection([]), "board", "ja")).toEqual({ kind: "view-not-found", viewId: "board" });
  });

  it("names the file when its HTML cannot be read", async () => {
    expect(await buildWith(null)(collection([view()]), "board", "ja")).toEqual({ kind: "file-missing", file: "board.html" });
  });

  it("refuses a srcdoc over the command-channel budget", async () => {
    const result = await buildWith("x".repeat(1_100_000))(collection([view()]), "board", "ja");
    expect(result.kind).toBe("too-large");
  });

  // The icon rides only when declared — an `icon: undefined` key would serialize into the
  // command document as a wasted field.
  it("omits the icon when the view declares none", async () => {
    const result = await buildWith("<p>hi</p>")(collection([view()]), "board", "ja");
    expect(result.kind === "ok" && "icon" in result.view).toBe(false);
  });

  it("carries a declared icon through", async () => {
    const result = await buildWith("<p>hi</p>")(collection([view({ icon: "grid" })]), "board", "ja");
    expect(result.kind === "ok" && result.view.icon).toBe("grid");
  });

  // A view without i18n still has to boot; the client reads locale/dict unconditionally.
  it("boots a view that declares no i18n", async () => {
    const readI18n = vi.fn();
    const build = createBuildRemoteView({ readCustomViewHtml: vi.fn().mockResolvedValue("<p>hi</p>") as never, readCustomViewI18n: readI18n as never });
    const result = await build(collection([view()]), "board", "ja");
    expect(result.kind).toBe("ok");
    expect(readI18n).not.toHaveBeenCalled();
  });
});
