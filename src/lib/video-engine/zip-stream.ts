// src/lib/video-engine/zip-stream.ts
// A minimal streaming ZIP writer. No dependency, no compression, no buffering.
//
// ── Why hand-rolled ─────────────────────────────────────────────────────────
// "Download all" needs one file. The alternatives were a new dependency (the
// project is under a completion lockdown, so adding one needs justifying) or
// firing N sequential browser downloads, which popup blockers interrupt after
// the first two or three. A ZIP container is ~200 lines of well-specified
// binary layout, so it is written here rather than pulled in.
//
// ── Why STORE and not DEFLATE ───────────────────────────────────────────────
// The payload is H.264 MP4. It is already compressed; DEFLATE over it costs CPU
// on every byte and typically saves under 1%. STORE means the bytes pass
// through untouched, so this route's CPU cost stays flat no matter how large
// the clips are.
//
// ── Why data descriptors ────────────────────────────────────────────────────
// A local file header must carry the CRC and the size, and neither is known
// until the last byte has gone past. The alternative is buffering each entry in
// memory to compute them first — seven clips at 15MB is 105MB of heap on a
// serverless function, which is how this route would die in production. Setting
// bit 3 of the general-purpose flag moves CRC and sizes into a descriptor
// AFTER the data, so nothing is ever held.
//
// ── Why an async generator behind the stream ────────────────────────────────
// Doing the whole archive inside one `pull()` would enqueue every chunk before
// the consumer read any of them — the queue becomes the buffer this design
// exists to avoid. Yielding one chunk per `pull()` gives real backpressure: the
// upstream clip body is only read as fast as the client drains it.
//
// ── Deliberate limits ───────────────────────────────────────────────────────
// No ZIP64. Entries and archives above 4GB are not representable here. A job
// caps at ~15 clips of ~15MB, so the ceiling is roughly two orders of magnitude
// away; the writer throws rather than silently emitting a corrupt archive if
// that ever stops being true.

const LOCAL_HEADER_SIG = 0x04034b50;
const DATA_DESCRIPTOR_SIG = 0x08074b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** bit 3 — sizes and CRC follow the data; bit 11 — the filename is UTF-8. */
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const FLAGS = FLAG_DATA_DESCRIPTOR | FLAG_UTF8;

const METHOD_STORE = 0;
const VERSION_NEEDED = 20;
const MAX_UINT32 = 0xffffffff;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** Running CRC-32, fed one chunk at a time. Seeded and finalised with the
 *  standard 0xFFFFFFFF inversion. */
class Crc32 {
  private value = 0xffffffff;

  update(chunk: Uint8Array): void {
    const table = getCrcTable();
    let crc = this.value;
    for (let i = 0; i < chunk.length; i += 1) {
      crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
    this.value = crc >>> 0;
  }

  digest(): number {
    return (this.value ^ 0xffffffff) >>> 0;
  }
}

class ByteWriter {
  private readonly bytes: number[] = [];

  u16(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    return this;
  }

  raw(value: Uint8Array): this {
    for (let i = 0; i < value.length; i += 1) this.bytes.push(value[i]);
    return this;
  }

