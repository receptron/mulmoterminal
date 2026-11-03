// The toolbar's script RUN, in jsdom, against the document renderedTabDoc builds (#3258): the switch
// hides by an inline display with priority as well as by `hidden`, since a stylesheet in the file can
// undo `[hidden]`; an element's own inline display comes back when shown; and the HTML copy is taken
// while the rendering is shown, so a paste target that honours `hidden` keeps the content. The
// server-side spec reads the script's text; this one reads what it does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderedTabDoc, tabToolLabelsFor } from "../../server/files/renderedTabTools";

class FakeClipboardItem {
  readonly parts: Record<string, Blob>;
  constructor(parts: Record<string, Blob>) {
    this.parts = parts;
  }
}
const written: FakeClipboardItem[][] = [];
const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const SCRIPT_TAG = /<script nonce="n0nce">([\s\S]*?)<\/script>/;

// innerHTML never runs a script, so the shell is parsed without it and the script is put back in its
// place as an element, which jsdom runs — with `currentScript` set, as a browser would.
const mountTab = (rendered: string): void => {
  const html = renderedTabDoc({ html: rendered, source: "# hi\n", title: "a.md", style: "", nonce: "n0nce", labels: tabToolLabelsFor("en", "markdown") });
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  const scriptText = SCRIPT_TAG.exec(body)?.[1] ?? "";
  document.body.innerHTML = body.replace(SCRIPT_TAG, "");
  const script = document.createElement("script");
  script.textContent = scriptText;
  document.body.insertBefore(script, document.body.children[2] ?? null);
};

const element = (selector: string): HTMLElement => {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`expected ${selector}`);
  return el;
};
const renderedNodes = (): HTMLElement[] => {
  const out: HTMLElement[] = [];
  for (let el: Element | null = element("#tab-rendered"); el instanceof HTMLElement; el = el.nextElementSibling) out.push(el);
  return out;
};
const inlineDisplay = (el: HTMLElement): string => [el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")].filter(Boolean).join(" ");
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const writeText = vi.fn(async () => {});

// A script jsdom runs resolves its globals against jsdom's own window, which is not the test's
// global (vitest's `window` and `document.defaultView` both are), so nothing defined here is seen
// there. `document` IS shared, so a value is handed across on it and a script of our own puts it on
// that window.
const inTabWindow = (code: string): void => {
  const script = document.createElement("script");
  script.textContent = code;
  document.head.append(script);
  script.remove();
};

beforeEach(() => {
  Object.defineProperty(document, "fakeClipboardItem", { value: FakeClipboardItem, configurable: true });
  inTabWindow("window.ClipboardItem = document.fakeClipboardItem;");
  Object.defineProperty(navigator, "clipboard", {
    value: { write: vi.fn(async (items: FakeClipboardItem[]) => void written.push(items)), writeText },
    configurable: true,
  });
  // jsdom has no layout and so no innerText; the plain-text half of the copy reads it.
  if (!("innerText" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      get(this: HTMLElement) {
        return this.textContent ?? "";
      },
      configurable: true,
    });
  }
});
afterEach(() => {
  inTabWindow("delete window.ClipboardItem;");
  Reflect.deleteProperty(document, "fakeClipboardItem");
  written.length = 0;
  writeText.mockClear();
  document.body.innerHTML = "";
});

