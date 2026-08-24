/**
 * composite.ts — server-side brand compositing for Supabase Edge Functions (Deno).
 *
 * Overlays the user's REAL brand logo onto a generated image (AI can't draw a real
 * logo). Pure-WASM ImageScript — Deno/edge-safe, no native deps.
 * Used by generateImage (see resolveBrandLogo there) and by the flyer renderer.
 *
 * SVG note (2026-08-24): ImageScript decodes PNG/JPEG only. Logos are very
 * often SVG — the first real logo in this database is
 * `Oriki_Soda_Co_Logo.svg` — so an SVG-only brand had NO path to a composited
 * logo at all. `rasterizeIfSvg` closes that with resvg-wasm, imported lazily
 * so raster logos and logo-free generations never pay its cold start.
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

/** Width in px that SVG logos are rasterised to. Comfortably above any
 *  on-image use (16% of a 2048px image is ~330px) so downscaling stays sharp. */
const SVG_RASTER_WIDTH = 1024;

let _wasmReady: Promise<unknown> | null = null;

function looksLikeSvg(bytes: Uint8Array, mimeType?: string): boolean {
  if (mimeType && mimeType.toLowerCase().includes("svg")) return true;
  // Sniff the first bytes: an SVG is text starting with "<svg" or an XML prolog.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 256))
    .trim()
    .toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

/**
 * Convert SVG bytes to PNG bytes. Returns the input untouched when it is not
 * an SVG, so callers can pipe every logo through this unconditionally.
 *
 * Throws if an SVG cannot be rasterised — the caller must decide what a
 * missing logo means. It must never be swallowed into an unbranded image.
 */
export async function rasterizeIfSvg(
  bytes: Uint8Array,
  mimeType?: string,
): Promise<Uint8Array> {
  if (!looksLikeSvg(bytes, mimeType)) return bytes;

  const { initWasm, Resvg } = await import("https://esm.sh/@resvg/resvg-wasm@2.6.2");
  if (!_wasmReady) {
    _wasmReady = initWasm(
      fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm"),
    ).catch((err) => {
      _wasmReady = null; // let a later generation retry rather than caching the failure
      throw err;
    });
  }
  await _wasmReady;

  const svgText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const resvg = new Resvg(svgText, {
    fitTo: { mode: "width", value: SVG_RASTER_WIDTH },
    // Logos are overwhelmingly vector paths. Text-as-text needs embedded fonts,
    // which the edge runtime has none of; such an SVG rasterises without the
    // text rather than failing, so the caller still gets a usable mark.
    background: "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
}

/**
 * Composite a logo onto a base image. Both inputs are raw bytes (PNG, JPEG, or
 * SVG — SVG is rasterised first). Returns JPEG bytes (quality 90).
 * Throws if either image can't be decoded.
 */
export async function compositeLogo(
  baseBytes: Uint8Array,
  logoBytes: Uint8Array,
  opts: CompositeLogoOptions & { logoMimeType?: string } = {},
): Promise<Uint8Array> {
  const base = await Image.decode(baseBytes);
  const logo = await Image.decode(await rasterizeIfSvg(logoBytes, opts.logoMimeType));

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
