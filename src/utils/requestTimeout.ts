// What a request that ran out of time rejects with. A bare `abort()` surfaces as Chromium's
// "signal is aborted without reason", which tells the user neither that it was a timeout nor what
// to do (#3293). `TimeoutError` is the name `AbortSignal.timeout` uses, so it reads as the platform's.
import { requestTimeoutEn } from "../i18n/requestTimeout/en";

const TIMEOUT_ERROR_NAME = "TimeoutError";
const MS_PER_SECOND = 1_000;

export type RequestTimeoutText = (seconds: number) => string;

const englishText: RequestTimeoutText = (seconds) => requestTimeoutEn.message.replace("{seconds}", String(seconds));

// Installed by src/i18n rather than imported from it: this file sits under every `/api` call, and
// pulling vue-i18n and all five bundles in here would load them into every spec that fetches.
let timeoutText: RequestTimeoutText = englishText;

export function setRequestTimeoutText(text: RequestTimeoutText): void {
  timeoutText = text;
}

export function requestTimeoutError(timeout_ms: number): DOMException {
  const seconds = Math.max(1, Math.round(timeout_ms / MS_PER_SECOND));
  return new DOMException(timeoutText(seconds), TIMEOUT_ERROR_NAME);
}

export const isRequestTimeout = (err: unknown): err is DOMException => err instanceof DOMException && err.name === TIMEOUT_ERROR_NAME;
