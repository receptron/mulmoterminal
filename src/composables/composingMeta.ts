// xterm's CompositionHelper.keydown commits the in-progress text for any key outside a hand-written
// modifier list that omits Meta, so a bare Cmd during a composition sends it once now and again on
// compositionend (xtermjs/xterm.js#6244). Drop this once an xterm release fixes that list.
type KeyEventShape = Pick<KeyboardEvent, "type" | "key" | "isComposing">;

export const isMetaDuringComposition = (event: KeyEventShape): boolean => event.type === "keydown" && event.isComposing && event.key === "Meta";