describe("the rendered tab's script", () => {
  it("starts with the rendering shown and the source hidden by the attribute and an inline display with priority", () => {
    mountTab("<h1>hi</h1>");
    expect(element("#tab-source").hidden).toBe(true);
    expect(inlineDisplay(element("#tab-source"))).toBe("none important");
    expect(renderedNodes().map((el) => [el.hidden, inlineDisplay(el)])).toEqual([[false, ""]]);
  });

  // Raw HTML in the file closes the wrapper early and puts an element with a display of its own
  // beside it; the switch hides both, with priority, and gives the element its display back.
  it("switches to the source and back, hiding with priority and restoring an element's own display", () => {
    mountTab('<h1>hi</h1></div><div id="beside" style="display:flex">x</div>');
    element('[data-show="source"]').click();
    expect(element("#tab-source").hidden).toBe(false);
    expect(inlineDisplay(element("#tab-source"))).toBe("");
    expect(renderedNodes().map((el) => [el.hidden, inlineDisplay(el)])).toEqual([
      [true, "none important"],
      [true, "none important"],
    ]);
    expect(element('[data-show="source"]').getAttribute("aria-pressed")).toBe("true");
    element('[data-show="rendered"]').click();
    expect(renderedNodes().map((el) => [el.hidden, inlineDisplay(el)])).toEqual([
      [false, ""],
      [false, "flex"],
    ]);
    expect(inlineDisplay(element("#tab-source"))).toBe("none important");
  });

  // Hiding composes from the RECORDED original style, never from the current attribute, so pressing
  // the already-selected view again rewrites the same value (Codex on #3259 read it as appending).
  it("hides idempotently: pressing the selected view again leaves every style attribute as it was", () => {
    mountTab('<h1>hi</h1></div><div id="beside" style="display:flex">x</div>');
    const attributes = (): (string | null)[] => [element("#tab-source"), ...renderedNodes()].map((el) => el.getAttribute("style"));
    element('[data-show="source"]').click();
    const once = attributes();
    expect(once).toEqual([null, "display:none !important", "display:flex;display:none !important"]);
    element('[data-show="source"]').click();
    element('[data-show="source"]').click();
    expect(attributes()).toEqual(once);
    element('[data-show="rendered"]').click();
    element('[data-show="rendered"]').click();
    expect(attributes()).toEqual(["display:none !important", null, "display:flex"]);
  });

  // An element the FILE hid is the file's business: a copy from the Preview view must not touch it,
  // and a trip through the Source view must put its own `hidden` and style back byte for byte
  // (Codex on #3259).
  it("leaves an element the file itself hid exactly as it was, through a copy and a switch", async () => {
    mountTab('<h1>hi</h1></div><div id="own" hidden style="display:flex">x</div>');
    const own = element("#own");
    const attributes = (): string[] => [...own.attributes].map((a) => `${a.name}="${a.value}"`);
    const before = attributes();
    element('[data-copy="rendered"]').click();
    await flush();
    expect(written).toHaveLength(1);
    expect(attributes()).toEqual(before);
    element('[data-show="source"]').click();
    expect(own.getAttribute("style")).toBe("display:flex;display:none !important");
    element('[data-copy="rendered"]').click();
    await flush();
    element('[data-show="rendered"]').click();
    expect(attributes()).toEqual(before);
  });

  // DOM clobbering: a <form> beside the wrapper answers `el.style`, `el.hidden`, `el.nextElementSibling`
  // and `el.innerText` with its inputs of those names. The switch must neither throw nor walk into
  // the form, and the copy must still read text.
  it("is not thrown off by a form whose inputs shadow the properties it uses", async () => {
    mountTab(
      '<h1>hi</h1></div><form id="trap"><input name="style"><input name="hidden"><input name="nextElementSibling"><input name="innerText"></form><p id="after">tail</p>',
    );
    const trap = element("#trap");
    const after = element("#after");
    element('[data-show="source"]').click();
    expect([trap, after].map((el) => [el.hasAttribute("hidden"), el.getAttribute("style")])).toEqual([
      [true, "display:none !important"],
      [true, "display:none !important"],
    ]);
    expect([...trap.querySelectorAll("input")].some((input) => input.hasAttribute("hidden"))).toBe(false);
    element('[data-copy="rendered"]').click();
    await flush();
    const [item] = written[0] ?? [];
    if (!item) throw new Error("expected a clipboard item");
    expect(await blobText(item.parts["text/plain"])).toContain("tail");
    expect(await blobText(item.parts["text/html"])).not.toContain("hidden=");
    element('[data-show="rendered"]').click();
    expect([trap, after].map((el) => [el.hasAttribute("hidden"), el.getAttribute("style")])).toEqual([
      [false, null],
      [false, null],
    ]);
  });

  it("copies the rendering as HTML without hidden from the Source view, and leaves it hidden after", async () => {
    mountTab("<h1>hi</h1><p>there</p>");
    element('[data-show="source"]').click();
    element('[data-copy="rendered"]').click();
    await flush();
    expect(writeText).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    const [item] = written[0] ?? [];
    if (!item) throw new Error("expected a clipboard item");
    const html = await blobText(item.parts["text/html"]);
    expect(html).toContain("<h1>hi</h1><p>there</p>");
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("display");
    expect(await blobText(item.parts["text/plain"])).toBe("hithere");
    expect(renderedNodes().map((el) => [el.hidden, inlineDisplay(el)])).toEqual([[true, "none important"]]);
    expect(element(".tab-tools-status").textContent).toBe("Copied");
  });
});
