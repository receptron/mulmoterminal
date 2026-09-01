import { describe, it, expect } from "vitest";
import { asAccess } from "../../../src/utils/sharedAppAccessPayload";
import { ACCESS_SUBJECTS } from "../../../common/sharedAppAccess";

const entry = { read: "none", create: false, editOwn: false, editAll: false, repairMirror: false };

/** The server's summary, optionally with one subject's row left out — built from
 *  `ACCESS_SUBJECTS` so a fifth subject joins these cases by existing. */
const payload = (omit?: string) => ({
  publicFace: "declared",
  collections: [
    {
      cid: "records",
      takesSubmissions: true,
      authStage: "verifiedEmail",
      census: { writers: 1, readers: 0, participants: 2 },
      caveats: [] as string[],
      access: Object.fromEntries(ACCESS_SUBJECTS.filter((subject) => subject !== omit).map((subject) => [subject, { ...entry }])),
    },
  ],
});

describe("narrowing the access response", () => {
  it("accepts the summary the server sends", () => {
    expect(asAccess(payload())?.collections[0].census.participants).toBe(2);
  });

  // The narrower names its four subjects one by one (it cannot loop without an assertion), so this
  // is what stops a FIFTH subject being added to the table and silently never checked.
  // The narrower names its four subjects one by one (it cannot loop without an assertion), so this
  // is what stops a FIFTH subject being added to the table and silently never checked.
  it.each([...ACCESS_SUBJECTS])("refuses a summary missing the %s row", (subject) => {
    expect(asAccess(payload(subject))).toBeNull();
  });

  it.each([
    ["an unknown public face", { publicFace: "maybe" }],
    ["collections that are not a list", { collections: {} }],
  ])("refuses %s", (_name, patch) => {
    expect(asAccess({ ...payload(), ...patch })).toBeNull();
  });

  it("refuses a read verdict it does not recognise, rather than falling back to Nothing", () => {
    // Falling back would print "Nothing" in a cell whose real answer we could not read — the one
    // failure mode this whole file exists to prevent.
    const body = payload();
    body.collections[0].access.stranger = { ...entry, read: "some" };
    expect(asAccess(body)).toBeNull();
  });

  it("refuses a census that is not a count", () => {
    const body = payload();
    body.collections[0].census.writers = -1;
    expect(asAccess(body)).toBeNull();
  });
});
