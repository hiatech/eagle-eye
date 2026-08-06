import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGdeltExportCsv,
  fetchGdeltBulkConflictEvents,
  GDELT_EXPORT_STREAMS,
  GDELT_ROLLING_WINDOW_MS,
  GDELT_ROLLING_WINDOW_MAX_EVENTS,
  mapGdeltExportToConflictEvents,
  mergeGdeltBulkRollingWindow,
  parseGdeltRecentExports,
} from '../scripts/_conflict-gdelt-bulk.mjs';

function gdeltRow({
  id = '1',
  isRoot = '1',
  eventCode = '190',
  eventRootCode = '19',
  quadClass = '4',
  countryCode = 'SU',
  dateAdded = '20260713110000',
  url = 'https://example.com/conflict',
} = {}) {
  const fields = Array(61).fill('');
  fields[0] = id;
  fields[25] = isRoot;
  fields[26] = eventCode;
  fields[28] = eventRootCode;
  fields[29] = quadClass;
  fields[53] = countryCode;
  fields[59] = dateAdded;
  fields[60] = url;
  return fields.join('\t');
}

function makeStoredZip(filename, text) {
  const name = Buffer.from(filename);
  const body = Buffer.from(text);
  const zip = Buffer.alloc(30 + name.length + body.length);
  zip.writeUInt32LE(0x04034b50, 0);
  zip.writeUInt16LE(20, 4);
  zip.writeUInt16LE(0, 6);
  zip.writeUInt16LE(0, 8);
  zip.writeUInt32LE(body.length, 18);
  zip.writeUInt32LE(body.length, 22);
  zip.writeUInt16LE(name.length, 26);
  zip.writeUInt16LE(0, 28);
  name.copy(zip, 30);
  body.copy(zip, 30 + name.length);
  return zip;
}

function makeDeflatedZip(filename, text) {
  const name = Buffer.from(filename);
  const plain = Buffer.from(text);
  const body = deflateRawSync(plain);
  const zip = Buffer.alloc(30 + name.length + body.length);
  zip.writeUInt32LE(0x04034b50, 0);
  zip.writeUInt16LE(20, 4);
  zip.writeUInt16LE(0, 6);
  zip.writeUInt16LE(8, 8);
  zip.writeUInt32LE(body.length, 18);
  zip.writeUInt32LE(plain.length, 22);
  zip.writeUInt16LE(name.length, 26);
  zip.writeUInt16LE(0, 28);
  name.copy(zip, 30);
  body.copy(zip, 30 + name.length);
  return zip;
}

test('parseGdeltRecentExports validates descriptors and rewrites downloads to the TLS storage origin', () => {
  const [descriptor] = parseGdeltRecentExports(
    '123 0123456789abcdef0123456789abcdef http://data.gdeltproject.org/gdeltv2/20260713110000.export.CSV.zip\n' +
    '456 fedcba9876543210fedcba9876543210 http://data.gdeltproject.org/gdeltv2/20260713110000.gkg.csv.zip\n', 1,
  );
  assert.deepEqual(descriptor, {
    size: 123,
    md5: '0123456789abcdef0123456789abcdef',
    url: 'https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/20260713110000.export.CSV.zip',
    exportTimestamp: '20260713110000',
    streamId: 'english',
    infix: '',
  });
});

test('parseGdeltRecentExports rejects untrusted export URLs', () => {
  assert.throws(
    () => parseGdeltRecentExports(
      '123 0123456789abcdef0123456789abcdef http://evil.example/gdeltv2/20260713110000.export.CSV.zip',
    ),
    /untrusted GDELT event export URL/,
  );
});

test('parseGdeltRecentExports keeps the newest bounded set from a range tail', () => {
  const timestamps = [
    '20260713090000', '20260713091500', '20260713093000', '20260713094500',
    '20260713100000', '20260713101500', '20260713103000', '20260713104500',
    '20260713110000', '20260713111500',
  ];
  const lines = timestamps.map((timestamp) => {
    return `123 0123456789abcdef0123456789abcdef http://data.gdeltproject.org/gdeltv2/${timestamp}.export.CSV.zip`;
  });
  const descriptors = parseGdeltRecentExports(`truncated-prefix\n${lines.join('\n')}`, 3);
  assert.deepEqual(
    descriptors.map(descriptor => descriptor.exportTimestamp),
    ['20260713104500', '20260713110000', '20260713111500'],
  );
});

