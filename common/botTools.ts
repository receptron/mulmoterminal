// Conversation control tools are discovered through the bot skill, not the Canvas tool hints.
// Shared with the MCP broker so filtering cannot drift as another Bot operation is added.
const BOT_TOOL_NAMES = new Set(["manageBot", "sendToBot", "readBotReplies", "replyToFrontend"]);
export const isBotTool = (name: string): boolean => BOT_TOOL_NAMES.has(name);
