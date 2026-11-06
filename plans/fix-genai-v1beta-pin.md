# fix: pin the image-generation client to Gemini API v1beta

## Why

`@google/genai` 3 (#3286) moved the Gemini Developer API default from `v1beta` to `v1`. Image generation
(`server/backends/media/image-gen.ts`) uses a preview model plus `responseModalities` / `imageConfig`, and
nothing has checked that `v1` accepts them — the specs mock the SDK, and a refusal only shows up as an
`Image generation failed: …` message.

## Change

Pass `apiVersion: "v1beta"` to the one `GoogleGenAI` client, so requests go where genai 2 sent them.

## Follow-up

#3287: verify on `v1` with a real key and drop the pin if it works.