test('mapGdeltExportToConflictEvents maps strong material conflict and filters noise', () => {
  const csv = [
    gdeltRow({ id: '1', countryCode: 'SU' }),
    gdeltRow({ id: '2', countryCode: 'UP', eventRootCode: '18', eventCode: '183' }),
    gdeltRow({ id: '3', countryCode: 'NI', eventRootCode: '17', eventCode: '173' }),
    gdeltRow({ id: '4', countryCode: 'US' }),
    gdeltRow({ id: '5', countryCode: 'ML', isRoot: '0' }),
    gdeltRow({ id: '1', countryCode: 'SU' }),
  ].join('\n');

  const events = mapGdeltExportToConflictEvents(csv);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.country), ['Sudan', 'Ukraine']);
  assert.equal(events[0].event_date, '2026-07-13');
  assert.equal(events[0].gdeltAddedAt, Date.parse('2026-07-13T11:00:00Z'));
  assert.equal(events[0].occurredAt, Date.parse('2026-07-13T11:00:00Z'));
  assert.equal(events[0].source, 'example.com');
  assert.equal(events[0].id, 'gdelt-event-1');
});

test('mergeGdeltBulkRollingWindow retains the prior 24h, prunes stale events, and prefers current duplicates', () => {
  const now = Date.parse('2026-07-13T18:00:00Z');
  const event = (id, hoursAgo, url = `https://example.com/${id}`) => {
    const gdeltAddedAt = now - hoursAgo * 60 * 60 * 1000;
    return {
      id,
      country: 'Sudan',
      event_date: new Date(gdeltAddedAt).toISOString().slice(0, 10),
      occurredAt: gdeltAddedAt,
      gdeltAddedAt,
      url,
    };
  };
  const previousSnapshot = {
    source: 'gdelt-bulk',
    events: [
      event('prior-12h', 12),
      event('stale-25h', 25),
      event('duplicate', 1.5, 'https://example.com/old'),
    ],
    pagination: {
      exportTimestamp: '20260713163000',
      rollingWindowStartedAt: now - 14 * 60 * 60 * 1000,
    },
  };
  const bulk = {
    events: [event('current-1h', 1), event('duplicate', 1, 'https://example.com/new')],
    oldestExportTimestamp: '20260713160000',
    exportTimestamp: '20260713170000',
  };

  const result = mergeGdeltBulkRollingWindow(bulk, previousSnapshot, now);

  assert.deepEqual(result.events.map(item => item.id), ['duplicate', 'current-1h', 'prior-12h']);
  assert.equal(result.events.find(item => item.id === 'duplicate').url, 'https://example.com/new');
  assert.equal(result.events.some(item => item.id === 'stale-25h'), false);
  assert.equal(result.rollingWindowStartedAt, now - 14 * 60 * 60 * 1000);
  assert.equal(result.rollingWindowComplete, false);
  assert.equal(result.retainedPreviousEvents, 1);
});

test('mergeGdeltBulkRollingWindow reaches a bounded complete window and never mixes prior ACLED data', () => {
  const now = Date.parse('2026-07-14T18:00:00Z');
  const cutoff = now - GDELT_ROLLING_WINDOW_MS;
  const previousEvent = {
    id: 'prior-bulk',
    country: 'Sudan',
    event_date: '2026-07-14',
    gdeltAddedAt: now - 12 * 60 * 60 * 1000,
  };
  const currentEvent = {
    id: 'current-bulk',
    country: 'Sudan',
    event_date: '2026-07-14',
    gdeltAddedAt: now - 60 * 60 * 1000,
  };
  const bulk = {
    events: [currentEvent],
    oldestExportTimestamp: '20260714160000',
    exportTimestamp: '20260714170000',
  };

  const complete = mergeGdeltBulkRollingWindow(bulk, {
    source: 'gdelt-bulk',
    events: [previousEvent],
    pagination: {
      exportTimestamp: '20260714153000',
      rollingWindowStartedAt: cutoff - 60 * 60 * 1000,
    },
  }, now);
  assert.equal(complete.rollingWindowStartedAt, cutoff);
  assert.equal(complete.rollingWindowComplete, true);
  assert.deepEqual(complete.events.map(item => item.id), ['current-bulk', 'prior-bulk']);

  const sourceIsolated = mergeGdeltBulkRollingWindow(bulk, {
    source: 'acled',
    events: [{ id: 'acled-event', country: 'Sudan', event_date: '2026-07-14' }],
    pagination: undefined,
  }, now);
  assert.deepEqual(sourceIsolated.events.map(item => item.id), ['current-bulk']);
});

