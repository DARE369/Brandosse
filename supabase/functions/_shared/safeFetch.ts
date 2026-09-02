/**
 * safeFetch.ts — the only sanctioned way an edge function may fetch a URL that
 * a user had any influence over.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * `extractBrandKit` accepted a `websiteUrl` from the request body and fetched
 * it from inside the edge runtime with `redirect: "follow"` and no address
 * check whatsoever — before or after redirects. `generateImage` did the same
 * with `body.logo_url`. Both then handed the response somewhere the caller
 * could read it: the brand extractor summarises the body with an LLM and
 * returns the result, and the logo path composites the bytes into an image the
 * caller downloads.
 *
 * That is a server-side request forgery read primitive. A caller could aim it
 * at a cloud metadata endpoint, at `localhost`, or at anything on the private
 * network the runtime can reach, and get the response back through the
 * product's own UI.
 *
 * The website-harvest work multiplies one such fetch into roughly thirteen —
 * pages, stylesheets, and image assets, each following links found in
 * attacker-influenceable markup. Widening a hole before closing it is the
 * wrong order, so this lands first.
 *
 * ── What is enforced ────────────────────────────────────────────────────────
 *  1. http/https only. No file:, data:, blob:, gopher:, ftp:.
 *  2. No credentials embedded in the URL.
 *  3. Ports restricted to 80/443. A brand's public website does not live on
 *     8500, but plenty of internal services do.
 *  4. Literal IP addresses are parsed and rejected across every private,
 *     loopback, link-local, CGNAT, multicast and reserved range — v4 and v6,
 *     including the v4-mapped, 6to4 and NAT64 embeddings that smuggle a v4
 *     address inside a v6 one.
 *  5. Hostnames that cannot be public are rejected by name: `localhost`,
 *     `.local`, `.internal`, `.home.arpa`, `.arpa`, and any single-label host
 *     (`metadata`, `router`) which can only resolve via a local search domain.
 *  6. DNS is resolved and EVERY returned address is checked, so a public name
 *     pointing at 127.0.0.1 is refused.
 *  7. Redirects are followed manually, and every hop is re-validated from
 *     scratch. Following redirects natively is what makes most SSRF filters
 *     decorative — the first hop passes and the second one goes anywhere.
 *  8. Responses are byte-capped and time-bounded.
 *
 * ── The residual gap, stated rather than papered over ───────────────────────
 * There is a window between resolving a name and connecting to it — the
 * connection is made by `fetch`, which re-resolves and cannot be pinned to the
 * address we validated. A DNS entry that changes between those two moments
 * (classic rebinding) would not be caught. Closing it properly needs
 * connect-time address pinning, which this runtime does not expose.
 *
 * The mitigations that ARE in place: a short cache-defeating window, per-hop
 * re-validation, and the port restriction, which removes most of what rebinding
 * is normally aimed at. This is documented as a known limit rather than
 * described as solved.
 *
 * Where `Deno.resolveDns` is unavailable in the deployed runtime, the name
 * checks and literal-IP checks still apply, and the degradation is LOGGED —
 * never silent. See `dnsChecked` on the result.
 */

/** Thrown when a URL is refused. Carries a status code the http helper maps. */
export class BlockedUrlError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "BlockedUrlError";
    this.statusCode = statusCode;
  }
}

export interface SafeFetchOptions {
  /** Hard ceiling on the response body. Default 5 MB. */
  maxBytes?: number;
  /** Per-request timeout. Default 15s — a page that is slower is not worth a harvest slot. */
  timeoutMs?: number;
  /** Redirect hops to follow, each fully re-validated. Default 3. */
  maxRedirects?: number;
  /** Extra request headers. A User-Agent is supplied when absent. */
  headers?: Record<string, string>;
  /**
   * When set, the response Content-Type must match or the response is refused.
   * Guards against an image slot being fed an HTML error page, and against a
   * page slot being fed a multi-gigabyte video.
   */
  expectContentType?: RegExp;
  /** Label used in logs so a blocked request is attributable. */
  context?: string;
}

export interface SafeFetchResult {
  bytes: Uint8Array;
  contentType: string;
  /** The URL actually fetched, after redirects. */
  finalUrl: string;
  status: number;
  /** False when the runtime could not resolve DNS, so only name/literal checks ran. */
  dnsChecked: boolean;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_UA = "Mozilla/5.0 (compatible; BrandKitBot/1.0; +https://brandosse.com/bot)";

const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** Suffixes that can only resolve inside a local network or not at all. */
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".arpa",
];

const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
]);

