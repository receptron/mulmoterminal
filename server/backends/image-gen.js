// Image-generation backend for the @mulmochat-plugin/generate-image plugin.
//
// The package is host-agnostic: its execute() calls `context.app.generateImage(prompt)`
// and returns whatever ToolResult that yields. The server plugin registry injects
// THIS function as `context.app.generateImage` (see plugins-registry.js), so the
// generateImage tool resolves to a real Gemini call here.
//
// We return the image as a base64 data URI in `data.imageData`; ui-image's ImageView
// binds that straight into `<img src>`, so MulmoTerminal needs no image storage or
// serving route. Mirrors MulmoClaude's server/utils/gemini.ts (same model + config).
import { GoogleGenAI } from "@google/genai";

// Mirrors MulmoClaude's default. This is a PREVIEW model Google schedules for
// retirement (~mid-2026); override with GEMINI_IMAGE_MODEL to pin a stable model
// (e.g. "gemini-2.5-flash-image") without a code change.
const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
const DEFAULT_IMAGE_CONFIG = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "16:9" },
};

// The MIME type comes from the (untrusted) model response and is embedded into a
// `data:` URL, so constrain it to a safe image allowlist and default to PNG.
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

let client = null;
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

// gui-chat-protocol ToolContext.app.generateImage contract: (prompt) -> ToolResult.
export async function generateImage(prompt) {
  const ai = getClient();
  if (!ai) {
    return { message: "Image generation is unavailable on this server (set GEMINI_API_KEY)." };
  }
  let response;
  try {
    response = await ai.models.generateContent({
      model: DEFAULT_IMAGE_MODEL,
      contents: [{ text: prompt }],
      config: DEFAULT_IMAGE_CONFIG,
    });
  } catch (e) {
    return { message: `Image generation failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Reduce the response parts to the first inline image + any text (mirrors
  // gemini.ts#extractImageResult).
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  let imageData;
  let mimeType = "image/png";
  let text;
  for (const part of parts) {
    if (part.inlineData?.data) {
      imageData = part.inlineData.data;
      const mt = part.inlineData.mimeType;
      if (mt && ALLOWED_IMAGE_MIME.has(mt)) mimeType = mt;
    } else if (part.text) {
      text = part.text;
    }
  }

  if (!imageData) {
    return { message: text || "Gemini returned no image (the prompt may have been filtered)." };
  }
  return {
    message: text || `Generated an image for: ${prompt}`,
    data: { imageData: `data:${mimeType};base64,${imageData}`, prompt },
  };
}