test('mergeGdeltBulkRollingWindow caps the newest events to protect the publish budget', () => {
  const now = Date.parse('2026-07-14T18:00:00Z');
  const events = Array.from({ length: GDELT_ROLLING_WINDOW_MAX_EVENTS + 2 }, (_, index) => ({
    id: `event-${index}`,
    country: 'Sudan',
    event_date: '2026-07-14',
    gdeltAddedAt: now - index,
  }));

  const result = mergeGdeltBulkRollingWindow({
    events,
    oldestExportTimestamp: '20260714160000',
    exportTimestamp: '20260714170000',
  }, null, now);

  assert.equal(result.events.length, GDELT_ROLLING_WINDOW_MAX_EVENTS);
  assert.equal(result.events[0].id, 'event-0');
  assert.equal(result.events.at(-1).id, `event-${GDELT_ROLLING_WINDOW_MAX_EVENTS - 1}`);
});

test('extractGdeltExportCsv reads the bounded single-file ZIP payload', () => {
  const csv = gdeltRow();
  const zip = makeStoredZip('20260713110000.export.CSV', csv);
  assert.equal(extractGdeltExportCsv(zip), csv);
});

test('extractGdeltExportCsv inflates the compression method used by live exports', () => {
  const csv = gdeltRow();
  const zip = makeDeflatedZip('20260713110000.export.CSV', csv);
  assert.equal(extractGdeltExportCsv(zip), csv);
});

test('fetchGdeltBulkConflictEvents verifies the manifest and returns mapped events', async () => {
  const csv = gdeltRow();
  const zip = makeStoredZip('20260713110000.export.CSV', csv);
  const md5 = createHash('md5').update(zip).digest('hex');
  const manifest = `${zip.length} ${md5} http://data.gdeltproject.org/gdeltv2/20260713110000.export.CSV.zip\n`;
  const requests = [];
  // URL-keyed, not a positional queue: the fetcher reads one manifest per
  // configured stream, so a queue silently hands the second manifest read
  // whatever response was meant for the first ZIP download.
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (String(url).endsWith('masterfilelist.txt')) {
      return new Response(manifest, {
        status: 206,
        headers: { 'content-length': String(Buffer.byteLength(manifest)) },
      });
    }
    return new Response(zip, { headers: { 'content-length': String(zip.length) } });
  };

  const result = await fetchGdeltBulkConflictEvents({
    fetchImpl,
    streams: [GDELT_EXPORT_STREAMS[0]],
  });
  assert.equal(result.exportTimestamp, '20260713110000');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].country, 'Sudan');
  assert.equal(result.exportsRequested, 1);
  assert.equal(result.exportsSucceeded, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.options.headers['User-Agent']));
  assert.equal(requests[0].options.headers.Range, 'bytes=-16384');
});

test('fetchGdeltBulkConflictEvents fails closed on checksum mismatch', async () => {
  const csv = gdeltRow();
  const zip = makeStoredZip('20260713110000.export.CSV', csv);
  const manifest = `${zip.length} 00000000000000000000000000000000 http://data.gdeltproject.org/gdeltv2/20260713110000.export.CSV.zip\n`;
  const fetchImpl = async (url) => (String(url).endsWith('masterfilelist.txt')
    ? new Response(manifest, { status: 206 })
    : new Response(zip));

  await assert.rejects(
    fetchGdeltBulkConflictEvents({ fetchImpl, streams: [GDELT_EXPORT_STREAMS[0]] }),
    /all recent GDELT event exports failed: checksum mismatch/,
  );
});