// ── IP parsing ───────────────────────────────────────────────────────────────
//
// The WHATWG URL parser canonicalises IPv4 written in decimal, octal or hex
// form (`http://2130706433/` and `http://0177.0.0.1/` both normalise to
// 127.0.0.1) and brackets IPv6. So by the time a hostname reaches here it is
// already in canonical form, and a strict parser is correct rather than naive.

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // A leading zero would mean octal to some resolvers; canonical form has none.
    if (part.length > 1 && part[0] === "0") return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isBlockedIpv4(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0) return true;                                  // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                 // private
  if (a === 127) return true;                                // loopback
  if (a === 100 && b >= 64 && b <= 127) return true;         // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true;                   // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;          // private
  if (a === 192 && b === 168) return true;                   // private
  if (a === 192 && b === 0) return true;                     // 192.0.0/24 + 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 88) return true;                    // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true;       // benchmarking
  if (a === 198 && b === 51) return true;                    // TEST-NET-2
  if (a === 203 && b === 0) return true;                     // TEST-NET-3
  if (a >= 224) return true;                                 // multicast, reserved, broadcast
  return false;
}

/** Expand a canonical IPv6 literal (brackets already stripped) to 8 groups. */
function parseIpv6(host: string): number[] | null {
  if (!host.includes(":")) return null;

  // An IPv4-mapped tail (::ffff:192.168.0.1) is legal and must be understood,
  // not treated as an opaque string — it is the most common way a v4 address
  // is smuggled past a v6-unaware filter.
  let tailV4: number[] | null = null;
  let work = host;
  const lastColon = work.lastIndexOf(":");
  const tail = work.slice(lastColon + 1);
  if (tail.includes(".")) {
    tailV4 = parseIpv4(tail);
    if (!tailV4) return null;
    work = work.slice(0, lastColon + 1) +
      ((tailV4[0] << 8) | tailV4[1]).toString(16) + ":" +
      ((tailV4[2] << 8) | tailV4[3]).toString(16);
  }

  const halves = work.split("::");
  if (halves.length > 2) return null;

  const toGroups = (segment: string): number[] | null => {
    if (!segment) return [];
    const out: number[] = [];
    for (const piece of segment.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  if (!head) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const rest = toGroups(halves[1]);
  if (!rest) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < 0) return null;
  return [...head, ...new Array(fill).fill(0), ...rest];
}

function isBlockedIpv6(g: number[]): boolean {
  const isZero = g.every((x) => x === 0);
  if (isZero) return true;                                   // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback

  // v4-mapped ::ffff:a.b.c.d and v4-compatible — check the embedded address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
    return isBlockedIpv4(v4);
  }
  // NAT64 well-known prefix 64:ff9b::/96 — embedded v4 again.
  if (g[0] === 0x0064 && g[1] === 0xff9b) {
    const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
    return isBlockedIpv4(v4);
  }
  // 6to4 2002::/16 embeds the v4 address in the next 32 bits.
  if (g[0] === 0x2002) {
    const v4 = [g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff];
    return isBlockedIpv4(v4);
  }

  if ((g[0] & 0xfe00) === 0xfc00) return true;               // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true;               // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;               // ff00::/8 multicast
  return false;
}

/** True when the string is a literal address that must never be fetched. */
function isBlockedIpLiteral(host: string): boolean | null {
  const v4 = parseIpv4(host);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(host);
  if (v6) return isBlockedIpv6(v6);
  return null; // not a literal — it is a name
}

// ── URL validation ───────────────────────────────────────────────────────────

export interface AssertPublicUrlResult {
  url: URL;
  dnsChecked: boolean;
}

/**
 * Validate a URL is safe to fetch from the server. Throws BlockedUrlError with
 * a message safe to show a user — it names what was wrong, never what was
 * reachable, so this cannot itself be used to map the internal network.
 */
