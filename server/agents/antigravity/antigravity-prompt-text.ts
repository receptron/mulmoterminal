// What the user said in one agy `USER_INPUT` step, out of the wrapper agy stores it in:
// `<USER_REQUEST>\n…\n</USER_REQUEST>` then `<ADDITIONAL_METADATA>` (local time) and
// `<USER_SETTINGS_CHANGE>` (a paragraph about the model the user picked).
const USER_REQUEST_RE = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
const USER_REQUEST_BLOCK_RE = /<USER_REQUEST>[\s\S]*?<\/USER_REQUEST>/g;
const APPENDED_BLOCK_RE = /<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>[\s\S]*?<\/\1>/g;

/** The request inside the wrapper; when it is empty or missing, whatever agy wrote outside its own
 *  blocks. Approving an artifact in agy's UI writes an EMPTY request and states the approval above
 *  it ("Comments on artifact URI: …"), and that is still the user acting. Untrimmed: callers trim. */
export function antigravityPromptText(content: string): string {
  const request = USER_REQUEST_RE.exec(content)?.[1];
  if (request !== undefined && request.trim() !== "") return request;
  return content.replace(USER_REQUEST_BLOCK_RE, "").replace(APPENDED_BLOCK_RE, "");
}