test('fetchGdeltBulkConflictEvents reports the newest successful export when a later export fails', async () => {
  const csv = gdeltRow();
  const zip = makeStoredZip('20260713110000.export.CSV', csv);
  const md5 = createHash('md5').update(zip).digest('hex');
  const manifest = [
    `${zip.length} ${md5} http://data.gdeltproject.org/gdeltv2/20260713110000.export.CSV.zip`,
    `${zip.length} 00000000000000000000000000000000 http://data.gdeltproject.org/gdeltv2/20260713111500.export.CSV.zip`,
  ].join('\n');
  const fetchImpl = async (url) => String(url).endsWith('masterfilelist.txt')
    ? new Response(manifest, { status: 206 })
    : new Response(zip);

  const result = await fetchGdeltBulkConflictEvents({ fetchImpl });
  assert.equal(result.exportTimestamp, '20260713110000');
  assert.equal(result.exportsRequested, 2);
  assert.equal(result.exportsSucceeded, 1);
  assert.equal(result.events.length, 1);
});

test('fetchGdeltBulkConflictEvents bounds streamed responses without content-length', async () => {
  const oversizedManifest = 'x'.repeat(16_385);
  await assert.rejects(
    fetchGdeltBulkConflictEvents({ fetchImpl: async () => new Response(oversizedManifest, { status: 206 }) }),
    /GDELT bulk response exceeds 16384 bytes/,
  );
});

test('fetchGdeltBulkConflictEvents rejects a manifest response that ignores the suffix range', async () => {
  await assert.rejects(
    fetchGdeltBulkConflictEvents({ fetchImpl: async () => new Response('full manifest') }),
    /expected HTTP 206, got 200/,
  );
});

// ---------------------------------------------------------------------------
// Translingual stream (GDELT masterfilelist-translation.txt).
//
// Every conflict event used to come from an English-language publisher because
// only one of GDELT's two parallel bulk streams was ingested. The translingual
// half is schema-identical and keyed by the same GlobalEventID, so it merges
// through the existing dedup — but it is ADDITIVE, and these tests pin that it
// can never take down the stream that already worked.
// ---------------------------------------------------------------------------

const [ENGLISH_STREAM, TRANSLINGUAL_STREAM] = GDELT_EXPORT_STREAMS;

/** Route manifest reads per stream and serve each descriptor's own ZIP. */
function twoStreamFetch({ englishManifest, translingualManifest, zips, onRequest }) {
  return async (url, options) => {
    const href = String(url);
    onRequest?.(href, options);
    if (href.endsWith('masterfilelist-translation.txt')) {
      if (translingualManifest instanceof Error) throw translingualManifest;
      return new Response(translingualManifest, { status: 206 });
    }
    if (href.endsWith('masterfilelist.txt')) {
      if (englishManifest instanceof Error) throw englishManifest;
      return new Response(englishManifest, { status: 206 });
    }
    const zip = zips[href.split('/').pop()];
    if (!zip) throw new Error(`unexpected download: ${href}`);
    return new Response(zip);
  };
}

function manifestLine(name, zip) {
  return `${zip.length} ${createHash('md5').update(zip).digest('hex')} http://data.gdeltproject.org/gdeltv2/${name}.zip`;
}

test('parseGdeltRecentExports keeps the two streams from claiming each other\'s entries', () => {
  const englishLine = '123 0123456789abcdef0123456789abcdef http://data.gdeltproject.org/gdeltv2/20260713110000.export.CSV.zip';
  const translingualLine = '456 fedcba9876543210fedcba9876543210 http://data.gdeltproject.org/gdeltv2/20260713110000.translation.export.CSV.zip';

  // A translingual name also ends in `.export.CSV.zip`, so without the
  // timestamp anchor the English filter would accept it and then throw on the
  // descriptor parse instead of skipping it.
  assert.throws(
    () => parseGdeltRecentExports(translingualLine, 8, ENGLISH_STREAM),
    /no valid event exports/,
  );
  assert.throws(
    () => parseGdeltRecentExports(englishLine, 8, TRANSLINGUAL_STREAM),
    /no valid event exports/,
  );

  const [descriptor] = parseGdeltRecentExports(translingualLine, 1, TRANSLINGUAL_STREAM);
  assert.equal(descriptor.streamId, 'translingual');
  assert.equal(descriptor.infix, '.translation');
  assert.equal(descriptor.exportTimestamp, '20260713110000');
  assert.equal(
    descriptor.url,
    'https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/20260713110000.translation.export.CSV.zip',
  );
});

