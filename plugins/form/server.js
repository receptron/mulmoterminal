// Server-side handler for the form plugin. Validates the schema and echoes it as
// the toolResult `data` the GUI view renders. The form's ANSWER does not come back
// through here — it is typed into the PTY by the view (see View.vue).
//
// Shape mirrors a gui-chat-protocol package's execute: it takes the parsed tool args
// and returns the result envelope { data, jsonData, message, instructions, title? }.
export function execute(args) {
  const { title, fields, submitLabel } = args || {};
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("`fields` is required and must be a non-empty array.");
  }
  for (const f of fields) {
    if (!f || typeof f.name !== "string" || !f.name) {
      throw new Error("Every field needs a string `name`.");
    }
  }
  const data = { title, fields, submitLabel };
  return {
    title,
    data,
    jsonData: data,
    message: `Presented a form with ${fields.length} field(s).`,
    instructions:
      "The form is shown in the user's GUI panel. Wait for the user to submit it; " +
      "their answers will arrive as your next user message.",
  };
}
