import type { Ref } from "vue";
import { useSessionFeed } from "./useSessionFeed";
import { readToolCall, type ToolCall } from "../components/toolCall";
import { pathOnHost } from "../components/remoteCell";
import { remoteSessionChannel } from "../../common/remoteHosts";

// One session's tool calls: the stored history, then the live channel. Keying by tool_use_id lets a
// PostToolUse complete the "running" entry its PreToolUse created. A remote session's (#3506) are
// read through the gateway, and heard on the Mac-side name the relay follows its channel under.
export function useToolCallFeed(
  calls: Ref<ToolCall[]>,
  sessionId: () => string | null,
  onSessionChange?: () => void,
  host: () => string | null = () => null,
): void {
  useSessionFeed(calls, {
    sessionId,
    historyUrl: (id) => pathOnHost(host(), `/api/tool-calls/${encodeURIComponent(id)}`),
    historyKey: "toolCalls",
    channel: (id) => {
      const on = host();
      return on ? remoteSessionChannel(on, "toolcalls", id) : `toolcalls:${id}`;
    },
    identify: (call) => call.toolUseId,
    parse: readToolCall,
    ...(onSessionChange ? { onSessionChange } : {}),
  });
}