test('extractGdeltExportCsv pins the inner filename to its own stream', () => {
  const csv = gdeltRow();
  const translingualZip = makeStoredZip('20260713110000.translation.export.CSV', csv);

  assert.equal(
    extractGdeltExportCsv(translingualZip, '20260713110000', '.translation'),
    csv,
  );
  // An English descriptor must not accept a translingual archive: both are
  // well-formed and checksum-clean, so only the name distinguishes them.
  assert.throws(
    () => extractGdeltExportCsv(translingualZip, '20260713110000', ''),
    /unexpected GDELT event export filename/,
  );
  assert.throws(
    () => extractGdeltExportCsv(makeStoredZip('20260713110000.export.CSV', csv), '20260713110000', '.translation'),
    /unexpected GDELT event export filename/,
  );
});

test('fetchGdeltBulkConflictEvents merges both streams and dedups by event id', async () => {
  const englishZip = makeStoredZip('20260713110000.export.CSV', gdeltRow({ id: '1' }));
  // Same GlobalEventID as the English row plus one that only the translingual
  // stream carries — the shared id must collapse, the new one must survive.
  const translingualZip = makeStoredZip(
    '20260713104500.translation.export.CSV',
    `${gdeltRow({ id: '1' })}\n${gdeltRow({ id: '2' })}`,
  );

  const result = await fetchGdeltBulkConflictEvents({
    fetchImpl: twoStreamFetch({
      englishManifest: manifestLine('20260713110000.export.CSV', englishZip),
      translingualManifest: manifestLine('20260713104500.translation.export.CSV', translingualZip),
      zips: {
        '20260713110000.export.CSV.zip': englishZip,
        '20260713104500.translation.export.CSV.zip': translingualZip,
      },
    }),
  });

  assert.equal(result.exportsRequested, 2);
  assert.equal(result.exportsSucceeded, 2);
  assert.deepEqual(result.events.map((event) => event.id).sort(), ['gdelt-event-1', 'gdelt-event-2']);
  assert.deepEqual(result.eventsByStream, { english: 1, translingual: 2 });
  assert.deepEqual(result.streamFailures, []);
  // The translingual stream runs a slot behind, so it widens coverage backwards
  // without pretending the newest data is older than it is.
  assert.equal(result.exportTimestamp, '20260713110000');
  assert.equal(result.oldestExportTimestamp, '20260713104500');
});

test('fetchGdeltBulkConflictEvents degrades to English when the translingual manifest fails', async () => {
  const englishZip = makeStoredZip('20260713110000.export.CSV', gdeltRow({ id: '1' }));

  const result = await fetchGdeltBulkConflictEvents({
    fetchImpl: twoStreamFetch({
      englishManifest: manifestLine('20260713110000.export.CSV', englishZip),
      translingualManifest: new Error('translingual manifest 503'),
      zips: { '20260713110000.export.CSV.zip': englishZip },
    }),
  });

  assert.equal(result.events.length, 1);
  assert.deepEqual(result.eventsByStream, { english: 1 });
  assert.equal(result.streamFailures.length, 1);
  assert.match(result.streamFailures[0], /^translingual: /);
});

test('fetchGdeltBulkConflictEvents still fails closed when the English manifest fails', async () => {
  // The optional-stream escape hatch must not swallow the required one.
  await assert.rejects(
    fetchGdeltBulkConflictEvents({
      fetchImpl: twoStreamFetch({
        englishManifest: new Error('english manifest 503'),
        translingualManifest: 'ignored',
        zips: {},
      }),
    }),
    /english manifest 503/,
  );
});
