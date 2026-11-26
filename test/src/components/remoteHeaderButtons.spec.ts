import { describe, it, expect } from "vitest";
import { remoteHeaderEntries } from "../../../src/components/remoteHeaderButtons";
import type { HeaderButton, HeaderEntry } from "../../../src/composables/useHeaderButtons";

const button = (id: string, rest: Partial<HeaderButton>): HeaderButton => ({ id, label: id, run: "shell", ...rest });
const SHELL = button("test", { run: "shell" });
const INPUT = button("ask", { run: "input", text: "/review" });
const ACTION = button("zoom", { run: "action", action: "zoom-toggle" });
const URL_OPEN = button("pr", { run: "open", open: { url: "https://github.com/o/r/pull/1" } });
const HERE = [
  button("reveal", { run: "open", open: { reveal: "/srv/p" } }),
  button("files", { run: "open", open: { files: "/srv/p" } }),
  button("view", { run: "open", open: { view: "diff" } }),
  button("term", { run: "open", open: { terminal: "/srv/p" } }),
  button("pick", { run: "open", open: { pickFile: true } }),
  button("bare", { run: "open" }),
];

describe("remoteHeaderEntries", () => {
  it("keeps what runs on the remote or in the browser", () => {
    expect(remoteHeaderEntries([SHELL, INPUT, ACTION, URL_OPEN])).toEqual([SHELL, INPUT, ACTION, URL_OPEN]);
  });
  it("drops every open that acts on this machine", () => {
    expect(remoteHeaderEntries(HERE)).toEqual([]);
  });
  it("keeps a URL button whatever else it names, since the URL is all it opens", () => {
    const both = button("both", { run: "open", open: { url: "https://example.com", reveal: "/srv/p" } });
    expect(remoteHeaderEntries([both])).toEqual([both]);
  });
  it("filters inside a folder and drops one left empty", () => {
    const entries: HeaderEntry[] = [
      { id: "f1", label: "mixed", items: [SHELL, ...HERE] },
      { id: "f2", label: "local only", items: HERE },
    ];
    expect(remoteHeaderEntries(entries)).toEqual([{ id: "f1", label: "mixed", items: [SHELL] }]);
  });
  it("answers nothing for nothing", () => {
    expect(remoteHeaderEntries([])).toEqual([]);
  });
});
