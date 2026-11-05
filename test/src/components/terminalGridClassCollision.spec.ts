// TerminalGrid's scoped stylesheet parks `.grid` off-screen at 900x600 in roster mode, so the
// Tailwind `grid` utility on any other element of this template is parked with it — the folded
// roster's dots vanished that way. jsdom applies no scoped CSS, so only the source can tell.
import { describe, it, expect } from "vitest";
import TerminalGridSource from "../../../src/components/TerminalGrid.vue?raw";

const template = TerminalGridSource.slice(0, TerminalGridSource.indexOf("<style"));
const staticClasses = [...template.matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1]);
const classLists = [...template.matchAll(/:class="([^"]*)"/g)].map((match) => match[1]);

describe("TerminalGrid — the scoped .grid class", () => {
  it("is carried by the cell grid alone", () => {
    const carriers = staticClasses.filter((classes) => classes.split(/\s+/).includes("grid"));
    expect(carriers).toEqual(["grid min-w-0"]);
  });

  it("is never added by a class binding", () => {
    expect(classLists.filter((binding) => binding.split(/[^\w-]+/).includes("grid"))).toEqual([]);
  });
});
