// TOKEN ROTATION: several Claude subscriptions behind ONE config home (#2919).
//
// Not an account (common/agentAccounts.ts). An account is a second home, so its conversations stay
// in it; a rotation token is only a credential, handed to a session as CLAUDE_CODE_OAUTH_TOKEN, so
// every conversation stays in the default home and can be resumed on any token. Measured: the
// token outranks the `/login` credential and its statusLine reports that subscription's own windows.
//
// The secret is never in config.json. An entry names WHERE it is — a keychain item or a file — and
// the server reads it per spawn.
import { isRecord } from "./isRecord.js";

export interface RotationToken {
  /** Stable slug. It keys the per-session record and the usage meter. */
  id: string;
  label: string;
  /** The subscription's sign-in address, written by the user and shown beside the usage — the token
   *  says nothing about whose it is that this server can read. */
  email?: string;
  /** macOS keychain item: `security find-generic-password -a <keychainAccount> -s <keychain> -w`. */
  keychain?: string;
  /** Defaults to KEYCHAIN_ACCOUNT_DEFAULT. */
  keychainAccount?: string;
  /** A file holding the token, absolute or `~/`-relative. */
  file?: string;
}

export interface TokenRotation {
  enabled: boolean;
  /** Whether the `/login` credential takes part as one more candidate. */
  includeDefaultLogin: boolean;
  tokens: RotationToken[];
}

export const KEYCHAIN_ACCOUNT_DEFAULT = "mulmoterminal";

/** The id the `/login` credential is recorded under. Not a valid token id, so it cannot collide. */
export const DEFAULT_LOGIN_ID = "@default";

export const ROTATION_TOKEN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const ROTATION_TOKEN_LABEL_MAX = 24;
export const ROTATION_TOKEN_REF_MAX = 500;
export const ROTATION_TOKENS_MAX = 8;
export const ROTATION_TOKEN_EMAIL_MAX = 254;

/** What a terminal line calls the `/login` credential. */
export const DEFAULT_LOGIN_LABEL = "the /login account";

/** The same credential where a label-sized word has to do: the header gauge, beside the labels the
 *  user gave their accounts and tokens. */
export const DEFAULT_LOGIN_SHORT_LABEL = "/login";

/** What a terminal line calls a credential: its label and address, the `/login` one by name, and a
 *  token gone from the config by its id. */
export function rotationLoginLabel(rotation: TokenRotation, tokenId: string): string {
  if (tokenId === DEFAULT_LOGIN_ID) return DEFAULT_LOGIN_LABEL;
  const token = rotation.tokens.find((candidate) => candidate.id === tokenId);
  if (!token) return tokenId;
  return token.email ? `${token.label} (${token.email})` : token.label;
}

export const TOKEN_ROTATION_OFF: TokenRotation = { enabled: false, includeDefaultLogin: true, tokens: [] };

export const isRotationTokenId = (value: unknown): value is string => typeof value === "string" && ROTATION_TOKEN_ID_RE.test(value);

const isTokenFile = (value: unknown): value is string =>
  typeof value === "string" && (value.startsWith("/") || value.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(value));

const optionalEmail = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length <= ROTATION_TOKEN_EMAIL_MAX && /^[^\s@]+@[^\s@]+$/.test(trimmed) ? trimmed : undefined;
};

const optionalRef = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= ROTATION_TOKEN_REF_MAX ? trimmed : undefined;
};

/** One config row as a RotationToken, or null. Exactly one of `keychain` / `file` must be set. */
export function rotationTokenFrom(row: unknown): RotationToken | null {
  if (!isRecord(row) || typeof row.id !== "string" || typeof row.label !== "string") return null;
  const id = row.id.trim();
  const label = row.label.trim().slice(0, ROTATION_TOKEN_LABEL_MAX);
  const keychain = optionalRef(row.keychain);
  const file = optionalRef(row.file);
  if (!isRotationTokenId(id) || !label) return null;
  const email = optionalEmail(row.email);
  const named = email ? { id, label, email } : { id, label };
  if (keychain !== undefined && file === undefined) {
    const keychainAccount = optionalRef(row.keychainAccount);
    return keychainAccount ? { ...named, keychain, keychainAccount } : { ...named, keychain };
  }
  return file !== undefined && keychain === undefined && isTokenFile(file) ? { ...named, file } : null;
}

/** The `tokenRotation` key read back, with every malformed or duplicate row dropped. */
export function sanitizeTokenRotation(input: unknown): TokenRotation {
  if (!isRecord(input)) return TOKEN_ROTATION_OFF;
  const rows = Array.isArray(input.tokens) ? input.tokens : [];
  const tokens = rows
    .map(rotationTokenFrom)
    .filter((token): token is RotationToken => token !== null)
    .filter((token, index, all) => all.findIndex((other) => other.id === token.id) === index)
    .slice(0, ROTATION_TOKENS_MAX);
  return { enabled: input.enabled === true, includeDefaultLogin: input.includeDefaultLogin !== false, tokens };
}
