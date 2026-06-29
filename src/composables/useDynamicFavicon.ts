// Draws the favicon on a 32×32 canvas and swaps <link rel="icon"> to the result.
// The mark is a terminal prompt — a white "❯" chevron with an accent-colored "_"
// cursor on a dark window — so it reads as a CLI at a glance and is visibly distinct
// from mulmoclaude's mascot/"M" favicon. The accent color is the only state signal,
// so the caller maps its state → color.
import { watch, type ComputedRef, type Ref } from "vue";

const SIZE = 32;
const RADIUS = 7;
const WINDOW_BG = "#1a1a2e"; // the terminal window (midnight)
const PROMPT_FG = "#e8e8f0"; // the "❯" chevron — constant terminal identity

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPrompt(ctx: CanvasRenderingContext2D, accent: string): void {
  ctx.strokeStyle = PROMPT_FG;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(10, 9);
  ctx.lineTo(16, 16);
  ctx.lineTo(10, 23);
  ctx.stroke();
  ctx.fillStyle = accent; // the cursor carries the state color
  roundedRect(ctx, 18, 20.5, 8, 3, 1.5);
  ctx.fill();
}

function render(accent: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  roundedRect(ctx, 1, 1, SIZE - 2, SIZE - 2, RADIUS);
  ctx.fillStyle = WINDOW_BG;
  ctx.fill();
  roundedRect(ctx, 2.5, 2.5, SIZE - 5, SIZE - 5, RADIUS - 1.5);
  ctx.strokeStyle = accent; // state-colored ring reinforces the cursor at 16px
  ctx.lineWidth = 2;
  ctx.stroke();
  drawPrompt(ctx, accent);
  return canvas.toDataURL("image/png");
}

function applyFavicon(dataUrl: string): void {
  if (!dataUrl) return;
  const existing = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  const link = existing ?? document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
  link.type = "image/png";
  link.href = dataUrl;
}

// Repaint the favicon whenever the accent color changes.
export function useDynamicFavicon(color: Ref<string> | ComputedRef<string>): void {
  watch(color, (accent) => applyFavicon(render(accent)), { immediate: true });
}
