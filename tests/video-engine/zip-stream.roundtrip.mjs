// tests/video-engine/zip-stream.roundtrip.mjs
//
// GUARD for src/lib/video-engine/zip-stream.ts.
//
// The "Download all" route emits a ZIP written by hand, byte by byte. A wrong
// offset in the central directory or a mis-ordered data descriptor produces a
// file that downloads perfectly and then refuses to open — the failure lands on
// the user, days later, with no error anywhere in our logs. So the archive is
// verified by a decoder we did not write: Python's `zipfile`, which enforces
// CRCs and central-directory consistency and will refuse a malformed archive.
//
// Run: node tests/video-engine/zip-stream.roundtrip.mjs
// Requires: python3 on PATH (used only as an independent ZIP decoder).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = join(process.cwd(), 'src', 'lib', 'video-engine', 'zip-stream.ts');
const { buildZipStream, safeEntryName } = await import(pathToFileURL(modulePath).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── Fixtures ────────────────────────────────────────────────────────────────
// Sizes deliberately straddle a chunk boundary and include an empty entry and a
// non-ASCII name, because those are the three cases a naive writer gets wrong.
const enc = new TextEncoder();
const bigBody = new Uint8Array(300_000);
for (let i = 0; i < bigBody.length; i += 1) bigBody[i] = (i * 31 + 7) & 0xff;

const fixtures = [
  { name: 'clip-1.mp4', bytes: enc.encode('the first clip, small but real') },
  { name: 'clip-2-big.mp4', bytes: bigBody },
  { name: 'clip-3-empty.mp4', bytes: new Uint8Array(0) },
  { name: 'clip-4-ünïcodé-名前.mp4', bytes: enc.encode('non-ascii entry name') },
];

/** Emits the body in several chunks, so the CRC and size accumulate across
 *  reads the way a real network body does rather than arriving whole. */
function chunkedStream(bytes, chunkSize = 64 * 1024) {
  let cursor = 0;
  return new ReadableStream({
    pull(controller) {
      if (cursor >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(cursor, cursor + chunkSize));
      cursor += chunkSize;
    },
  });
}

const skipped = [];
const entries = [
  ...fixtures.map((f) => ({ name: f.name, open: async () => chunkedStream(f.bytes) })),
  // An entry whose object has already been swept. It must be skipped, and the
  // archive around it must stay valid — that is the whole point of the design.
  { name: 'clip-5-missing.mp4', open: async () => null },
  { name: 'clip-6-throws.mp4', open: async () => { throw new Error('storage 404'); } },
];

const stream = buildZipStream(entries, {
  modifiedAt: new Date('2026-08-25T14:30:00Z'),
  onSkip: (name, reason) => skipped.push(`${name}:${reason}`),
});

const chunks = [];
const reader = stream.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(Buffer.from(value));
}
const archive = Buffer.concat(chunks);

const dir = mkdtempSync(join(tmpdir(), 'zipguard-'));
const zipPath = join(dir, 'clips.zip');
writeFileSync(zipPath, archive);

try {
  check('archive is non-empty', archive.length > 300_000, `${archive.length} bytes`);
  check('unreadable entries were skipped, not fatal', skipped.length === 2, skipped.join(', '));

  // ── The real assertion: an independent decoder accepts it ─────────────────
  const py = spawnSync(
    'python',
    [
      '-c',
      [
        'import json,sys,zipfile',
        'z=zipfile.ZipFile(sys.argv[1])',
        // testzip() recomputes every CRC and returns the first bad name.
        'bad=z.testzip()',
        'out={"bad":bad,"names":z.namelist(),"sizes":{i.filename:i.file_size for i in z.infolist()}}',
        'out["sha"]={n:__import__("hashlib").sha256(z.read(n)).hexdigest() for n in z.namelist()}',
        'print(json.dumps(out))',
      ].join('\n'),
      zipPath,
    ],
    { encoding: 'utf8' },
  );

  if (py.status !== 0) {
    check('python zipfile opens the archive', false, (py.stderr || '').trim().split('\n').pop());
  } else {
    const report = JSON.parse(py.stdout);

    check('every CRC verifies', report.bad === null, report.bad ? `corrupt entry: ${report.bad}` : '');
    check(
      'entry list matches what was written',
      JSON.stringify(report.names) === JSON.stringify(fixtures.map((f) => f.name)),
      report.names.join(', '),
    );

    for (const fixture of fixtures) {
      const expected = createHashHex(fixture.bytes);
      check(
        `"${fixture.name}" round-trips byte-for-byte`,
        report.sha[fixture.name] === expected,
        report.sizes[fixture.name] === fixture.bytes.length ? '' : `size ${report.sizes[fixture.name]} != ${fixture.bytes.length}`,
      );
    }
  }

  // ── safeEntryName ─────────────────────────────────────────────────────────
  check('traversal is neutralised', !safeEntryName('../../etc/passwd', 'x').includes('..'), safeEntryName('../../etc/passwd', 'x'));
  check('separators are neutralised', !/[\\/]/.test(safeEntryName('a/b\\c', 'x')), safeEntryName('a/b\\c', 'x'));
  check('control characters are stripped', safeEntryName(`a${String.fromCharCode(0)}b${String.fromCharCode(31)}c`, 'x') === 'abc');
  check('empty input falls back', safeEntryName('   ', 'fallback.mp4') === 'fallback.mp4');
  check('non-ascii survives', safeEntryName('名前.mp4', 'x') === '名前.mp4');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function createHashHex(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

console.log(failures === 0 ? '\nzip-stream: OK' : `\nzip-stream: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
