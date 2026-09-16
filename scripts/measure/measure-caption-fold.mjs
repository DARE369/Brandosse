#!/usr/bin/env node
/**
 * measure-caption-fold.mjs — count what a real post shows before "… more".
 *
 * The fold figures in src/calendar/platformPreview.js are observed behaviour —
 * no platform publishes where it truncates a caption. This tool is how an
 * UNVERIFIED figure becomes MEASURED: it loads a real, public post in a real
 * browser at a phone and a desktop viewport, and counts the caption characters
 * that are actually VISIBLE before the platform collapses it.
 *
 * ── How "visible" is decided ────────────────────────────────────────────────
 * Not by reading the DOM text. Platforms truncate two different ways:
 *   * by REMOVING text and appending "… more" (the DOM holds only the visible
 *     part), and
 *   * by CLIPPING with -webkit-line-clamp / overflow:hidden (the DOM holds the
 *     whole caption; most of it is laid out and hidden).
 * Counting DOM text gets the second kind wrong by the entire hidden length. So
 * each character is measured with a Range: it counts as visible only if it has
 * a layout box inside the caption container's clipped bounds. Characters inside
 * the "more" control itself are excluded.
 *
 * Counts code points, like platformPreview.splitAtFold — "🎉".length is 2.
 *
 *   Usage:  node scripts/measure/measure-caption-fold.mjs <platform> <url> [--headed]
 *           node scripts/measure/measure-caption-fold.mjs linkedin <url> --profile <dir> --login   (once, sign in by hand)
 *           node scripts/measure/measure-caption-fold.mjs linkedin <url> --profile <dir>
 *   Platforms with a selector profile below: youtube, linkedin, tiktok, instagram, facebook
 *
 * Prints one JSON line per viewport. A result is only worth recording as
 * MEASURED if `folded` is true and `visible` < `total` — otherwise the caption
 * was too short to hit the fold, and the run measured nothing.
 */
import { chromium } from '@playwright/test';

const PROFILES = {
  youtube: {
    container: ['ytd-watch-metadata #description-inline-expander #attributed-snippet-text', 'ytd-text-inline-expander #attributed-snippet-text', '#description-inline-expander yt-attributed-string'],
    more: ['tp-yt-paper-button#expand', '#expand', 'button[aria-label*="more" i]'],
    consent: ['button[aria-label^="Accept" i]', 'button:has-text("Accept all")', 'button:has-text("Reject all")'],
  },
  linkedin: {
    container: ['.attributed-text-segment-list__content', '.feed-shared-update-v2__description', 'p[data-test-id="main-feed-activity-card__commentary"]'],
    more: ['button:has-text("see more")', '.show-more-less-text__button', 'button[aria-label*="more" i]'],
    consent: ['button:has-text("Accept")', 'button:has-text("Dismiss")'],
  },
  tiktok: {
    container: ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]', 'h1[data-e2e="browse-video-desc"]'],
    more: ['button:has-text("more")', '[data-e2e="browse-video-desc"] + button'],
    consent: ['button:has-text("Accept all")', 'button:has-text("Decline optional cookies")'],
  },
  instagram: {
    container: ['h1', 'article span[dir="auto"]'],
    more: ['span:has-text("more")', 'button:has-text("more")'],
    consent: ['button:has-text("Allow all cookies")', 'button:has-text("Decline optional cookies")'],
  },
  facebook: {
    container: ['[data-ad-preview="message"]', 'div[data-ad-comet-preview="message"]'],
    more: ['div[role="button"]:has-text("See more")'],
    consent: ['button:has-text("Allow all cookies")', 'div[role="button"]:has-text("Decline optional cookies")'],
  },
};

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  { name: 'desktop', width: 1366, height: 900, isMobile: false, hasTouch: false },
];

async function firstPresent(page, selectors, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      // eslint-disable-next-line no-await-in-loop
      const el = await page.$(sel).catch(() => null);
      // eslint-disable-next-line no-await-in-loop
      if (el && await el.isVisible().catch(() => false)) return { el, sel };
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
  }
  return null;
}