  done(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/** MS-DOS packed date and time. Two-second resolution, 1980 epoch — a format
 *  constraint of the container, not a rounding choice made here. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Make an entry name safe inside an archive.
 *
 * Path separators, traversal segments, and control characters are removed - a
 * ZIP entry named `../../x` is the Zip Slip vulnerability, and these names are
 * derived from AI-generated clip titles, which are user-influenced input.
 *
 * Control characters are filtered by code point rather than by a regex class.
 * A literal C0 range inside a source file is fragile - it makes the file
 * non-text, and any tool that rewrites the file can silently eat the range and
 * leave a regex that matches nothing. This cannot be quietly broken that way.
 */
export function safeEntryName(raw: string, fallback: string): string {
  const withoutControls = Array.from(String(raw ?? ''))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');

  const cleaned = withoutControls
    .replace(/[\\/]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();

  return cleaned || fallback;
}

export type ZipEntry = {
  /** Name inside the archive. Pass it through safeEntryName first. */
  name: string;
  /** Opens the bytes for this entry. Called lazily, one entry at a time, so a
   *  ten-clip archive never has more than one upstream response in flight. */
  open: () => Promise<ReadableStream<Uint8Array> | null>;
};

type CentralRecord = {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

export type ZipOptions = {
  modifiedAt?: Date;
  /** Called for each entry that could not be read. One swept clip should not
   *  cost the user the other six, so a failed entry is skipped, not fatal. */
  onSkip?: (name: string, reason: string) => void;
};

async function* generateZip(entries: ZipEntry[], options: ZipOptions): AsyncGenerator<Uint8Array> {
  const modifiedAt = options.modifiedAt ?? new Date();
  const { time, date } = dosDateTime(modifiedAt);
  const encoder = new TextEncoder();

  let offset = 0;
  const central: CentralRecord[] = [];

  /** Every yield goes through here so `offset` can never drift from what was
   *  actually written — the central directory's correctness depends on it. */
  function advance(chunk: Uint8Array): Uint8Array {
    offset += chunk.length;
    if (offset > MAX_UINT32) {
      // Refuse rather than emit an archive whose central directory offsets have
      // silently wrapped. A corrupt 4GB download is worse than a clear failure.
      throw new Error('Archive exceeds the 4GB ZIP32 limit.');
    }
    return chunk;
  }

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);

    let source: ReadableStream<Uint8Array> | null = null;
    try {
      source = await entry.open();
    } catch (error) {
      options.onSkip?.(entry.name, error instanceof Error ? error.message : 'unreadable');
      continue;
    }
    if (!source) {
      options.onSkip?.(entry.name, 'not available');
      continue;
    }

    const localOffset = offset;

    yield advance(
      new ByteWriter()
        .u32(LOCAL_HEADER_SIG)
        .u16(VERSION_NEEDED)
        .u16(FLAGS)
        .u16(METHOD_STORE)
        .u16(time)
        .u16(date)
        .u32(0) // crc — in the descriptor
        .u32(0) // compressed size — in the descriptor
        .u32(0) // uncompressed size — in the descriptor
        .u16(nameBytes.length)
        .u16(0) // no extra field
        .raw(nameBytes)
        .done(),
    );

    const crc = new Crc32();
    let size = 0;
    const reader = source.getReader();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        crc.update(value);
        size += value.length;
        if (size > MAX_UINT32) throw new Error(`"${entry.name}" exceeds the 4GB ZIP32 entry limit.`);
        yield advance(value);
      }
    } finally {
      reader.releaseLock();
    }

    const digest = crc.digest();

    yield advance(
      new ByteWriter()
        .u32(DATA_DESCRIPTOR_SIG)
        .u32(digest)
        .u32(size) // compressed === uncompressed under STORE
        .u32(size)
        .done(),
    );

    central.push({ name: nameBytes, crc: digest, size, offset: localOffset, time, date });
  }

  const centralStart = offset;

  for (const record of central) {
    yield advance(
      new ByteWriter()
        .u32(CENTRAL_HEADER_SIG)
        .u16(VERSION_NEEDED) // version made by
        .u16(VERSION_NEEDED) // version needed
        .u16(FLAGS)
        .u16(METHOD_STORE)
        .u16(record.time)
        .u16(record.date)
        .u32(record.crc)
        .u32(record.size)
        .u32(record.size)
        .u16(record.name.length)
        .u16(0) // extra
        .u16(0) // comment
        .u16(0) // disk number start
        .u16(0) // internal attributes
        .u32(0) // external attributes
        .u32(record.offset)
        .raw(record.name)
        .done(),
    );
  }

  yield advance(
    new ByteWriter()
      .u32(EOCD_SIG)
      .u16(0) // this disk
      .u16(0) // disk with central directory
      .u16(central.length)
      .u16(central.length)
      .u32(offset - centralStart)
      .u32(centralStart)
      .u16(0) // no archive comment
      .done(),
  );
}

/**
 * Build a ZIP as a ReadableStream, one chunk per consumer pull.
 */
export function buildZipStream(entries: ZipEntry[], options: ZipOptions = {}): ReadableStream<Uint8Array> {
  const iterator = generateZip(entries, options)[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        // The response headers are long gone by now, so the only honest signal
        // left is to break the body — the client sees a truncated transfer
        // rather than a plausible-looking archive that will not open.
        controller.error(error);
      }
    },
    async cancel(reason) {
      // The user navigated away or hit stop. Let the generator run its `finally`
      // blocks so the in-flight upstream clip response is released.
      await iterator.return?.(reason);
    },
  });
}
