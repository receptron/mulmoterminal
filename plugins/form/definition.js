// gui-chat-protocol ToolDefinition for presentForm. The MCP broker passes
// `parameters` straight through as the JSON-schema inputSchema (no zod).
//
// The round-trip is NOT a blocking MCP call: the form renders, the user submits, and
// their answer is typed back into the PTY as the next user turn (the same GUI->LLM
// mechanism MulmoClaude uses). So the description tells claude to wait for it.
export const TOOL_DEFINITION = {
  type: "function",
  name: "presentForm",
  description:
    "Ask the user for structured input via a form in the GUI panel, instead of " +
    "free-text in the terminal. The form renders beside the terminal; when the user " +
    "submits, their answers arrive as your next user message. After calling this, " +
    "wait for that message before continuing.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Heading shown above the form." },
      fields: {
        type: "array",
        description: "The fields to collect.",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Key this field's value appears under in the answer.",
            },
            label: { type: "string", description: "Human-readable label (defaults to name)." },
            type: {
              type: "string",
              enum: ["text", "textarea", "number", "select"],
              description: "Control type (default: text).",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Choices for a 'select' field.",
            },
            placeholder: { type: "string" },
            required: { type: "boolean" },
          },
          required: ["name"],
        },
      },
      submitLabel: { type: "string", description: "Label for the submit button." },
    },
    required: ["fields"],
  },
};