async function measureOne(browser, platform, url, vp, headed) {
  const profile = PROFILES[platform];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    userAgent: vp.userAgent,
    locale: 'en-US',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    for (const sel of profile.consent) {
      // eslint-disable-next-line no-await-in-loop
      const btn = await page.$(sel).catch(() => null);
      // eslint-disable-next-line no-await-in-loop
      if (btn && await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); break; }
    }
    await page.waitForTimeout(3500);

    const found = await firstPresent(page, profile.container);
    if (!found) {
      return { platform, viewport: vp.name, url, ok: false, reason: 'caption container not found (selector profile out of date, login wall, or bot check)' };
    }
    const moreFound = await firstPresent(page, profile.more, 3_000);

    const result = await page.evaluate(({ containerSel, moreSel }) => {
      const container = document.querySelector(containerSel);
      const more = moreSel ? document.querySelector(moreSel) : null;
      if (!container) return null;

      // Intersect the container's box with every ancestor that TRUNCATES.
      //
      // Only overflow hidden/clip truncates. auto/scroll only makes content
      // reachable by scrolling, so it never hides a caption for good — and
      // counting it broke the first real run: YouTube's <body> is a scroll
      // container that reports 0px tall, which clipped every character to
      // invisible and measured the fold as 0. body and html are skipped outright
      // for the same reason.
      let clip = container.getBoundingClientRect();
      clip = { top: clip.top, bottom: clip.bottom, left: clip.left, right: clip.right };
      for (let el = container; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (/(hidden|clip)/.test(`${cs.overflow} ${cs.overflowY} ${cs.overflowX}`)) {
          const r = el.getBoundingClientRect();
          clip = {
            top: Math.max(clip.top, r.top), bottom: Math.min(clip.bottom, r.bottom),
            left: Math.max(clip.left, r.left), right: Math.min(clip.right, r.right),
          };
        }
      }

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let total = 0;
      let visible = 0;
      let visibleText = '';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (more && more.contains(node)) continue;
        const parent = node.parentElement;
        if (parent) {
          const pcs = getComputedStyle(parent);
          if (pcs.visibility === 'hidden' || pcs.display === 'none') continue;
        }
        const text = node.textContent || '';
        let offset = 0;
        for (const ch of text) {
          const len = ch.length;
          total += 1;
          range.setStart(node, offset);
          range.setEnd(node, offset + len);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
          const inside = rects.some((r) => r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1
            && r.left >= clip.left - 1 && r.right <= clip.right + 1);
          // Whitespace has no meaningful box; count it with the text around it
          // only when something visible precedes it, so trailing hidden space
          // does not inflate the figure.
          if (inside || (/\s/.test(ch) && visible > 0 && rects.length === 0)) {
            visible += 1;
            visibleText += ch;
          }
          offset += len;
        }
      }
      return {
        total,
        visible,
        folded: Boolean(more) || visible < total,
        moreControlPresent: Boolean(more),
        visibleTail: visibleText.slice(-40),
      };
    }, { containerSel: found.sel, moreSel: moreFound?.sel || null });

    const shot = `measure-${platform}-${vp.name}.png`;
    if (headed) await page.screenshot({ path: shot });
    return {
      platform, viewport: vp.name, width: vp.width, url, ok: Boolean(result),
      containerSelector: found.sel, moreSelector: moreFound?.sel || null,
      measuredAt: new Date().toISOString(),
      ...result,
    };
  } catch (err) {
    return { platform, viewport: vp.name, url, ok: false, reason: err.message };
  } finally {
    await context.close();
  }
}

const [platform, url, ...flags] = process.argv.slice(2);
if (!PROFILES[platform] || !url) {
  console.error(`Usage: node scripts/measure/measure-caption-fold.mjs <${Object.keys(PROFILES).join('|')}> <url> [--headed]`);
  process.exit(2);
}
const headed = flags.includes('--headed');

// --profile <dir>: use a persistent, logged-in browser profile. LinkedIn,
// Instagram, TikTok and Facebook put public posts behind a login wall or a bot
// check for a fresh browser. Run once with --headed --login to sign in by hand;
// every later run reuses that session. The directory holds cookies — keep it out
// of git (it lives under the OS temp dir by default).
const profileIndex = flags.indexOf('--profile');
const profileDir = profileIndex >= 0 ? flags[profileIndex + 1] : null;

if (profileDir && flags.includes('--login')) {
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: { width: 1366, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(url);
  console.log('Sign in in the opened window, then close it. The session is saved to', profileDir);
  await new Promise((resolve) => ctx.on('close', resolve));
  process.exit(0);
}

if (profileDir) {
  // A persistent context is one browser; viewports are applied per page.
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: !headed });
  const shim = { newContext: async (opts) => {
    const page = await ctx.newPage();
    await page.setViewportSize(opts.viewport);
    return { newPage: async () => page, close: async () => page.close() };
  } };
  try {
    for (const vp of VIEWPORTS) {
      // eslint-disable-next-line no-await-in-loop
      console.log(JSON.stringify(await measureOne(shim, platform, url, vp, headed)));
    }
  } finally {
    await ctx.close();
  }
} else {
  const browser = await chromium.launch({ headless: !headed });
  try {
    for (const vp of VIEWPORTS) {
      // eslint-disable-next-line no-await-in-loop
      console.log(JSON.stringify(await measureOne(browser, platform, url, vp, headed)));
    }
  } finally {
    await browser.close();
  }
}
