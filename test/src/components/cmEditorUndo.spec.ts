import { describe, it, expect, vi } from "vitest";
import { EditorView } from "codemirror";
import { createEditor } from "../../../src/components/cmEditor";

// #2258. Loading a file is not an edit, so it must not be something Undo can take back: undoing
// it emptied the buffer (or brought back the previous file's text), marked it dirty, and the pane
// then saved that over the file on the way out without asking.
const EMPTY_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
Range.prototype.getClientRects = () => Object.assign([EMPTY_RECT], { item: () => EMPTY_RECT });
Range.prototype.getBoundingClientRect = () => EMPTY_RECT;

const editorWithSpy = () => {
  const host = document.createElement("div");
  document.body.append(host);
  const onChange = vi.fn();
  const editor = createEditor(host, onChange);
  const content = host.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error("editor rendered no content element");
  return { editor, onChange, content };
};

// Through the keymap rather than by calling `undo` — the key is what the user presses, and it is
// what reaches the history through `basicSetup`.
const pressUndo = (content: HTMLElement): void => {
  content.dispatchEvent(new KeyboardEvent("keydown", { key: "z", keyCode: 90, ctrlKey: true, bubbles: true, cancelable: true }));
};

// An edit as the user makes one: a transaction on the live view, which the history records.
const typeAtEnd = (content: HTMLElement, text: string): void => {
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error("no editor view behind the content element");
  const end = view.state.doc.length;
  view.dispatch({ changes: { from: end, insert: text }, selection: { anchor: end + text.length }, userEvent: "input.type" });
};

describe("undo right after a file is opened", () => {
  it("changes nothing and does not report an edit", () => {
    const { editor, onChange, content } = editorWithSpy();
    editor.setDoc("AAA", "a.md");
    pressUndo(content);
    expect(editor.getDoc()).toBe("AAA");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not bring back the previously opened file", () => {
    const { editor, onChange, content } = editorWithSpy();
    editor.setDoc("AAA", "a.md");
    editor.setDoc("BBB", "b.md");
    pressUndo(content);
    expect(editor.getDoc()).toBe("BBB");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not undo an edit made to the previous file", () => {
    const { editor, onChange, content } = editorWithSpy();
    editor.setDoc("AAA", "a.md");
    typeAtEnd(content, "!");
    onChange.mockClear();
    editor.setDoc("BBB", "b.md");
    pressUndo(content);
    expect(editor.getDoc()).toBe("BBB");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still undoes an edit made to the file that is open", () => {
    const { editor, onChange, content } = editorWithSpy();
    editor.setDoc("AAA", "a.md");
    typeAtEnd(content, "!");
    expect(editor.getDoc()).toBe("AAA!");
    pressUndo(content);
    expect(editor.getDoc()).toBe("AAA");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
