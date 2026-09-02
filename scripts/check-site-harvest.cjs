#!/usr/bin/env node
/**
 * check-site-harvest.cjs — the harvester measures what is actually on the page.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * The website import used to hand marketing prose to a language model and ask
 * it for a colour palette. Shown no colours, it produced colours anyway. The
 * whole point of siteHarvest.ts is that a brand's hexes are READ, not guessed —
 * and that claim is worth exactly as much as the test behind it.
 *
 * So the assertions below are all of the form "this fixture contains #0a2540,
 * therefore the harvest must contain #0a2540". Not "a palette was produced".
 *
 * ── Why there is no live fetch here ─────────────────────────────────────────
 * The obvious test — serve a fixture on localhost and harvest it — cannot work,
 * because safeFetch correctly REFUSES loopback addresses. Adding a bypass so the
 * test can run would mean weakening the security control in order to test the
 * feature, which is the wrong trade in an obvious way.
 *
 * The fetch orchestration is thin and is already covered by
 * check-ssrf-blocklist and check-outbound-fetch-guard. Everything with real
 * logic in it — CSS parsing, colour weighting, role inference by contrast
 * arithmetic, structured-data reading, page text extraction — is pure, and that
 * is what is exercised here, against a fixture whose correct answers are known
 * by construction.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();
const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');

// ── The fixture ──────────────────────────────────────────────────────────────
//
// Deliberately awkward in the ways real sites are: colours in three notations,
// rules nested inside @media (which a naive regex parser drops entirely), a
// transparent reset that must NOT be harvested, a framework-ish one-off border
// colour that must be filtered as noise, and a generic font stack whose real
// family is not first.

const FIXTURE_CSS = `
/* a commented-out rule must not be harvested: color: #ff0000; */
:root {
  --brand-navy: #0A2540;
  --brand-coral: rgb(255, 90, 60);
  --paper: #FFFFFF;
  --ink: hsl(210, 12%, 12%);
}
* { border-color: rgba(0, 0, 0, 0); }
body {
  background-color: #FFFFFF;
  color: #1b1f24;
  font-family: "Newsreader", Georgia, serif;
}
h1, h2 {
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  color: #0A2540;
}
.btn-primary {
  background: rgb(255, 90, 60);
  color: #FFFFFF;
}
.hairline { border: 1px solid #e6e4df; }
@media (min-width: 768px) {
  .hero { background-color: #0A2540; }
  .hero__title { color: #FFFFFF; }
}
@font-face {
  font-family: "Bricolage Grotesque";
  src: url('/fonts/bricolage.woff2') format('woff2');
}
.one-off { border-color: #123456; }
/* Native CSS nesting — ships in every browser, emitted by Tailwind/PostCSS.
   The card's OWN colours sit before a nested rule inside the same block. */
.card {
  background-color: #0a2540;
  color: #fdf6e3;
  &:hover { background-color: #ff5a3c; }
}
`;

const FIXTURE_HTML = `<!doctype html>
<html><head>
<title>Oriki Soda Co — Small-batch sodas from Lagos</title>
<meta name="description" content="Small-batch hibiscus and ginger sodas, brewed in Lagos.">
<meta property="og:image" content="/img/og-card.png">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700&family=Newsreader:wght@400&display=swap">
<link rel="stylesheet" href="/assets/site.css">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Oriki Soda Co",
  "legalName": "Oriki Beverages Limited",
  "slogan": "Brewed slow, poured cold",
  "email": "hello@orikisoda.test",
  "telephone": "+234 800 000 0000",
  "logo": { "url": "/img/logo.svg" },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "12 Awolowo Road",
    "addressLocality": "Ikoyi",
    "addressRegion": "Lagos",
    "addressCountry": "NG"
  },
  "sameAs": ["https://instagram.com/orikisoda", "https://x.com/orikisoda"]
}
</script>
</head><body>
<nav><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a></nav>
<header><img src="/img/logo.svg" alt="Oriki Soda logo" class="site-logo"></header>
<h1>Brewed slow, poured cold</h1>
<h2>Hibiscus, ginger, and nothing else</h2>
<p>We brew in small batches in Lagos, with fruit bought the same week it is pressed.</p>
<a href="https://instagram.com/orikisoda">Instagram</a>
<a href="https://x.com/orikisoda">X</a>
<a href="https://twitter.com/intent/tweet?text=share">Share this</a>
<a href="mailto:hello@orikisoda.test">Email us</a>
<a href="tel:+2348000000000">Call us</a>
<footer><a href="/terms">Terms</a></footer>
</body></html>`;

const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
}

function transpileShared() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteharvest-'));
  for (const name of ['safeFetch', 'brandDesign', 'siteHarvest']) {
    const source = fs.readFileSync(path.join(SHARED, `${name}.ts`), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText.replace(/from\s+["']\.\/(\w+)\.ts["']/g, `from './$1.mjs'`);
    const prelude = name === 'safeFetch' ? 'globalThis.Deno = globalThis.Deno ?? {};\n' : '';
    fs.writeFileSync(path.join(dir, `${name}.mjs`), prelude + output, 'utf8');
  }
  return dir;
}

async function main() {
  const dir = transpileShared();
  try {
    const h = await import(pathToFileURL(path.join(dir, 'siteHarvest.mjs')).href);

    // ── CSS rule parsing ─────────────────────────────────────────────────────
    const rules = h.parseCssRules(FIXTURE_CSS);
    assert(
      rules.some((r) => r.selector.trim() === '.hero'),
      'parseCssRules lost a rule nested inside @media.',
    );
    // The discriminating case. The obvious regex parser returns ONE rule whose
    // "selector" is "background-color: #0a2540; color: #fdf6e3; &:hover" — both
    // of the card's real colours reclassified as selector text and never
    // harvested. A brace-depth walk that does not split the prelude at its last
    // semicolon loses them in exactly the same way.
    const card = rules.find((r) => r.selector.trim() === '.card');
    assert(card, 'parseCssRules did not produce a .card rule from natively-nested CSS.');
    assert(
      card && card.declarations.includes('#0a2540') && card.declarations.includes('#fdf6e3'),
      'With native CSS nesting, declarations written before a nested rule were lost — '
      + 'they belong to the parent, not to the nested selector. On a Tailwind/PostCSS '
      + 'stylesheet that is most of the brand palette.',
    );
    assert(
      rules.some((r) => r.selector.includes('&:hover') && r.declarations.includes('#ff5a3c')),
      'The nested &:hover rule and its colour must still be harvested.',
    );
    assert(
      rules.some((r) => /^@font-face$/i.test(r.selector.trim())),
      'parseCssRules dropped the @font-face block, which is the strongest evidence '
      + 'of a brand typeface there is.',
    );
    assert(
      !JSON.stringify(rules).includes('#ff0000'),
      'A commented-out declaration was harvested as a real colour.',
    );

    // ── Colour notation ──────────────────────────────────────────────────────
    assert(h.colorsInValue('#0A2540')[0] === '#0a2540', 'Hex colours must normalise to lowercase.');
    assert(h.colorsInValue('#FFF')[0] === '#ffffff', 'Shorthand hex must expand.');
    assert(h.colorsInValue('rgb(255, 90, 60)')[0] === '#ff5a3c', 'rgb() must convert to hex.');
    assert(h.colorsInValue('hsl(210, 12%, 12%)').length === 1, 'hsl() must be understood.');
    assert(
      h.colorsInValue('rgba(0, 0, 0, 0)').length === 0,
      'A fully transparent colour is a reset, not a brand colour, and must be dropped — '
      + 'it appears in almost every CSS reset and would otherwise outrank real colours.',
    );

    // ── The measured palette ─────────────────────────────────────────────────
    const { palette, fonts } = h.analyseCss(
      [FIXTURE_CSS],
      ['Bricolage Grotesque', 'Newsreader'],
    );
    const hexes = palette.map((c) => c.hex);

    for (const expected of ['#0a2540', '#ff5a3c', '#ffffff']) {
      assert(hexes.includes(expected), `The fixture declares ${expected} but the harvest did not measure it.`);
    }
    assert(
      !hexes.includes('#123456'),
      'A single incidental border colour was kept. One use on one border is framework '
      + 'noise, and letting it in dilutes the real palette.',
    );

    const navy = palette.find((c) => c.hex === '#0a2540');
    assert(navy && navy.fromCustomProperty, '#0a2540 is declared as --brand-navy; that must be recorded.');
    assert(
      navy && navy.sources.some((s) => s.startsWith('--')),
      'The custom-property NAME is the strongest signal of intent and must be retained.',
    );
    assert(
      palette[0].weight >= palette[palette.length - 1].weight,
      'The palette must be ordered by structural weight.',
    );

    // ── Typefaces ────────────────────────────────────────────────────────────
    assert(
      h.firstRealFamily('"Newsreader", Georgia, serif') === 'Newsreader',
      'The first non-generic family must be selected.',
    );
    assert(
      h.firstRealFamily('system-ui, -apple-system, sans-serif') === '',
      'A stack of only generic families names no brand typeface and must yield nothing.',
    );
    assert(
      fonts.display && fonts.display.family === 'Bricolage Grotesque',
      `The display face is used on h1/h2 and declared via @font-face; got ${fonts.display && fonts.display.family}`,
    );
    assert(
      fonts.body && fonts.body.family === 'Newsreader',
      `The body face is declared on body{}; got ${fonts.body && fonts.body.family}`,
    );

    // ── Roles, by arithmetic ─────────────────────────────────────────────────
    const roles = h.inferColorRoles(palette);
    // The fixture uses navy on a hero AND a card, so navy carries more raw
    // weight than white. White is still the answer, because it is the colour set
    // on `body` — the page's actual ground. Weight alone resolves this wrongly
    // and then picks a text colour for a background the reader never sees.
    const white = palette.find((c) => c.hex === '#ffffff');
    assert(white && white.onGroundSelector,
      '#ffffff is body{background-color} and must be flagged as the ground colour.');
    const navyGround = palette.find((c) => c.hex === '#0a2540');
    assert(navyGround && !navyGround.onGroundSelector,
      '#0a2540 is only ever a section background and must NOT be flagged as the ground.');
    assert(navyGround && white && navyGround.weight > white.weight,
      'Fixture precondition: navy must out-weigh white, so this test proves the ground '
      + 'rule beats raw weight rather than agreeing with it by luck.');
    assert(roles.background && roles.background.hex === '#ffffff',
      `background must be the body ground, not the most-used colour; got ${roles.background && roles.background.hex}`);
    assert(roles.text_primary, 'No text colour was resolved.');
    assert(
      roles.text_primary && roles.text_primary.contrast_vs_background >= 4.5,
      'A text role was assigned that fails WCAG AA against its own background. '
      + 'Contrast is the one thing here that is arithmetic, so there is no excuse for it.',
    );
    assert(roles.accent && roles.accent.hex === '#ff5a3c',
      `The coral is the only saturated colour and must be the accent; got ${roles.accent && roles.accent.hex}`);
    assert(roles.cta_text && ['#ffffff', '#111111'].includes(roles.cta_text.hex),
      'cta_text must be resolved to whichever of black/white is legible on the button.');
    assert(roles.cta_text && roles.cta_text.source === 'inferred',
      'cta_text is derived from the accent, not read off the site, and must be labelled inferred.');
    for (const [name, role] of Object.entries(roles)) {
      if (name === 'cta_text') continue;
      assert(role.source === 'measured', `Role ${name} came from the CSS and must be labelled measured.`);
    }

    // ── The chowdeck.com case: heavy use is not evidence of being the ground ──
    //
    // Reproduced from a real harvest on 2026-09-02. The site declares #000000
    // as a custom property and paints it on borders, and never declares a page
    // background in any stylesheet we can attribute. Black therefore carried
    // more raw weight than anything else and took the background role — on a
    // light site — and was labelled "measured" while being a guess.
    // Shaped from the REAL chowdeck.com stylesheets (165KB, measured 2026-09-02):
    //   #000000  weight 74  backgroundWeight  9   <- mostly borders and shadows
    //   #ffffff  weight 46  backgroundWeight 18   <- the actual page ground
    // Both appear on `background-color` somewhere, so a boolean "is it ever a
    // background?" tiebreak TIES and raw weight decides — which is how black won
    // the background role on a light site. Only comparing how MUCH of the weight
    // is background evidence separates them.
    const CHOWDECK_LIKE = `
      :root { --color-black: #000000; --color-white: #ffffff; --brand-green: #0c513f; }
      .divider { border-color: #000000; }
      .rule { border-color: #000000; }
      .edge { border-color: #000000; }
      .hr { border-color: #000000; }
      .line { border-color: #000000; }
      .sep { border-color: #000000; }
      .frame { border-color: #000000; }
      .outline { border-color: #000000; }
      .chip { background-color: #000000; }
      .sheet { background-color: #ffffff; }
      .modal { background-color: #ffffff; }
      .label { color: #ffffff; }
      .panel { background-color: #0c513f; }
    `;
    const chow = h.analyseCss([CHOWDECK_LIKE], []);
    const chowRoles = h.inferColorRoles(chow.palette);

    const black = chow.palette.find((c) => c.hex === '#000000');
    const chowWhite = chow.palette.find((c) => c.hex === '#ffffff');
    assert(
      black && chowWhite && black.weight > chowWhite.weight,
      `Fixture precondition: black raw weight (${black && black.weight}) must exceed white `
      + `(${chowWhite && chowWhite.weight}), or this does not reproduce the real case.`,
    );
    assert(
      black && chowWhite && black.backgroundWeight > 0 && chowWhite.backgroundWeight > black.backgroundWeight,
      'Fixture precondition: both colours must appear on a background (so a boolean tiebreak ties), '
      + `with white carrying more; got black bgW=${black && black.backgroundWeight}, `
      + `white bgW=${chowWhite && chowWhite.backgroundWeight}.`,
    );
    assert(
      chowRoles.background?.hex === '#ffffff',
      `The page ground should be the colour with the most BACKGROUND evidence (#ffffff), not the `
      + `one with the most raw usage; got ${chowRoles.background?.hex}.`,
    );
    // The actual regression: black took the background role on a light site
    // purely because borders gave it the most raw weight.
    assert(
      chowRoles.background?.hex !== '#000000',
      'The most heavily USED colour took the background role instead of the most heavily used '
      + 'AS A BACKGROUND. On the real site that put black on a light page.',
    );
    assert(
      chowRoles.background?.source === 'inferred',
      'When no stylesheet declares a page background, the background role is a GUESS and must be '
      + `labelled "inferred". Got "${chowRoles.background?.source}" — that puts a fabricated fact `
      + 'in the brand kit, which is the failure this whole module exists to prevent.',
    );

    const chowNotes = [];
    h.inferColorRoles(chow.palette, chowNotes);
    assert(
      chowNotes.some((note) => /best guess at the ground/i.test(note)),
      'Guessing the page background must produce a note. A silent guess is indistinguishable '
      + 'from a measurement.',
    );

    // ── Structured data ──────────────────────────────────────────────────────
    const byUrl = new Map([['https://orikisoda.test/', FIXTURE_HTML]]);
    const org = h.readJsonLdOrganization(byUrl);
    assert(org.name === 'Oriki Soda Co', `JSON-LD name not read; got ${org.name}`);
    assert(org.legalName === 'Oriki Beverages Limited', 'JSON-LD legalName not read.');
    assert(org.slogan === 'Brewed slow, poured cold', 'JSON-LD slogan not read.');
    assert(
      org.address === '12 Awolowo Road, Ikoyi, Lagos, NG',
      `Nested PostalAddress must be flattened in order; got ${org.address}`,
    );

    const social = h.readSocialHandles(byUrl);
    assert(social.instagram === 'orikisoda', `Instagram handle not read; got ${social.instagram}`);
    assert(social.x === 'orikisoda', `X handle not read; got ${social.x}`);
    assert(
      h.socialHandleFrom('https://twitter.com/intent/tweet?text=share') === null,
      'A share/intent link is a button, not the brand\'s handle, and must be rejected.',
    );

    // ── Page reading ─────────────────────────────────────────────────────────
    const page = h.readPage(FIXTURE_HTML, 'https://orikisoda.test/');
    assert(page.title.startsWith('Oriki Soda Co'), 'Title not read.');
    assert(page.metaDescription.includes('hibiscus'), 'Meta description not read.');
    assert(page.headings.some((x) => x.startsWith('H1: Brewed slow')), 'H1 not captured in order.');
    assert(page.text.includes('small batches in Lagos'), 'Body prose not captured.');
    assert(
      !page.text.includes('Privacy') && !page.text.includes('Terms'),
      'Nav and footer chrome leaked into the page text. Repeated on every page, it '
      + 'would dominate a multi-page harvest with menu labels.',
    );

    // ── Page selection ───────────────────────────────────────────────────────
    // (scoreCandidate is exercised through the exported behaviour it drives.)
    assert(
      h.detectAlpha(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/svg+xml') === true,
      'SVG marks are transparent by nature.',
    );
    assert(h.detectAlpha(new Uint8Array(30), 'image/jpeg') === false, 'JPEG has no alpha channel.');

    // ── The evidence document ────────────────────────────────────────────────
    const evidence = h.buildEvidenceDocument({
      siteUrl: 'https://orikisoda.test/',
      pagesHarvested: ['https://orikisoda.test/'],
      measuredPalette: palette,
      measuredFonts: fonts,
      colorRoles: roles,
      organization: org,
      contact: { email: 'hello@orikisoda.test', phone: '', address: '', website: 'https://orikisoda.test' },
      socialHandles: social,
      logoCandidates: [],
      pages: [page],
      notes: [],
      evidenceDocument: '',
    });

    assert(
      /Reproduce every measured value EXACTLY/i.test(evidence),
      'The evidence document must instruct the model never to substitute a measured value. '
      + 'Without that line the model treats a measured hex as a suggestion.',
    );
    assert(evidence.includes('#0a2540') && evidence.includes('#ff5a3c'),
      'Measured hexes must appear verbatim in the document handed to the model.');
    assert(evidence.includes('MEASURED COLOURS'), 'Measured sections must be labelled as measured.');
    assert(evidence.includes('Bricolage Grotesque'), 'Measured typefaces must reach the model.');
    assert(evidence.length <= 24_000,
      `The evidence document must stay within the extractor's budget; got ${evidence.length} chars. `
      + 'Overrunning it is how the 2026-08-19 truncation incident silently dropped fields.');

    // ── Degradation must be visible ──────────────────────────────────────────
    const empty = h.analyseCss([], []);
    assert(empty.palette.length === 0, 'No CSS must mean no measured palette — never a fallback guess.');
    assert(Object.keys(h.inferColorRoles([])).length === 0,
      'No palette must mean no roles. Inventing a role here would be fabricated data.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-site-harvest FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    '\x1b[32m✔ check-site-harvest\x1b[0m  fixture site measured correctly: exact hexes, ' +
    'both typefaces, roles by contrast arithmetic, structured data, and a labelled evidence document.',
  );
}

main().catch((err) => {
  console.error('✖ check-site-harvest crashed:', err);
  process.exit(1);
});
