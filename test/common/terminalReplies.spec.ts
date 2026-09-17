// @vitest-environment node
// The emulator answers the application's queries on the input channel, and those answers look
// exactly like typing. Counting them as typing refused every answer from the question pane after
// any attach, resize or theme read (#1693). The samples below were CAPTURED from a real cell.
import { describe, it, expect } from "vitest";
import { scanForUserInput, scanForDraftInput } from "../../common/terminalReplies";

const ESC = "\u001b";
const scan = (data: string, pending = "") => scanForUserInput(pending, data);

describe("scanForUserInput", () => {
  it("does not read the replies a real cell sent before a single button press as typing", () => {
    expect(scan(`${ESC}[?1;2c`).fromUser).toBe(false); // primary device attributes
    expect(scan(`${ESC}[>0;276;0c`).fromUser).toBe(false); // secondary device attributes
    expect(scan(`${ESC}]10;rgb:1b1b/2424/3030${ESC}\\`).fromUser).toBe(false); // foreground colour
    expect(scan(`${ESC}]11;rgb:f4f4/f6f6/fbfb${ESC}\\`).fromUser).toBe(false); // background colour
  });

  it("does not read focus or cursor-position reports as typing", () => {
    expect(scan(`${ESC}[I`).fromUser).toBe(false);
    expect(scan(`${ESC}[O`).fromUser).toBe(false);
    expect(scan(`${ESC}[24;80R`).fromUser).toBe(false);
  });

  // The other half, and the one that must not slip: these ARE the user answering.
  it("reads anything a person could have typed as typing", () => {
    expect(scan("a").fromUser).toBe(true);
    expect(scan("\r").fromUser).toBe(true);
    expect(scan("おした").fromUser).toBe(true);
    expect(scan(`${ESC}[B`).fromUser).toBe(true); // Down, normal cursor mode
    expect(scan(`${ESC}OB`).fromUser).toBe(true); // Down, application cursor mode — captured
  });

  // A click can select an option, so it is the user answering — however much it looks like a report.
  it("reads mouse reports as the user", () => {
    expect(scan(`${ESC}[<0;12;34M`).fromUser).toBe(true);
    expect(scan(`${ESC}[M\u0020\u0021\u0022`).fromUser).toBe(true);
  });

  it("reads a chunk that carries both a reply and a keystroke as typing", () => {
    expect(scan(`${ESC}[?1;2cx`).fromUser).toBe(true);
  });

  // THE SPLIT. The socket breaks where it likes, and half a reply matches nothing — which is how
  // this same false alarm comes back through the back door.
  it("holds an unfinished reply instead of calling it typing", () => {
    const first = scan(`${ESC}[?1`);
    expect(first).toEqual({ fromUser: false, pending: `${ESC}[?1` });

    expect(scan(";2c", first.pending)).toEqual({ fromUser: false, pending: "" });
  });

  it("holds an unfinished colour reply across three chunks", () => {
    const a = scan(`${ESC}]11;rgb:f4f4`);
    expect(a.fromUser).toBe(false);
    const b = scan("/f6f6/fbfb", a.pending);
    expect(b.fromUser).toBe(false);
    expect(scan(`${ESC}\\`, b.pending)).toEqual({ fromUser: false, pending: "" });
  });

  // Held only while it could still BECOME a reply: a key that already carries its final letter is
  // finished, and waiting for more would let a real answer slip past unnoticed.
  it("does not hold a keystroke that merely starts like one", () => {
    expect(scan(`${ESC}[B`).pending).toBe("");
    expect(scan("x", `${ESC}[?1`).fromUser).toBe(true); // the tail turned out not to be a reply
  });

  // Escape is how the dialog is CANCELLED. Holding it would let a paced answer carry on typing into
  // a question the user had just dismissed.
  it("reads a lone Escape as the user, never as an unfinished reply", () => {
    expect(scan(ESC)).toEqual({ fromUser: true, pending: "" });
  });

  it("has nothing to report for an empty chunk", () => {
    expect(scan("")).toEqual({ fromUser: false, pending: "" });
  });
});

describe("scanForDraftInput", () => {
  it.each([`${ESC}[<64;20;10M`, `${ESC}[<65;20;10M`, `${ESC}[<0;20;10M${ESC}[<0;20;10m`, `${ESC}[M !"`])(
    "distinguishes complete mouse activity from draft input: %j",
    (mouse) => {
      expect(scanForUserInput("", mouse).fromUser).toBe(true);
      expect(scanForDraftInput("", mouse)).toEqual({ fromUser: false, pending: "" });
      expect(scanForDraftInput("", `${ESC}[I${mouse}${ESC}[?1;2c`).fromUser).toBe(false);
    },
  );
  it.each(["draft", `${ESC}[A`, `${ESC}[<64;20;10Mdraft`, `draft${ESC}[<0;20;10m`, `${ESC}[<64;20`, `${ESC}[M !`, `${ESC}[200~${ESC}[<0;20;10M${ESC}[201~`])(
    "preserves text, history keys, incomplete reports and pasted input: %j",
    (input) => expect(scanForDraftInput("", input).fromUser).toBe(true),
  );
});
