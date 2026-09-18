#!/usr/bin/env node
/**
 * check-legal-pages.cjs — the guard on the five published legal documents.
 *
 * These pages are the URLs pasted into Meta, TikTok, LinkedIn and Google
 * platform applications, and the contract every user agrees to at signup. Three
 * things can silently break them, and all three have precedent in this repo:
 *
 *   1. A template placeholder ships. The source drafts carried
 *      "{{EFFECTIVE_DATE}}", "[RC NUMBER]", "[HOSTING REGION]", "⟨PENDING⟩" and
 *      a "DO NOT PUBLISH" banner. One of those reaching production reads as an
 *      unfinished document to a reviewer, and as a misstatement to a regulator.
 *   2. A cross-reference dies. These documents incorporate each other by
 *      reference — the Terms are not complete without the Acceptable Use Policy
 *      resolving. A renamed route turns a binding incorporation into a 404.
 *   3. The signup link regresses. Register.jsx made every user agree to a
 *      Terms of Service behind href="#" for months. That is the defect class
 *      this whole repo is built to detect: working-looking UI wired to nothing.
 *
 * Usage: node scripts/check-legal-pages.cjs
 * Exit 0 = all assertions hold. Exit 1 = at least one failed.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEGAL_SRC = path.join(ROOT, "src", "pages", "Legal");
const LEGAL_ROUTES = path.join(ROOT, "app", "(legal)");
const REGISTER = path.join(ROOT, "src", "pages", "Auth", "Register.jsx");
const LANDING = path.join(ROOT, "src", "pages", "Landing", "LandingPage.jsx");
const AUTH_LAYOUT = path.join(ROOT, "src", "layouts", "AuthLayout.jsx");
const AVATAR_MENU = path.join(ROOT, "src", "ui-v2", "shell", "AvatarMenu.jsx");
const SETTINGS_PRIVACY = path.join(ROOT, "src", "pages", "Settings", "DataPrivacyTab.jsx");
const CATCH_ALL = path.join(ROOT, "app", "[...path]");
const NOT_FOUND = path.join(ROOT, "app", "not-found.jsx");
const LEGAL_HUB = path.join(ROOT, "app", "(legal)", "legal", "page.jsx");

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/* ── The registry ─────────────────────────────────────────────────────────── */

/**
 * legalDocs.js is an ES module and this is CommonJS, so the slugs are read out
 * of the source rather than imported. A regex is enough for a flat list of
 * string literals, and it keeps the guard free of a build step — a guard that
 * needs tooling to run is a guard that stops running.
 */
function readSlugs() {
  const source = read(path.join(LEGAL_SRC, "legalDocs.js"));
  const slugs = [...source.matchAll(/^\s{4}slug:\s*"([a-z0-9-]+)",/gm)].map((m) => m[1]);

  if (slugs.length === 0) {
    fail("legalDocs.js: could not parse any slugs out of LEGAL_DOCS.");
  }

  return slugs;
}

const SLUGS = readSlugs();

/* ── 1. Every registered document has a route, and every route is registered ── */

function checkRoutesExist() {
  for (const slug of SLUGS) {
    const page = path.join(LEGAL_ROUTES, slug, "page.jsx");
    if (!fs.existsSync(page)) {
      fail(`Missing route: LEGAL_DOCS lists "${slug}" but ${rel(page)} does not exist.`);
    }
  }

  if (!fs.existsSync(LEGAL_ROUTES)) {
    fail(`Missing route group: ${rel(LEGAL_ROUTES)} does not exist.`);
    return;
  }

  const routeDirs = fs
    .readdirSync(LEGAL_ROUTES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const dir of routeDirs) {
    // "legal" is the hub index, not a document. It has no LEGAL_DOCS entry by
    // design — it is checked separately by checkLegalHub().
    if (dir === "legal") continue;
    if (!SLUGS.includes(dir)) {
      fail(
        `Unregistered route: app/(legal)/${dir}/ exists but "${dir}" is not in LEGAL_DOCS. ` +
          `Add it to the registry so it appears in the cross-links, the sitemap, and this guard.`,
      );
    }
  }
}

