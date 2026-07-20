// Fire a Web Push via mulmoserver's `sendPush` when a task finishes. The wire contract and
// send core live in @mulmobridge/web-push (shared with MulmoClaude so the two can't drift);
// here we inject the RemoteHost Firebase sign-in as the token provider, so this no-ops
// whenever RemoteHost isn't connected (currentIdToken yields null → no network call, no throw).
import { sendWebPush as sendPush, type SendPushResult } from "@mulmobridge/web-push";
import { currentIdToken } from "../backends/remoteHost/session.js";

// `data` rides alongside the notification as FCM routing so a tap can land on the
// session the push came from rather than the home screen (mulmoserver#75). It is
// never a replacement for the notification: both receivers drop a data-only message.
export const sendWebPush = (title: string, body: string, data?: Record<string, string>): Promise<SendPushResult | null> =>
  sendPush(title, body, { getIdToken: currentIdToken, data });
