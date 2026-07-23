import type { Part } from "@google/genai";

// The MIME type comes from the (untrusted) model response and is embedded into a
// `data:` URL, so constrain it to a safe image allowlist and default to PNG.
export const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const DEFAULT_IMAGE_MIME = "image/png";

export type ImageResult = {
  imageData?: string;
  mimeType: string;
  text?: string;
};

const safeMimeType = (mimeType: string | undefined): string => (mimeType && ALLOWED_IMAGE_MIME.has(mimeType) ? mimeType : DEFAULT_IMAGE_MIME);

// Take the FIRST inline image together with its OWN mimeType, so a `data:` URL can
// never pair one part's bytes with another part's MIME. When that image's MIME is
// outside the allowlist we fall back to PNG, but the bytes stay that same part's.
export const extractImageResult = (parts: Part[]): ImageResult => {
  const imagePart = parts.find((part) => part.inlineData?.data);
  const textPart = parts.find((part) => part.text);
  return {
    imageData: imagePart?.inlineData?.data,
    mimeType: safeMimeType(imagePart?.inlineData?.mimeType),
    text: textPart?.text,
  };
};
