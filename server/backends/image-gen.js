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

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_IMAGE_CONFIG = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "16:9" },
};

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
      if (part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
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
