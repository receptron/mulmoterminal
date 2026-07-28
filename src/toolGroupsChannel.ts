// The pub/sub channel the server announces a session's newly learned tool groups on.
//
// Its own channel rather than the `sessions` one: that channel's consumer admits anything with
// an `id` and feeds it to applyActivity, so a message shaped like this would be read as an
// activity update. Kept in src/ rather than common/ because the server names it in
// routes/mcp-routes.ts, and a shared constant either side could edit is the thing the two-copy
// comment usually precedes — this one is pinned by a spec instead.
export const TOOL_GROUPS_CHANNEL = "tool-groups";
