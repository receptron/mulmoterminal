// Where a campaign's records live, and what anybody does with them (#1815).
//
// Deliberately OUTSIDE every clone and outside the repository tree. That is not only tidiness: a
// task touching this directory is then outside the paths it claimed, so the merge gate rejects it.
// It protects an honest task from a mistake — on the trust model this repo accepts it does not
// stop an adversarial one, which is stated where the decision was made rather than implied here
// (`future/grid-campaign-mode.md`, decision 4).
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { isRecord } from "../../common/isRecord.js";
import path from "node:path";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";
import { parseCampaignLog, recordLine, type CampaignRecord } from "./campaign-log.js";

const CAMPAIGNS_DIR = "campaigns";
const CAMPAIGN_EXT = ".jsonl";

/** A campaign id becomes a FILENAME, so this is the whole defence: no separators, no dots, nothing
 *  that could leave the campaigns directory. **Lowercase**, for the reason `ROOM_ID_RE` is — a
 *  case-insensitive filesystem (the default on macOS and Windows) would otherwise let `Lint` and
 *  `lint` append into one log under two names, and reconciliation would derive idempotency keys
 *  with a different campaign id than the writer used. */
const CAMPAIGN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isCampaignId = (v: unknown): v is string => typeof v === "string" && CAMPAIGN_ID.test(v);

/** Where campaigns live. A function, not a constant, so MULMOTERMINAL_HOME redirects it the way it
 *  redirects everything else this app persists. */
export const campaignsDir = (): string => path.join(mulmoterminalHome(), CAMPAIGNS_DIR);

/** The file for a campaign, or null when the id is not one.
 *
 *  The id check is the WHOLE path defence, so it happens here rather than being assumed of the
 *  caller — the same arrangement `rooms.ts` uses, and for the same reason: every entry point goes
 *  through this function. */
export function campaignFile(campaign: string): string | null {
  return isCampaignId(campaign) ? path.join(campaignsDir(), `${campaign}${CAMPAIGN_EXT}`) : null;
}

/**
 * Is this the filesystem saying "there is nothing here", as opposed to "I could not find out"?
 *
 * The distinction is the whole point of the two functions below. `existsSync` collapses it — it
 * answers `false` for a path that does not exist AND for one it cannot traverse — so it is not
 * used here at all.
 */
const isMissing = (err: unknown): boolean => isRecord(err) && err.code === "ENOENT";

/** Every record for a campaign, oldest first.
 *
 *  A campaign that does not exist is EMPTY; one that cannot be read THROWS. Those are different
 *  answers and must not be given the same one: a permission error coming back as "no records" would
 *  let a runner start a campaign again from `intake` while its real tasks are mid-flight. */
