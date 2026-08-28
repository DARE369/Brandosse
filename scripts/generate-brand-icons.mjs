#!/usr/bin/env node
/**
 * Writes every brand icon the product serves, from the one definition of the
 * mark in src/ui-v2/brand/studioMark.mjs.
 *
 * ── Why a generator and not eleven hand-made files ──────────────────────────
 * A favicon set is the classic place for drift: someone updates the header
 * logo, the tab icon stays as it was, and nobody notices for months because
 * nobody looks at their own tab. Generating them means the tab and the header
 * cannot disagree — they are the same geometry, run twice.
 *
 * Outputs (committed, not built at deploy time):
 *   public/favicon.svg          the mark, for browsers that take SVG
 *   public/icon-192.png         manifest / Android
 *   public/icon-512.png         manifest / install prompt
 *   public/apple-touch-icon.png 180px, Safari home screen (needs a background,
 *                               because iOS composites onto white otherwise)
 *   public/favicon.ico          64px, for the browsers and crawlers that ask
 *                               for /favicon.ico by name whatever the markup
 *                               says. The one that shipped was zero bytes.
 *
 * Usage: npm run brand:icons
 * Requires the Playwright chromium already used by the e2e suite — it is the
 * rasteriser, so no image library is added to the dependency tree.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { studioMarkSvgDocument } from "../src/ui-v2/brand/studioMark.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

/** iOS ignores transparency and composites onto white, which loses the pale
 *  slab entirely. The touch icon therefore ships on the app's own canvas. */
const TOUCH_ICON_BACKGROUND = "#0E0F11";

const RASTERS = [
  { file: "icon-ico-source.png", size: 64, pad: 0, background: null },
  { file: "icon-192.png", size: 192, pad: 0, background: null },
  { file: "icon-512.png", size: 512, pad: 0, background: null },
  { file: "apple-touch-icon.png", size: 180, pad: 18, background: TOUCH_ICON_BACKGROUND },
];

async function main() {
  const svg = studioMarkSvgDocument("dark");
  fs.writeFileSync(path.join(PUBLIC, "favicon.svg"), svg, "utf8");
  console.log("wrote public/favicon.svg");

  const browser = await chromium.launch();
  try {
    for (const raster of RASTERS) {
      const inner = raster.size - raster.pad * 2;
      const page = await browser.newPage({
        viewport: { width: raster.size, height: raster.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<body style="margin:0;width:${raster.size}px;height:${raster.size}px;`
        + `display:grid;place-items:center;background:${raster.background ?? "transparent"}">`
        + svg.replace('width="1024" height="1024"', `width="${inner}" height="${inner}"`)
        + "</body>",
      );
      await page.screenshot({
        path: path.join(PUBLIC, raster.file),
        omitBackground: raster.background === null,
      });
      await page.close();
      console.log(`wrote public/${raster.file}`);
    }
  } finally {
    await browser.close();
  }

  // An .ico may simply contain a PNG, which every browser that still asks for
  // /favicon.ico has understood for fifteen years. Wrapping one is six fields
  // of header, and avoids adding an image library for a single 64px file.
  const png = fs.readFileSync(path.join(PUBLIC, "icon-ico-source.png"));
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(64, 6); // width
  header.writeUInt8(64, 7); // height
  header.writeUInt8(0, 8); // palette size: none
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // the image starts right after this header
  fs.writeFileSync(path.join(PUBLIC, "favicon.ico"), Buffer.concat([header, png]));
  fs.unlinkSync(path.join(PUBLIC, "icon-ico-source.png"));
  console.log("wrote public/favicon.ico");

  const manifest = {
    name: "Studio",
    short_name: "Studio",
    description: "A credit-based content workspace: generate, clip, schedule, measure.",
    start_url: "/app/dashboard",
    display: "standalone",
    background_color: "#0E0F11",
    theme_color: "#0E0F11",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
  fs.writeFileSync(path.join(PUBLIC, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log("wrote public/manifest.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
