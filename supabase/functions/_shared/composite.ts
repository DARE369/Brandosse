/**
 * composite.ts — server-side brand compositing for Supabase Edge Functions (Deno).
 *
 * Overlays the user's REAL brand logo onto a generated image (AI can't draw a real
 * logo). Pure-WASM ImageScript — Deno/edge-safe, no native deps.
 * Used opt-in by generateImage and by the flyer renderer.
 */
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

export type LogoPosition =
  | "bottom-right" | "bottom-left" | "top-right" | "top-left" | "bottom-center" | "top-center";

export interface CompositeLogoOptions {
  position?: LogoPosition;
  /** Logo width as a fraction of the base image width (0.04–0.5). */
  scalePct?: number;
  /** Padding from the edges as a fraction of the base width. */
  paddingPct?: number;
}

/**
 * Composite a logo onto a base image. Both inputs are raw bytes (PNG or JPEG).
 * Returns JPEG bytes (quality 90). Throws if either image can't be decoded.
 */
export async function compositeLogo(
  baseBytes: Uint8Array,
  logoBytes: Uint8Array,
  opts: CompositeLogoOptions = {},
): Promise<Uint8Array> {
  const base = await Image.decode(baseBytes);
  const logo = await Image.decode(logoBytes);

  const scalePct = Math.min(Math.max(opts.scalePct ?? 0.16, 0.04), 0.5);
  const targetW = Math.max(1, Math.round(base.width * scalePct));
  const targetH = Math.max(1, Math.round((logo.height / logo.width) * targetW));
  const resized = logo.resize(targetW, targetH);

  const pad = Math.round(base.width * (opts.paddingPct ?? 0.04));
  const pos = opts.position ?? "bottom-right";

  let x = base.width - targetW - pad; // default right
  let y = base.height - targetH - pad; // default bottom
  if (pos.includes("left")) x = pad;
  if (pos.includes("center")) x = Math.round((base.width - targetW) / 2);
  if (pos.includes("top")) y = pad;

  // ImageScript composite preserves the logo's alpha (transparent PNGs stay clean).
  base.composite(resized, x, y);

  return await base.encodeJPEG(90);
}
