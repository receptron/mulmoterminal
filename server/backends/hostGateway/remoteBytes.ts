// What the gateway passes on of a remote's BYTES response (#3506), and how it rewrites a rendered
// document's links into the host's namespace. Pure.
//
// The bytes are a file from the other machine, served under this server's origin. What keeps a file
// from running here is the remote's own policy, so it is passed on unchanged and required: every
// response says `nosniff`, and every one but a PDF or media says `sandbox` too — the same split the
// remote's raw route makes (server/backends/files/files.ts), because a browser will not open those
// sandboxed. A response that does not say so is refused rather than served without it, and so is a
// sandbox loosened past what the remote ever sends: `allow-same-origin` beside `allow-scripts` would
// run the remote's document as THIS origin.

export const BYTES_SEGMENT = "/bytes";

/** The response headers carried back, and nothing else of the remote's (no cookie, no cache rule). */
const PASSED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
] as const;

const UNSANDBOXED_TYPES = [/^application\/pdf\b/i, /^audio\//i, /^video\//i];

export type BytesPlan = { ok: true; headers: Record<string, string>; rendered: boolean } | { ok: false; reason: string };

// The only allowance the remote's sandboxes carry (server/files/mdPreviewEmbed.ts). Listed rather than
// banned one by one, so a token nobody thought of is refused instead of passed.
const PERMITTED_SANDBOX_ALLOWANCES: ReadonlySet<string> = new Set(["allow-scripts"]);

const sandboxDirectives = (policy: string): string[][] =>
  policy
    .split(";")
    .map((directive) => directive.trim().toLowerCase().split(/\s+/))
    .filter((tokens) => tokens[0] === "sandbox");

/** Whether a policy keeps the document in an opaque origin: a `sandbox` directive, and none that
 *  allows more than scripts. */
export const sandboxes = (policy: string): boolean => {
  const directives = sandboxDirectives(policy);
  return directives.length > 0 && directives.every((tokens) => tokens.slice(1).every((token) => PERMITTED_SANDBOX_ALLOWANCES.has(token)));
};

/** What to send back for a remote response with these headers, or why not to send it at all. */
export function bytesPlan(header: (name: string) => string | null): BytesPlan {
  const type = header("content-type");
  if (!type) return { ok: false, reason: "the remote named no content type" };
  if (header("x-content-type-options")?.trim().toLowerCase() !== "nosniff") return { ok: false, reason: "the remote did not say nosniff" };
  const unsandboxed = UNSANDBOXED_TYPES.some((pattern) => pattern.test(type));
  if (!unsandboxed && !sandboxes(header("content-security-policy") ?? "")) return { ok: false, reason: "the remote did not sandbox this response" };
  const headers = Object.fromEntries(
    PASSED_HEADERS.flatMap((name) => {
      const value = header(name);
      return value === null ? [] : [[name, value]];
    }),
  );
  return { ok: true, headers: { ...headers, "cache-control": "no-store" }, rendered: /^text\/html\b/i.test(type) };
}

// The links a rendered document makes to the remote's own files: its pictures, through the raw route
// (server/files/mdImageSrc.ts). Pointed at this host's bytes, they load the remote's file; left alone
// they would load this machine's file at the same path.
const RAW_LINK = /(["'(])\/api\/files\/raw\?/g;

/** A rendered document from `host`, with its links to the remote's files kept on that host. */
export const rewriteRenderedDoc = (html: string, host: string): string => html.replace(RAW_LINK, `$1/remote/${host}${BYTES_SEGMENT}/api/files/raw?`);
