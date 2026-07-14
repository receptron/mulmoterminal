// Fire a Web Push via mulmoserver's `sendPush` when a task finishes. The wire contract and
// send core live in @mulmobridge/web-push (shared with MulmoClaude so the two can't drift);
// here we inject the RemoteHost Firebase sign-in as the token provider, so this no-ops
// whenever RemoteHost isn't connected (currentIdToken yields null → no network call, no throw).
import { sendWebPush as sendPush, type SendPushResult } from "@mulmobridge/web-push";
import { currentIdToken } from "./backends/remoteHost/session.js";

export const sendWebPush = (title: string, body: string): Promise<SendPushResult | null> => sendPush(title, body, { getIdToken: currentIdToken });