export async function assertPublicUrl(raw: string): Promise<AssertPublicUrlResult> {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new BlockedUrlError("No URL was provided");

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new BlockedUrlError("That does not look like a valid web address");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Only http and https addresses can be fetched");
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("Web addresses with embedded credentials are not accepted");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new BlockedUrlError("Only standard web ports (80 and 443) can be fetched");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) throw new BlockedUrlError("That web address has no host");

  const literal = isBlockedIpLiteral(host);
  if (literal === true) {
    throw new BlockedUrlError("That address is on a private or reserved network");
  }

  if (literal === null) {
    if (BLOCKED_HOST_EXACT.has(host)) {
      throw new BlockedUrlError("That address is on a private or reserved network");
    }
    if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      throw new BlockedUrlError("That address is on a private or reserved network");
    }
    // A single-label host has no public DNS meaning; it can only resolve
    // through a local search domain, which is exactly what we are blocking.
    if (!host.includes(".")) {
      throw new BlockedUrlError("That web address is missing a domain name");
    }
  }

  // Resolve the name and check every address it points at. A public hostname
  // whose A record is 127.0.0.1 is the standard way past a name-only filter.
  let dnsChecked = false;
  if (literal === null && typeof (Deno as { resolveDns?: unknown }).resolveDns === "function") {
    const addresses: string[] = [];
    for (const recordType of ["A", "AAAA"] as const) {
      try {
        const found = await Deno.resolveDns(host, recordType);
        addresses.push(...found);
      } catch (err) {
        // NotFound for one family is normal (v4-only or v6-only hosts).
        // Anything else means the lookup itself failed.
        const name = err instanceof Error ? err.name : "";
        if (name !== "NotFound" && name !== "NotSupported") {
          throw new BlockedUrlError(`Could not look up ${host}`);
        }
      }
    }

    if (addresses.length > 0) {
      dnsChecked = true;
      for (const address of addresses) {
        if (isBlockedIpLiteral(address) === true) {
          throw new BlockedUrlError("That address is on a private or reserved network");
        }
      }
    }
  }

  if (!dnsChecked && literal === null) {
    // Loud, structured, and attributable. The check degraded; it did not pass.
    console.warn("[safeFetch] dns_check_unavailable", {
      host,
      reason: typeof (Deno as { resolveDns?: unknown }).resolveDns === "function"
        ? "no_addresses_returned"
        : "resolveDns_not_available_in_runtime",
    });
  }

  return { url, dnsChecked };
}

// ── Body reading ─────────────────────────────────────────────────────────────

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BlockedUrlError(
      `That file is larger than the ${Math.floor(maxBytes / 1024 / 1024)}MB limit`,
      413,
    );
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Cancel rather than drain: the point of the cap is to stop transferring.
      await reader.cancel().catch(() => {});
      throw new BlockedUrlError(
        `That file is larger than the ${Math.floor(maxBytes / 1024 / 1024)}MB limit`,
        413,
      );
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// ── The fetch itself ─────────────────────────────────────────────────────────

/**
 * Fetch a user-influenced URL with every hop validated.
 *
 * Redirects are handled here rather than by `fetch` because native redirect
 * following is what defeats most SSRF filters: the first hop is checked and
 * the rest are not. Each Location is resolved against the URL it came from and
 * put through the full validation again.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const context = options.context ?? "safeFetch";

  let current = rawUrl;
  let dnsChecked = true;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const { url, dnsChecked: hopDnsChecked } = await assertPublicUrl(current);
    dnsChecked = dnsChecked && hopDnsChecked;

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": DEFAULT_UA,
          "Accept-Encoding": "gzip, deflate",
          ...(options.headers ?? {}),
        },
        // CLAUDE.md non-negotiable: every outbound call is bounded.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("timed out") || message.toLowerCase().includes("abort")) {
        throw new BlockedUrlError(`${url.hostname} did not respond in time`, 504);
      }
      throw new BlockedUrlError(`Could not reach ${url.hostname}`, 502);
    }

    const isRedirect = response.status >= 300 && response.status < 400;
    if (isRedirect) {
      const location = response.headers.get("location");
      // Drain so the connection is not left hanging on a redirect body.
      await response.body?.cancel().catch(() => {});
      if (!location) {
        throw new BlockedUrlError(`${url.hostname} returned a redirect with no destination`, 502);
      }
      if (hop === maxRedirects) {
        throw new BlockedUrlError(`${url.hostname} redirected too many times`, 502);
      }
      // Relative Locations are legal and common; resolve against the hop we
      // just made, then re-validate from scratch on the next pass.
      current = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new BlockedUrlError(
        `${url.hostname} returned ${response.status}`,
        response.status === 404 ? 404 : 502,
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (options.expectContentType && !options.expectContentType.test(contentType)) {
      await response.body?.cancel().catch(() => {});
      throw new BlockedUrlError(
        `${url.hostname} returned ${contentType || "an unknown file type"}, which is not what was expected`,
      );
    }

    const bytes = await readCapped(response, maxBytes);

    if (!dnsChecked) {
      console.warn("[safeFetch] completed_without_dns_validation", { context, host: url.hostname });
    }

    return {
      bytes,
      contentType,
      finalUrl: url.toString(),
      status: response.status,
      dnsChecked,
    };
  }

  throw new BlockedUrlError("Too many redirects", 502);
}

/** safeFetch, decoded as UTF-8 text. */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<{ text: string; finalUrl: string; contentType: string }> {
  const result = await safeFetch(rawUrl, options);
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(result.bytes),
    finalUrl: result.finalUrl,
    contentType: result.contentType,
  };
}
