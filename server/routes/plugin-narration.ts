// How a plugin tool route reports a failure.
//
// Always as HTTP 200 carrying a `message`, never as a status the client can read as an
// error: the GUI MCP broker's postJson REJECTS a non-2xx, and that reaches the agent as a
// THROWN tool call — something it can neither read nor act on. A failure narrated instead
// stays in the conversation, so the agent sees what went wrong and can try something else.
//
// Each route keeps its own wording, since that sentence is what the agent reads; only the
// rule for reading an upstream router's error is shared, and it lives here because it is the
// part with a decision in it (#548).
import { isRecord } from "../session/transcript.js";

// The routers 4xx their domain errors as `{ error }` — prefer that sentence, which names the
// actual problem, over anything this side could invent. The status-only fallback covers a
// body that is missing, not an object, or shaped some other way.
export function upstreamFailureMessage(status: number, body: unknown, fallback: string): string {
  return isRecord(body) && typeof body.error === "string" ? body.error : `${fallback} (HTTP ${status})`;
}
