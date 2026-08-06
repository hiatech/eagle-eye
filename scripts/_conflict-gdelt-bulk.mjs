// Primary GDELT conflict-event source using the official 15-minute bulk
// event export (#5849). The DOC API is aggressively per-IP throttled; the bulk
// stream is a single global stream and therefore remains usable when
// country-by-country DOC queries all return 429.

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { GDELT_COUNTRY_NAMES, gdeltSeenDateToIso, gdeltSeenDateToMs } from './_conflict-gdelt.mjs';
import { allSettledWithConcurrency } from './_seed-utils.mjs';

const GDELT_STORAGE_ORIGIN = 'https://storage.googleapis.com/data.gdeltproject.org';
export const GDELT_MASTER_FILELIST_URL = `${GDELT_STORAGE_ORIGIN}/gdeltv2/masterfilelist.txt`;
export const GDELT_TRANSLINGUAL_MASTER_FILELIST_URL = `${GDELT_STORAGE_ORIGIN}/gdeltv2/masterfilelist-translation.txt`;

/**
 * GDELT publishes two parallel 15-minute bulk streams. `masterfilelist.txt`
 * carries English-language sourcing; `masterfilelist-translation.txt` carries
 * the same schema machine-translated from 65 other languages, under filenames
 * with a `.translation` infix. Only the first was ingested, so every conflict
 * event in the product came from an English-language publisher — the catalog
 * covered the world, the sourcing did not.
 *
 * The two are schema-identical (61 tab-separated columns), so
 * mapGdeltExportToConflictEvents parses both unchanged, and GlobalEventID is
 * unique across streams, so the existing id-keyed dedup absorbs any overlap.
 *
 * The translingual stream runs roughly one 15-minute slot behind English and is
 * a strict ADDITION: fetchGdeltBulkConflictEvents degrades to English-only if
 * its manifest fails, because a new source must not be able to take down the
 * one that already works.
 */
export const GDELT_EXPORT_STREAMS = Object.freeze([
  Object.freeze({ id: 'english', infix: '', manifestUrl: GDELT_MASTER_FILELIST_URL, required: true }),
  Object.freeze({
    id: 'translingual',
    infix: '.translation',
    manifestUrl: GDELT_TRANSLINGUAL_MASTER_FILELIST_URL,
    required: false,
  }),
]);
export const GDELT_MAX_EXPORT_ZIP_BYTES = 5_000_000;
export const GDELT_MAX_EXPORT_CSV_BYTES = 30_000_000;
export const GDELT_ROLLING_WINDOW_MAX_EVENTS = 5_000;

const MASTER_TAIL_BYTES = 16_384;
const RECENT_EXPORT_COUNT = 8;
// 8, not 4: adding the translingual stream doubles the download count, and the
// seeder's worst-case network budget has only ~15s of slack under the 7-minute
// ACLED lock (tests/seed-fetch-deadline-budget-invariants). Widening the pool by
// the same factor keeps the worst case at its pre-translingual value instead of
// buying coverage with lock headroom. These are bounded range GETs against
// Google Cloud Storage, where 8 in flight is unremarkable.
const EXPORT_FETCH_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 20_000;
export const GDELT_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
// One manifest round (the per-stream reads run concurrently, so N streams still
// cost one timeout, not N) plus every stream's exports through the shared
// download pool. With the pool widened alongside the stream count this holds at
// its pre-translingual value — seed-conflict-intel derives its sweep budget and
// lock headroom from this number, so it must track the real fetch shape rather
// than the stream count alone.
export const GDELT_BULK_WORST_NETWORK_MS = REQUEST_TIMEOUT_MS
  * (1 + Math.ceil((RECENT_EXPORT_COUNT * GDELT_EXPORT_STREAMS.length) / EXPORT_FETCH_CONCURRENCY));
const USER_AGENT = 'WorldMonitor/1.0 (+https://www.worldmonitor.app)';
const MATERIAL_VIOLENCE_ROOT_CODES = new Set(['18', '19', '20']);

// GDELT ActionGeo_CountryCode uses FIPS 10-4 rather than ISO-2.
// Palestine can appear as either Gaza (GZ) or West Bank (WE).
export const GDELT_FIPS_TO_ISO2 = Object.freeze({
  AF: 'AF', SY: 'SY', UP: 'UA', SU: 'SD', OD: 'SS', SO: 'SO', CG: 'CD',
  BM: 'MM', YM: 'YE', ET: 'ET', IZ: 'IQ', GZ: 'PS', WE: 'PS', LY: 'LY',
  ML: 'ML', UV: 'BF', NG: 'NE', NI: 'NG', CM: 'CM', MZ: 'MZ', HA: 'HT',
});

