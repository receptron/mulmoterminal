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