export function readCampaign(campaign: string): CampaignRecord[] {
  const file = campaignFile(campaign);
  if (file === null) return [];
  try {
    return parseCampaignLog(readFileSync(file, "utf8"));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/**
 * Ask the filesystem to make a directory's own contents durable, so that the NAME of a file inside
 * it has a better chance of surviving a power cut.
 *
 * Flushing a file does not do this: the entry pointing at it lives in the parent, and a host that
 * dies at the wrong moment can leave a fsynced file that nothing refers to. Windows cannot open a
 * directory this way and there is nothing to fall back to, so there it is skipped entirely.
 *
 * Neither caller promises the result — see their comments for why — but a refusal below
 * `MULMOTERMINAL_HOME` is still thrown rather than swallowed, because it usually means something
 * else is wrong with the tree this app owns.
 */
function syncDirectory(dir: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Is `candidate` `root` itself, or somewhere inside it? */
function atOrBelow(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Every directory from `top` down to `leaf`, inclusive. */
function chainDown(top: string, leaf: string): string[] {
  const relative = path.relative(top, leaf);
  const segments = relative === "" ? [] : relative.split(path.sep);
  return segments.reduce<string[]>((chain, segment) => [...chain, path.join(chain[chain.length - 1] ?? top, segment)], [top]);
}

/**
 * Create the campaigns directory, and make a best effort at the durability of the names leading to
 * it. Call once, before a campaign starts; idempotent.
 *
 * **Best effort, not a guarantee.** Directory syncing is what a record's name rests on across a
 * power cut, and it is done here as well as it can be — but it cannot be demonstrated by any test,
 * so it is not something to promise. What IS promised is the ordinary part: the directory exists
 * afterwards, and a failure to create it throws rather than being reported as ready.
 *
 * **Why this is a separate step rather than part of every append.** A directory's durability is a
 * property of its whole ancestor chain, and of every other process writing there — one writer can
 * create the hierarchy while a second, whose own `mkdirSync` therefore reports creating nothing,
 * returns before the first has synced it. Chasing that inside `appendCampaignRecord` means either
 * syncing to the filesystem root or racing; both are answers to the wrong question. The hierarchy
 * and the records have different lifetimes, so they get different calls.
 */
export function ensureCampaignStore(): void {
  // Resolved, because MULMOTERMINAL_HOME may be relative: `path.parse("state/campaigns").root` is
  // the empty string, so the walk below would start at `""`, fail there quietly, and never reach
  // the directory that actually holds the new home — the working directory.
  const home = path.resolve(mulmoterminalHome());
  const dir = path.resolve(campaignsDir());
  mkdirSync(dir, { recursive: true });
  // The whole chain, from the filesystem root, unconditionally — not from whatever this call
  // happened to create. Two runners starting at once would otherwise race: the second one's
  // `mkdirSync` reports creating nothing, so it syncs a shorter chain and can return while the
  // first is still working. A caller that syncs the same fixed chain itself needs to know nothing
  // about what the others did, and `MULMOTERMINAL_HOME` can point anywhere, so the only starting
  // point that covers every directory this call might have created is the root.
  //
  // The two halves are not equally this app's business, and they fail differently:
  //
  //  - **HOME and below** is the tree this app owns, so a refusal is surfaced: it usually means
  //    something else is wrong there, and that is worth stopping for.
  //  - **Above HOME** belongs to the machine. Syncing is attempted, because HOME itself may have
  //    been created just now, but a refusal is not fatal: turning "the OS would not let us fsync
  //    `/`" into a campaign that cannot start is a worse failure than the one it prevents.
  chainDown(path.parse(dir).root, dir).forEach((entry) => {
    if (atOrBelow(home, entry)) syncDirectory(entry);
    else trySyncDirectory(entry);
  });
}

/** `syncDirectory` for a directory this app does not own — see `ensureCampaignStore`. */
function trySyncDirectory(dir: string): void {
  try {
    syncDirectory(dir);
  } catch {
    // The machine's own tree. Best effort by design; the promise stops at HOME.
  }
}

/**
 * Append one record.
 *
 * Returns whether it was stored, and a caller that gets `false` MUST NOT go on to cause the effect
 * the record describes: an unwritten intent is an effect nobody can reconcile afterwards. That is
 * the opposite of `postToRoom`'s tolerance of a failed append, and for a reason — a lost message is
 * a lost message, while a lost intent is a merge nobody knows happened.
 *
 * **What `true` promises, and only this**: the record was validated against the reader, written,
 * and flushed — so it survives this process exiting, and it is readable by the next one.
 *
 * Surviving a *power cut* needs more than that: the entry naming the file, the entry naming its
 * directory, and so on up. This call syncs the first of those and `ensureCampaignStore` makes a
 * best effort at the rest, but none of it is promised, because none of it can be demonstrated —
 * telling a fsync from no fsync needs a real power failure, not a test. Do not build a caller that
 * treats `true` as proof against one.
 */
export function appendCampaignRecord(campaign: string, record: CampaignRecord): boolean {
  const file = campaignFile(campaign);
  if (file === null) return false;
  const line = recordLine(record);
  // Write nothing the reader would throw away. `CampaignRecord` is looser than what the file
  // format accepts — `attempt: 0` is a `number`, and `at: Infinity` becomes `null` in JSON — so a
  // record can type-check, land on disk, and be invisible after a restart. That is the lost intent
  // this whole return value exists to prevent.
  //
  // A ROUND TRIP rather than a second predicate: asking whether the reader accepts this exact line
  // cannot drift from what `readCampaign` really accepts, whereas two guards can.
  //
  // Reading back as one record is the whole test: comparing it to `record` afterwards could not
  // fail, both sides being the same JSON projection by then.
  if (parseCampaignLog(line).length !== 1) return false;
  try {
    const dir = path.dirname(file);
    // Convenience so a first append works without setup; the durable-hierarchy promise still
    // belongs to `ensureCampaignStore`, which the runner calls before any of this.
    mkdirSync(dir, { recursive: true });
    // `flush: true` is what makes the `true` below mean something across a power cut: without it
    // the write sits in the page cache, and a host that dies after this call loses the intent
    // while the caller has already been told to go ahead. Node supports it from 21.x and this
    // package requires >=22.12. `rooms.ts` does not flush and is right not to — a lost message is
    // a lost message, while a lost intent is a side effect nobody can reconcile.
    appendFileSync(file, line, { encoding: "utf8", flush: true });
    // The record is on disk from here on, so nothing after this point may report failure.
    //
    // Syncing the file's own name is beyond what this call promises (see above), and a refusal
    // must not turn a written record into a reported one. `false` would leave the caller declining
    // the effect while the log holds an intent for it — which blocks the retry as
    // `intent-while-pending` and sends the next restart reconciling a crash window that never was.
    try {
      syncDirectory(dir);
    } catch (err) {
      console.warn(`[campaign] recorded in ${campaign}, but could not sync its directory: ${err instanceof Error ? err.message : String(err)}`);
    }
    return true;
  } catch (err) {
    console.warn(`[campaign] could not append to ${campaign}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * The campaigns on disk. A restart reads this to find what it must reconcile before doing anything.
 *
 * Regular files only, like `listRooms()`: a DIRECTORY named `c1.jsonl` would otherwise be reported
 * as a campaign and then fail to read as one.
 *
 * Where it deliberately differs from `listRooms()` is the catch. That one swallows every failure,
 * which is right for a listing nobody depends on — here an empty list is indistinguishable from
 * "no campaigns", and a restart would skip reconciliation for tasks that are mid-flight. So only
 * "the directory is not there yet" is empty; anything else reaches the caller.
 */
export function listCampaigns(): string[] {
  try {
    return readdirSync(campaignsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(CAMPAIGN_EXT))
      .map((entry) => entry.name.slice(0, -CAMPAIGN_EXT.length))
      .filter(isCampaignId);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}