function boundedPositiveInteger(value, label, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`invalid GDELT ${label}: ${value}`);
  }
  return parsed;
}

/** Escape a stream infix for embedding in the path/filename patterns. */
function infixPattern(infix) {
  return String(infix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseExportDescriptorLine(exportLine, stream = GDELT_EXPORT_STREAMS[0]) {
  const [sizeRaw, md5Raw, urlRaw, ...extra] = exportLine.split(/\s+/);
  if (!sizeRaw || !md5Raw || !urlRaw || extra.length) {
    throw new Error('malformed GDELT event export manifest line');
  }
  const size = boundedPositiveInteger(sizeRaw, 'event export size', GDELT_MAX_EXPORT_ZIP_BYTES);
  const md5 = md5Raw.toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(md5)) throw new Error('invalid GDELT event export checksum');

  const url = new URL(urlRaw);
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'data.gdeltproject.org' || url.port) {
    throw new Error(`untrusted GDELT event export URL: ${urlRaw}`);
  }
  const match = url.pathname.match(
    new RegExp(`^/gdeltv2/(\\d{14})${infixPattern(stream.infix)}\\.export\\.CSV\\.zip$`),
  );
  if (!match || url.search || url.hash) throw new Error(`invalid GDELT event export path: ${urlRaw}`);

  return {
    size,
    md5,
    url: `${GDELT_STORAGE_ORIGIN}${url.pathname}`,
    exportTimestamp: match[1],
    streamId: stream.id,
    infix: stream.infix,
  };
}

export function parseGdeltRecentExports(
  manifest,
  limit = RECENT_EXPORT_COUNT,
  stream = GDELT_EXPORT_STREAMS[0],
) {
  const descriptors = [];
  // The timestamp is part of the anchor, not just the infix. Without it the
  // English pattern (empty infix) still matches `...<ts>.translation.export.CSV.zip`,
  // because that name also ends in `.export.CSV.zip` — the filter would accept a
  // translingual line and only the descriptor parse below would reject it, which
  // is a throw rather than a skip. Requiring 14 digits immediately before the
  // infix makes each stream's filter reject the other's entries outright.
  const lineSuffix = new RegExp(
    `\\d{14}${infixPattern(stream.infix)}\\.export\\.CSV\\.zip$`,
    'i',
  );
  for (const line of String(manifest || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!lineSuffix.test(trimmed)) continue;
    try {
      descriptors.push(parseExportDescriptorLine(trimmed, stream));
    } catch (error) {
      // A suffix range can begin mid-line. Ignore that incomplete fragment,
      // but fail closed for any full-looking descriptor that violates the
      // checksum/size/URL allowlist.
      if (!/^\d+\s+[a-f0-9]{32}\s+/i.test(trimmed)) continue;
      throw error;
    }
  }
  if (!descriptors.length) throw new Error('GDELT master manifest tail has no valid event exports');
  return descriptors
    .sort((a, b) => a.exportTimestamp.localeCompare(b.exportTimestamp))
    .slice(-Math.max(1, limit));
}

export function extractGdeltExportCsv(zipBytes, expectedTimestamp = '', infix = '') {
  const zip = Buffer.isBuffer(zipBytes) ? zipBytes : Buffer.from(zipBytes || []);
  if (zip.length < 30 || zip.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('invalid GDELT event export ZIP header');
  }
  const flags = zip.readUInt16LE(6);
  if (flags & 0x1) throw new Error('encrypted GDELT event export ZIP is unsupported');
  if (flags & 0x8) throw new Error('streaming GDELT event export ZIP is unsupported');

  const method = zip.readUInt16LE(8);
  const compressedSize = boundedPositiveInteger(
    zip.readUInt32LE(18),
    'ZIP compressed size',
    GDELT_MAX_EXPORT_ZIP_BYTES,
  );
  const uncompressedSize = boundedPositiveInteger(
    zip.readUInt32LE(22),
    'ZIP uncompressed size',
    GDELT_MAX_EXPORT_CSV_BYTES,
  );
  const filenameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const dataStart = 30 + filenameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataStart > zip.length || dataEnd > zip.length) throw new Error('truncated GDELT event export ZIP');

  const filename = zip.subarray(30, 30 + filenameLength).toString('utf8');
  const escapedInfix = infixPattern(infix);
  if (!new RegExp(`^\\d{14}${escapedInfix}\\.export\\.CSV$`).test(filename)) {
    throw new Error(`unexpected GDELT event export filename: ${filename}`);
  }
  // Exact-match the descriptor when the caller has one (#5864): the pattern
  // above accepts ANY well-formed timestamp, so a substituted-but-valid entry
  // would pass. The bulk materializer's copy of this transport already pins the
  // exact name; both copies now agree.
  if (expectedTimestamp && filename !== `${expectedTimestamp}${infix}.export.CSV`) {
    throw new Error(
      `GDELT event export filename ${filename} does not match descriptor ${expectedTimestamp}${infix}`,
    );
  }

  const compressed = zip.subarray(dataStart, dataEnd);
  const csv = method === 8
    ? inflateRawSync(compressed, { maxOutputLength: GDELT_MAX_EXPORT_CSV_BYTES })
    : (method === 0 ? Buffer.from(compressed) : null);
  if (!csv) throw new Error(`unsupported GDELT event export ZIP compression method: ${method}`);
  if (csv.length !== uncompressedSize) {
    throw new Error(`GDELT event export size mismatch: expected ${uncompressedSize}, got ${csv.length}`);
  }
  return csv.toString('utf8');
}