/* ── 2. No placeholder, draft banner, or mojibake reaches production ──────── */

const FORBIDDEN = [
  { pattern: /\{\{[A-Z_]+\}\}/, label: "an unresolved {{TEMPLATE}} placeholder" },
  { pattern: /\[RC NUMBER\]/i, label: 'the "[RC NUMBER]" placeholder' },
  { pattern: /\[HOSTING REGION\]/i, label: 'the "[HOSTING REGION]" placeholder' },
  { pattern: /⟨PENDING⟩/, label: 'the "⟨PENDING⟩" placeholder' },
  // Case-SENSITIVE, deliberately. The draft banner shouts: "Status: DRAFT —
  // NOT LEGALLY REVIEWED. DO NOT PUBLISH." Matching case-insensitively also
  // catches "Do not publish it." — which is real policy text in Terms 9.4 and
  // Acceptable Use 3.1, telling a user not to publish an accidental likeness.
  // Banning that sentence would be the guard editing the law it protects.
  { pattern: /DO NOT PUBLISH/, label: 'a "DO NOT PUBLISH" banner' },
  { pattern: /NOT LEGALLY REVIEWED/, label: 'a "NOT LEGALLY REVIEWED" banner' },
  { pattern: /Status:\s*DRAFT/i, label: 'a "Status: DRAFT" banner' },
  { pattern: /Draft for legal review/i, label: 'a "Draft for legal review" badge' },
  // Double-encoded UTF-8 from the source .dc.html files. "â€" covers the em
  // dash and both curly quotes; "Â·" the middot; "ï¿½" the replacement char.
  { pattern: /â€|Â·|ï¿½/, label: "mojibake (double-encoded UTF-8)" },
];

/**
 * Only the rendered text is checked, not the file comments — the comments in
 * these components legitimately name the placeholders they removed, and a guard
 * that cannot tell the difference would force those explanations out of the
 * code. Block comments and full-line `//` comments are stripped first.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function checkNoPlaceholders() {
  const files = [
    ...fs.readdirSync(LEGAL_SRC).map((name) => path.join(LEGAL_SRC, name)),
    ...SLUGS.map((slug) => path.join(LEGAL_ROUTES, slug, "page.jsx")),
  ].filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());

  for (const file of files) {
    const body = stripComments(read(file));

    for (const { pattern, label } of FORBIDDEN) {
      const match = body.match(pattern);
      if (match) {
        const line = body.slice(0, match.index).split("\n").length;
        fail(`${rel(file)}: rendered text contains ${label} — found ${JSON.stringify(match[0])}.`);
        void line;
      }
    }
  }
}

/* ── 3. Every internal link in a legal document resolves ─────────────────── */

/**
 * Routes outside the legal set that the documents are allowed to link to.
 * Anything else must be a registered legal slug, or it is a dead incorporation
 * by reference.
 */
const ALLOWED_EXTERNAL_ROUTES = new Set(["/", "/legal"]);

