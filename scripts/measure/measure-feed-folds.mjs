#!/usr/bin/env node
/**
 * measure-feed-folds.mjs — measure the "… more" cut on MANY real posts at once,
 * from a signed-in feed.
 *
 * measure-caption-fold.mjs measures one post URL with a platform-specific
 * selector. Feeds change their markup constantly, so this does not rely on
 * caption selectors at all: it finds every visible "more" control on the page
 * ("… more", "…see more", "See more", "more"), takes the nearest ancestor that
 * holds real caption text, and measures what is VISIBLE above the control:
 *
 *   visibleChars — code points with a layout box inside every clipping ancestor
 *   visibleLines — distinct rendered line positions among those characters
 *   breaksBefore — line breaks inside the visible part, since a break uses a line
 *
 * Whether a fold is a LINE limit (YouTube's is) or a CHARACTER limit is exactly
 * what this is for: if visibleLines is constant across posts while visibleChars
 * varies with line breaks, the platform folds by lines.
 *
 *   Usage:  node scripts/measure/measure-feed-folds.mjs <platform> --profile <dir> [--headed] [--scrolls N]
 *
 * READ-ONLY. It scrolls and reads. It never clicks "more", likes, follows or posts.
 */
import { chromium } from '@playwright/test';

const FEEDS = {
  linkedin: 'https://www.linkedin.com/feed/',
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/foryou',
};

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const args = process.argv.slice(2);
const platform = args[0];
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const profileDir = flag('--profile');
const scrolls = Number(flag('--scrolls') || 6);
const headed = args.includes('--headed');

if (!FEEDS[platform] || !profileDir) {
  console.error(`Usage: node scripts/measure/measure-feed-folds.mjs <${Object.keys(FEEDS).join('|')}> --profile <dir> [--headed] [--scrolls N]`);
  process.exit(2);
}

function measureInPage() {
  const MORE = /^\s*(…|\.\.\.)?\s*(see\s+)?more\s*$/i;
  const controls = [...document.querySelectorAll('button, span, div[role="button"], a')]
    .filter((el) => MORE.test(el.textContent || '') && el.getClientRects().length > 0)
    .filter((el) => ![...el.children].some((c) => MORE.test(c.textContent || '')));

  const out = [];
  const seen = new Set();
  for (const more of controls) {
    // Nearest ancestor with real text beyond the control itself.
    let container = more.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1) {
      const own = (container.textContent || '').replace(more.textContent || '', '').trim();
      if (own.length >= 40) break;
      container = container.parentElement;
    }
    if (!container || seen.has(container)) continue;
    // A container holding MORE THAN ONE "more" control is a feed section, not a
    // caption. Without this, the climb on LinkedIn stopped at an element
    // spanning many posts, measured it as one, and marked it seen — so 24
    // controls on the page produced one result.
    const controlsInside = controls.filter((c) => container.contains(c)).length;
    if (controlsInside > 1) continue;
    seen.add(container);

    let clip = container.getBoundingClientRect();
    clip = { top: clip.top, bottom: clip.bottom, left: clip.left, right: clip.right };
    for (let el = container; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      // Each axis on its own. A feed scroller is often overflow-x:hidden with
      // overflow-y:scroll; testing the values together treated LinkedIn's <main>
      // as a vertical clip, so every post scrolled out of view measured 0 and a
      // half-visible one was undercounted. Only overflow-y hides lines.
      const r = el.getBoundingClientRect();
      if (/(hidden|clip)/.test(cs.overflowY)) {
        clip = { ...clip, top: Math.max(clip.top, r.top), bottom: Math.min(clip.bottom, r.bottom) };
      }
      if (/(hidden|clip)/.test(cs.overflowX)) {
        clip = { ...clip, left: Math.max(clip.left, r.left), right: Math.min(clip.right, r.right) };
      }
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let visible = 0;
    let total = 0;
    let breaks = 0;
    const lineTops = new Set();
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (more.contains(node)) continue;
      const p = node.parentElement;
      if (p) { const pcs = getComputedStyle(p); if (pcs.visibility === 'hidden' || pcs.display === 'none') continue; }
      let offset = 0;
      for (const ch of node.textContent || '') {
        total += 1;
        range.setStart(node, offset);
        range.setEnd(node, offset + ch.length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
        const inside = rects.find((r) => r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1);
        if (inside) {
          visible += 1;
          lineTops.add(Math.round(inside.top));
          text += ch;
          if (ch === '\n') breaks += 1;
        }
        offset += ch.length;
      }
    }
    // <br> elements are breaks too, and have no text node.
    const brs = [...container.querySelectorAll('br')].filter((br) => {
      const r = br.getBoundingClientRect();
      return r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1;
    }).length;

    if (visible < 20) continue; // a stray "more" link, not a caption
    out.push({
      // What the control actually said, and where the caption lives, so noise
      // (an ads footer, a link-preview headline) can be told apart from captions.
      moreText: (more.textContent || "").trim(),
      containerHint: `${container.tagName.toLowerCase()}${container.getAttribute("data-ad-preview") ? `[data-ad-preview=${container.getAttribute("data-ad-preview")}]` : ""}${container.getAttribute("dir") ? `[dir=${container.getAttribute("dir")}]` : ""}`,
      visibleChars: visible,
      totalChars: total,
      visibleLines: lineTops.size,
      breaksBefore: breaks + brs,
      width: Math.round(clip.right - clip.left),
      tail: text.slice(-30),
    });
  }
  return out;
}

const ctx = await chromium.launchPersistentContext(profileDir, { headless: !headed });
try {
  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    try {
      await page.goto(FEEDS[platform], { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(6_000);
      // The wheel scrolls whatever is under the POINTER. It starts at (0,0),
      // over the header — so on LinkedIn, whose feed scrolls inside <main>,
      // nothing moved and only the first screen was ever measured.
      await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height * 0.6));
      const results = [];
      for (let i = 0; i <= scrolls; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const batch = await page.evaluate(measureInPage);
        for (const r of batch) {
          if (!results.some((x) => x.tail === r.tail && x.visibleChars === r.visibleChars)) results.push(r);
        }
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.wheel(0, vp.height * 0.9);
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(2_500);
      }
      const url = page.url();
      const loggedOut = /login|signin|accounts\/login|checkpoint/i.test(url);
      console.log(JSON.stringify({ platform, viewport: vp.name, url, loggedOut, measuredAt: new Date().toISOString(), posts: results }));
    } catch (err) {
      console.log(JSON.stringify({ platform, viewport: vp.name, error: err.message }));
    } finally {
      await page.close();
    }
  }
} finally {
  await ctx.close();
}