function sourceDomain(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return '';
  }
}

// Kept as a re-export for this module's existing consumers; the parser's
// single home is _conflict-gdelt.mjs (#5856 review).
export function gdeltTimestampToMs(value) {
  return gdeltSeenDateToMs(value);
}

export function mapGdeltExportToConflictEvents(csv) {
  const events = [];
  const seen = new Set();
  for (const line of String(csv || '').split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split('\t');
    if (fields.length < 61 || fields[25] !== '1' || fields[29] !== '4') continue;
    if (!MATERIAL_VIOLENCE_ROOT_CODES.has(fields[28])) continue;

    const iso2 = GDELT_FIPS_TO_ISO2[fields[53]];
    const country = GDELT_COUNTRY_NAMES[iso2];
    const id = fields[0];
    const eventDate = gdeltSeenDateToIso(fields[59]);
    const gdeltAddedAt = gdeltTimestampToMs(fields[59]);
    if (!id || seen.has(id) || !country || !eventDate || !Number.isFinite(gdeltAddedAt)) continue;
    seen.add(id);

    const url = fields[60] || '';
    events.push({
      id: `gdelt-event-${id}`,
      eventType: `GDELT ${fields[26] || fields[28] || 'material conflict'}`,
      country,
      event_date: eventDate,
      occurredAt: gdeltAddedAt,
      gdeltAddedAt,
      source: sourceDomain(url),
      url,
    });
  }
  return events;
}

function eventAddedAt(event, fallbackTimestamp) {
  const exact = Number(event?.gdeltAddedAt);
  if (Number.isFinite(exact) && exact > 0) return exact;
  return gdeltTimestampToMs(fallbackTimestamp);
}

export function mergeGdeltBulkRollingWindow(bulk, previousSnapshot, nowMs = Date.now()) {
  const cutoff = nowMs - GDELT_ROLLING_WINDOW_MS;
  const previousIsBulk = previousSnapshot?.source === 'gdelt-bulk'
    && Array.isArray(previousSnapshot.events);
  const previousExportTimestamp = previousSnapshot?.pagination?.exportTimestamp;
  const currentExportTimestamp = bulk?.exportTimestamp;
  const byId = new Map();

  const addEvents = (events, fallbackTimestamp) => {
    for (const event of Array.isArray(events) ? events : []) {
      const addedAt = eventAddedAt(event, fallbackTimestamp);
      if (!event?.id || !Number.isFinite(addedAt) || addedAt < cutoff) continue;
      byId.set(event.id, { ...event, occurredAt: addedAt, gdeltAddedAt: addedAt });
    }
  };

  if (previousIsBulk) addEvents(previousSnapshot.events, previousExportTimestamp);
  // Current exports win on duplicate IDs, though GDELT event IDs are normally
  // first-seen-only and therefore unique across 15-minute export files.
  addEvents(bulk?.events, currentExportTimestamp);

  const currentCoverageStart = gdeltTimestampToMs(
    bulk?.oldestExportTimestamp || currentExportTimestamp,
  );
  const previousCoverageStart = previousIsBulk
    ? Number(previousSnapshot.pagination?.rollingWindowStartedAt)
    : Number.NaN;
  const legacyPreviousCoverageStart = previousIsBulk
    ? gdeltTimestampToMs(previousExportTimestamp) - (RECENT_EXPORT_COUNT * 15 * 60 * 1000)
    : Number.NaN;
  const coverageCandidates = [
    currentCoverageStart,
    previousCoverageStart,
    legacyPreviousCoverageStart,
  ].filter(value => Number.isFinite(value) && value > 0);
  const earliestCoverage = coverageCandidates.length
    ? Math.min(...coverageCandidates)
    : nowMs;
  const rollingWindowStartedAt = Math.max(cutoff, earliestCoverage);
  const events = [...byId.values()]
    .sort((a, b) => b.gdeltAddedAt - a.gdeltAddedAt)
    .slice(0, GDELT_ROLLING_WINDOW_MAX_EVENTS);

  return {
    events,
    rollingWindowStartedAt,
    rollingWindowComplete: rollingWindowStartedAt <= cutoff,
    retainedPreviousEvents: previousIsBulk
      ? events.filter(event => event.gdeltAddedAt < currentCoverageStart).length
      : 0,
  };
}