function checkCrossLinks() {
  const componentFiles = fs
    .readdirSync(LEGAL_SRC)
    .filter((name) => name.endsWith(".jsx"))
    .map((name) => path.join(LEGAL_SRC, name));

  for (const file of componentFiles) {
    const body = stripComments(read(file));

    // <Link href="/terms#ai-output"> and href="/privacy" alike.
    for (const match of body.matchAll(/href=\{?["'`](\/[^"'`\s{}]*)["'`]/g)) {
      const target = match[1];
      const [routePart] = target.split("#");
      const normalised = routePart === "" ? "/" : routePart.replace(/\/$/, "") || "/";

      if (ALLOWED_EXTERNAL_ROUTES.has(normalised)) continue;

      const slug = normalised.replace(/^\//, "");
      if (!SLUGS.includes(slug)) {
        fail(
          `${rel(file)}: links to "${target}", which is neither a registered legal document ` +
            `nor an allowed route. A dead cross-reference breaks an incorporation by reference.`,
        );
      }
    }
  }
}

/* ── 4. Anchors referenced with a fragment actually exist on the target ──── */

function collectAnchorIds(slug) {
  const componentFiles = fs
    .readdirSync(LEGAL_SRC)
    .filter((name) => name.endsWith(".jsx"))
    .map((name) => path.join(LEGAL_SRC, name));

  const ids = new Set();

  for (const file of componentFiles) {
    const body = read(file);
    // The component that owns a slug is the one whose LegalShell declares it.
    if (!new RegExp(`slug=["']${slug}["']`).test(body)) continue;
    for (const match of body.matchAll(/\bid="([a-z0-9-]+)"/g)) {
      ids.add(match[1]);
    }
  }

  return ids;
}

function checkFragments() {
  const componentFiles = fs
    .readdirSync(LEGAL_SRC)
    .filter((name) => name.endsWith(".jsx"))
    .map((name) => path.join(LEGAL_SRC, name));

  const anchorCache = new Map();

  for (const file of componentFiles) {
    const body = stripComments(read(file));

    for (const match of body.matchAll(/href=\{?["'`](\/[a-z0-9-]+)#([a-z0-9-]+)["'`]/g)) {
      const slug = match[1].replace(/^\//, "");
      const fragment = match[2];

      if (!SLUGS.includes(slug)) continue; // already reported by checkCrossLinks

      if (!anchorCache.has(slug)) anchorCache.set(slug, collectAnchorIds(slug));
      const ids = anchorCache.get(slug);

      if (!ids.has(fragment)) {
        fail(
          `${rel(file)}: links to "/${slug}#${fragment}", but no element with ` +
            `id="${fragment}" exists on that page. The link will land at the top instead ` +
            `of the clause it cites.`,
        );
      }
    }
  }
}

/* ── 5. The signup form links to the real documents ──────────────────────── */

function checkSignupLinks() {
  if (!fs.existsSync(REGISTER)) {
    fail(`Missing file: ${rel(REGISTER)}.`);
    return;
  }

  const body = read(REGISTER);
  const termsBlock = body.match(/className="auth-terms"[\s\S]{0,900}?<\/p>/);

  if (!termsBlock) {
    fail(
      `${rel(REGISTER)}: the "auth-terms" agreement paragraph is gone. ` +
        `Every user agrees to the Terms there; it must link to them.`,
    );
    return;
  }

  const block = termsBlock[0];

  if (/href=["']#["']/.test(block)) {
    fail(
      `${rel(REGISTER)}: the signup agreement paragraph still contains href="#". ` +
        `Users are being made to agree to a contract the form will not show them.`,
    );
  }

  for (const required of ["/terms", "/privacy"]) {
    if (!block.includes(`href="${required}"`)) {
      fail(`${rel(REGISTER)}: the signup agreement paragraph does not link to "${required}".`);
    }
  }
}

/* ── 6. The public site footer exposes the documents ─────────────────────── */

function checkFooterLinks() {
  if (!fs.existsSync(LANDING)) {
    fail(`Missing file: ${rel(LANDING)}.`);
    return;
  }

  const body = read(LANDING);

  for (const slug of SLUGS) {
    if (!body.includes(`href="/${slug}"`)) {
      fail(
        `${rel(LANDING)}: the footer does not link to "/${slug}". ` +
          `Every published legal document must be reachable from the public site.`,
      );
    }
  }
}

/* ── 7. The hub exists and is built from the registry ────────────────────── */

function checkLegalHub() {
  if (!fs.existsSync(LEGAL_HUB)) {
    fail(
      `Missing hub: ${rel(LEGAL_HUB)} does not exist. /legal is the single URL ` +
        `given to platform forms that ask for one policies link, and the only ` +
        `legal target in the signed-in app's account menu.`,
    );
    return;
  }

  const index = path.join(LEGAL_SRC, "LegalIndex.jsx");
  if (!fs.existsSync(index)) {
    fail(`Missing component: ${rel(index)}.`);
    return;
  }

  // The hub must ENUMERATE the registry, not hand-list documents. A hand-listed
  // hub is the thing that silently omits the sixth document.
  //
  // Both the import AND a use are required. Checking only for the string
  // "LEGAL_DOCS" passes a file that dropped the import but left a dead
  // reference behind — which is exactly what a first draft of this check did.
  const body = read(index);
  const importsRegistry = /import\s*\{[^}]*LEGAL_DOCS[^}]*\}\s*from\s*["']\.\/legalDocs["']/.test(body);
  const iteratesRegistry = /LEGAL_DOCS\s*\.\s*(filter|map|forEach|slice)\s*\(/.test(body);

  if (!importsRegistry || !iteratesRegistry) {
    fail(
      `${rel(index)}: must import LEGAL_DOCS from ./legalDocs and iterate it. ` +
        `A hand-listed hub is how a newly registered document silently fails to ` +
        `appear on the one URL given to platform review forms.`,
    );
  }
}

/* ── 8. The 404 route returns a real 404 ─────────────────────────────────── */

function checkNotFoundStatus() {
  if (fs.existsSync(CATCH_ALL)) {
    fail(
      `app/[...path]/ is back. A catch-all segment matches every unknown URL, so ` +
        `Next answers HTTP 200 with the not-found page in the body — a soft 404. ` +
        `Before this was removed, /terms returned 200 while rendering "page not ` +
        `found", which passes an automated platform-review URL check and then ` +
        `fails the human who opens it. Use app/not-found.jsx instead.`,
    );
  }

  if (!fs.existsSync(NOT_FOUND)) {
    fail(
      `Missing ${rel(NOT_FOUND)}. Without it there is no 404 route at all, and ` +
        `unknown URLs fall back to the framework default.`,
    );
  }
}

/* ── 9. The signed-in app can reach the documents ────────────────────────── */

function checkInAppReachability() {
  const targets = [
    {
      file: SETTINGS_PRIVACY,
      // Privacy 8.2 sends users to this exact screen, so it must enumerate the
      // registry rather than link a favourite two.
      requires: ["LEGAL_DOCS"],
      why:
        'Settings -> Data and Privacy is where Privacy 8.2 tells users to go. It must list every registered document.',
    },
    {
      file: AVATAR_MENU,
      requires: ['"/legal"'],
      why:
        "The account menu is the only legal route available from most signed-in screens.",
    },
    {
      file: AUTH_LAYOUT,
      requires: ['"/terms"', '"/privacy"'],
      why:
        "Login, forgot-password and reset-password screens reach the documents only through the shared auth layout.",
    },
  ];

  for (const target of targets) {
    if (!fs.existsSync(target.file)) {
      fail(`Missing file: ${rel(target.file)}.`);
      continue;
    }

    const body = read(target.file);
    for (const needle of target.requires) {
      if (!body.includes(needle)) {
        fail(`${rel(target.file)}: no reference to ${needle}. ${target.why}`);
      }
    }
  }
}

/* ── 10. The RENDERED pages, when a build exists ─────────────────────────── */

/**
 * Everything above reads source. Some defects only exist after JSX is
 * evaluated, and this check exists because one of them shipped:
 *
 *   <a href="mailto:x">x</a> from the email address on
 *   the account and ask us to delete it.
 *
 * rendered as "...brandosse.comfrom the email address". JSX dropped the space.
 * An identically shaped line in the Terms rendered correctly, so there is no
 * source pattern to grep for — the only place the bug is visible is the HTML.
 *
 * It also re-runs the placeholder and mojibake patterns against the rendered
 * output, which is strictly stronger than running them against source: a
 * placeholder introduced through a variable, an import, or a data file would
 * pass the source scan and fail here.
 *
 * Skips quietly when there is no build (the hermetic CI job and most local
 * runs). Pass --require-build to make a missing build a failure; CI does that
 * in the build job, after `next build`, where the HTML must exist.
 */
function checkRenderedPages(requireBuild) {
  const buildDir = path.join(ROOT, ".next", "server", "app");
  // Next strips the (legal) route group from the output path, so the files
  // land as .next/server/app/<slug>.html.
  const pages = [...SLUGS, "legal"].map((slug) => ({
    slug,
    file: path.join(buildDir, `${slug}.html`),
  }));

  const present = pages.filter((page) => fs.existsSync(page.file));

  if (present.length === 0) {
    if (requireBuild) {
      fail(
        "--require-build was passed but no prerendered legal HTML was found under " +
          ".next/server/app/. Run `npm run build:next` first, or drop the flag.",
      );
    }
    return { skipped: true };
  }

  if (requireBuild && present.length !== pages.length) {
    const missing = pages.filter((page) => !fs.existsSync(page.file)).map((page) => page.slug);
    fail(
      `Prerendered HTML missing for: ${missing.join(", ")}. Every legal page must be ` +
        `statically prerendered — a platform reviewer must get the document on first byte.`,
    );
  }

  for (const page of present) {
    const html = read(page.file);

    // Text glued to the end of a link, e.g. "</a>from".
    for (const match of html.matchAll(/<\/a>([A-Za-z(])/g)) {
      const context = html.slice(Math.max(0, match.index - 70), match.index + 40).replace(/<[^>]+>/g, "");
      fail(
        `/${page.slug}: rendered HTML glues text to the end of a link — ` +
          `"</a>${match[1]}...". JSX dropped a space. Context: ...${context.trim()}...`,
      );
    }

    // Text glued to the start of a link, e.g. "see<a href=".
    for (const match of html.matchAll(/([A-Za-z])<a\s[^>]*href=/g)) {
      const context = html.slice(Math.max(0, match.index - 60), match.index + 60).replace(/<[^>]+>/g, "");
      fail(
        `/${page.slug}: rendered HTML glues text to the start of a link. ` +
          `Context: ...${context.trim()}...`,
      );
    }

    // The placeholder and mojibake patterns, against real output this time.
    for (const { pattern, label } of FORBIDDEN) {
      const match = html.match(pattern);
      if (match) {
        fail(
          `/${page.slug}: RENDERED page contains ${label} — found ${JSON.stringify(match[0])}. ` +
            `This reached the built HTML, not just the source.`,
        );
      }
    }
  }

  return { skipped: false, count: present.length };
}

/* ── 11. The canonical origin cannot become a hosting subdomain ──────────── */

/**
 * Measured on the first production deploy: NEXT_PUBLIC_APP_URL was set in
 * Vercel to https://brandosse1.vercel.app, so every canonical tag, og:url and
 * sitemap entry on the live site pointed at the vercel.app host. Two live
 * hosts serving identical pages, each telling crawlers the other is not the
 * real one — and a reviewer following the canonical from a submitted policy
 * URL lands somewhere that is not the product.
 *
 * The resolution lives in legalMetadata.js and depends on an environment
 * variable, so it cannot be checked by reading the built HTML on a machine
 * that does not have production's env. Instead the guard EVALUATES the real
 * resolution logic out of the source against a table of origins, which is
 * both hermetic and exact: it tests the shipped code, not a copy of it.
 */
function checkCanonicalOrigin() {
  const file = path.join(LEGAL_SRC, "legalMetadata.js");
  if (!fs.existsSync(file)) {
    fail(`Missing file: ${rel(file)}.`);
    return;
  }

  const source = read(file);
  const start = source.indexOf("const RAW_ORIGIN");
  const end = source.indexOf("/** Build the Next.js");

  if (start === -1 || end === -1 || end <= start) {
    fail(
      `${rel(file)}: could not locate the SITE_ORIGIN resolution block. This guard ` +
        `evaluates it directly; if the file was restructured, update the guard too ` +
        `rather than leaving the canonical origin unchecked.`,
    );
    return;
  }

  const body = source.slice(start, end).replace(/^export /gm, "");
  const WWW = "https://www.brandosse.com";

  const cases = [
    ["production", undefined, WWW, "unset falls back to the production origin"],
    ["production", "http://localhost:3000", WWW, "a localhost origin is refused"],
    ["production", "https://brandosse1.vercel.app", WWW, "the vercel.app host is refused"],
    ["production", "https://brandosse-git-abc.vercel.app", WWW, "any vercel preview host is refused"],
    ["production", "https://brandosse.com", WWW, "the apex is normalised up to www"],
    ["production", WWW, WWW, "a correct origin passes through untouched"],
    ["development", "http://localhost:3000", "http://localhost:3000", "development keeps localhost"],
  ];

  for (const [nodeEnv, envValue, expected, label] of cases) {
    let actual;
    try {
      // eslint-disable-next-line no-new-func
      const resolve = new Function("process", `${body}
return SITE_ORIGIN;`);
      actual = resolve({ env: { NEXT_PUBLIC_APP_URL: envValue, NODE_ENV: nodeEnv } });
    } catch (error) {
      fail(`${rel(file)}: evaluating the origin logic threw — ${error.message}`);
      return;
    }

    if (actual !== expected) {
      fail(
        `${rel(file)}: canonical origin wrong — ${label}. ` +
          `NEXT_PUBLIC_APP_URL=${String(envValue)} NODE_ENV=${nodeEnv} ` +
          `resolved to ${actual}, expected ${expected}.`,
      );
    }
  }
}

/* ── 11. YouTube API Services disclosures ────────────────────────────────── */

/**
 * An app using YouTube API Services must disclose that it does, link YouTube's
 * Terms of Service and Google's Privacy Policy, and tell users how to revoke
 * its access. Google checks for these at verification, and an app that loses
 * them can lose its API access — so this is not a documentation nicety, it is
 * the difference between YouTube publishing working and not working.
 *
 * Verified absent on 2026-09-18, months after YouTube publishing shipped:
 * nothing in app/ or src/ mentioned any of the four. Nobody noticed, because
 * their absence breaks nothing until a reviewer looks.
 *
 * The revocation link is checked in the PRODUCT, not only in the policy: a
 * person who wants their access back should find it where the connection
 * lives, not by reading a legal page to the end.
 */
const YOUTUBE_DISCLOSURES = [
  {
    file: path.join(ROOT, "src", "pages", "Legal", "PrivacyPolicy.jsx"),
    label: "the privacy policy",
    required: [
      { needle: "YouTube API Services", what: "the statement that the app uses YouTube API Services" },
      { needle: "youtube.com/t/terms", what: "a link to the YouTube Terms of Service" },
      { needle: "policies.google.com/privacy", what: "a link to the Google Privacy Policy" },
      { needle: "myaccount.google.com/permissions", what: "the link users revoke access with" },
    ],
  },
  {
    file: path.join(ROOT, "src", "pages", "Settings", "components", "ConnectedAccountCard.jsx"),
    label: "the connected-account card",
    required: [
      { needle: "YouTube API Services", what: "the in-product disclosure" },
      { needle: "myaccount.google.com/permissions", what: "the in-product revocation link" },
    ],
  },
];

function checkYouTubeDisclosures() {
  for (const { file, label, required } of YOUTUBE_DISCLOSURES) {
    if (!fs.existsSync(file)) {
      fail(
        `${rel(file)} is missing, so ${label} cannot carry the YouTube API Services ` +
          `disclosures. Repoint this check rather than deleting it.`,
      );
      continue;
    }

    const body = read(file);
    for (const { needle, what } of required) {
      if (!body.includes(needle)) {
        fail(
          `${rel(file)}: ${label} no longer contains ${what} (${needle}). ` +
            `YouTube API Services requires it; losing it risks the app's API access, ` +
            `and publishing to YouTube then stops working for every user.`,
        );
      }
    }
  }
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

checkRoutesExist();
checkNoPlaceholders();
checkCrossLinks();
checkFragments();
checkSignupLinks();
checkFooterLinks();
checkLegalHub();
checkNotFoundStatus();
checkInAppReachability();
checkCanonicalOrigin();
checkYouTubeDisclosures();

const requireBuild = process.argv.includes("--require-build");
const rendered = checkRenderedPages(requireBuild);

if (failures.length > 0) {
  console.error(`\ncheck-legal-pages: ${failures.length} failure(s)\n`);
  for (const message of failures) {
    console.error(`  ✗ ${message}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `check-legal-pages: OK — ${SLUGS.length} documents published, routed and cross-linked; ` +
    `reachable from the public footer, the signup form, the auth layout, the account menu ` +
    `and Settings; hub at /legal; 404s return 404.`,
);
console.log(
  rendered.skipped
    ? "  rendered-HTML checks: skipped (no build found — run after `npm run build:next` to include them)"
    : `  rendered-HTML checks: ${rendered.count} prerendered pages scanned for dropped spaces, placeholders and mojibake`,
);
