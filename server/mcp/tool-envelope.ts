// How a plugin's response envelope becomes two things: what the GUI panel renders, and what
// claude is told.
//
// Three decisions sat inline in the CallTool handler, between two postJson calls, so no test
// reached them — yet they run for EVERY plugin call:
//
//   - publish a GUI toolResult ONLY when the plugin returned `data`. Flip this and either
//     every panel (forms, charts, collection views) silently stops rendering, or the GUI is
//     flooded with empty results.
//   - the structured-view payload is `jsonData ?? data` — a view falls back to the plain data
//     when the plugin sent no separate structured form.
//   - the narration handed back to claude is message+instructions joined, or the literal
//     "Done". Lose the join and claude gets "Done" instead of a form's instructions and stops
//     following up — a broad, silent regression across all plugins.

export interface ToolEnvelope {
  data?: unknown;
  title?: unknown;
  jsonData?: unknown;
  message?: unknown;
  instructions?: unknown;
}

export interface ToolEnvelopeResult {
  // The GUI toolResult to publish, or null when there is no data to render.
  publish: { title: unknown; data: unknown; jsonData: unknown; message: unknown } | null;
  // The text returned to claude — never empty.
  narration: string;
}

export function interpretToolEnvelope(envelope: ToolEnvelope): ToolEnvelopeResult {
  const publish =
    envelope.data !== undefined
      ? { title: envelope.title, data: envelope.data, jsonData: envelope.jsonData ?? envelope.data, message: envelope.message }
      : null;
  const parts = [envelope.message, envelope.instructions].filter(Boolean);
  return { publish, narration: parts.length ? parts.join("\n") : "Done" };
}