async function fetchBoundedBuffer(fetchImpl, url, maxBytes, expectedStatus, extraHeaders = {}) {
  const response = await fetchImpl(url, {
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT, ...extraHeaders },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GDELT bulk HTTP ${response.status} for ${url}`);
  if (expectedStatus && response.status !== expectedStatus) {
    throw new Error(`GDELT bulk expected HTTP ${expectedStatus}, got ${response.status} for ${url}`);
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`GDELT bulk response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) throw new Error(`GDELT bulk response has no body for ${url}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`GDELT bulk response exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

export async function fetchGdeltBulkConflictEvents({
  fetchImpl = globalThis.fetch,
  streams = GDELT_EXPORT_STREAMS,
} = {}) {
  // Concurrent, not sequential: GDELT_BULK_WORST_NETWORK_MS charges one manifest
  // timeout for the whole set, and the seeder's lock headroom is derived from it.
  // Reading them in series would silently cost one extra timeout per stream.
  const manifests = await Promise.allSettled(streams.map((stream) => fetchBoundedBuffer(
    fetchImpl,
    stream.manifestUrl,
    MASTER_TAIL_BYTES,
    206,
    { Range: `bytes=-${MASTER_TAIL_BYTES}` },
  )));

  const descriptors = [];
  const streamFailures = [];
  for (const [index, stream] of streams.entries()) {
    const settled = manifests[index];
    try {
      if (settled.status === 'rejected') throw settled.reason;
      descriptors.push(
        ...parseGdeltRecentExports(settled.value.toString('utf8'), RECENT_EXPORT_COUNT, stream),
      );
    } catch (error) {
      // A required stream failing is fatal exactly as before. An optional one is
      // not: the translingual list is additive coverage, and letting it fail the
      // run would trade the conflict feed that works for the one being added.
      if (stream.required !== false) throw error;
      streamFailures.push(`${stream.id}: ${error?.message || error}`);
    }
  }
  const results = await allSettledWithConcurrency(
    descriptors,
    EXPORT_FETCH_CONCURRENCY,
    async (descriptor) => {
      const zipBytes = await fetchBoundedBuffer(fetchImpl, descriptor.url, GDELT_MAX_EXPORT_ZIP_BYTES);
      if (zipBytes.length !== descriptor.size) {
        throw new Error(`download size mismatch: expected ${descriptor.size}, got ${zipBytes.length}`);
      }
      const actualMd5 = createHash('md5').update(zipBytes).digest('hex');
      if (actualMd5 !== descriptor.md5) throw new Error('checksum mismatch');
      return {
        events: mapGdeltExportToConflictEvents(
          extractGdeltExportCsv(zipBytes, descriptor.exportTimestamp, descriptor.infix ?? ''),
        ),
        exportTimestamp: descriptor.exportTimestamp,
        streamId: descriptor.streamId ?? 'english',
      };
    },
  );

  const successful = results.filter(result => result.status === 'fulfilled');
  if (!successful.length) {
    const sample = results.slice(0, 3).map(result => result.reason?.message || result.reason).join(', ');
    throw new Error(`all recent GDELT event exports failed${sample ? `: ${sample}` : ''}`);
  }
  const events = [];
  const seen = new Set();
  for (const result of successful) {
    for (const event of result.value.events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }
  return {
    events,
    oldestExportTimestamp: successful
      .map(result => result.value.exportTimestamp)
      .sort()
      .at(0),
    exportTimestamp: successful
      .map(result => result.value.exportTimestamp)
      .sort()
      .at(-1),
    exportsRequested: descriptors.length,
    exportsSucceeded: successful.length,
    // Per-stream counts so a silently-empty translingual half is visible in the
    // seed log instead of hiding inside a healthy-looking total.
    eventsByStream: successful.reduce((acc, result) => {
      const id = result.value.streamId;
      acc[id] = (acc[id] ?? 0) + result.value.events.length;
      return acc;
    }, {}),
    streamFailures,
  };
}
