/**
 * A cancelled fetch is not evidence that a feed is empty.
 *
 * The regression this locks, measured on the running stack 2026-08-08:
 * `feedStatuses` reported 39 problem feeds at steady state, and five of them —
 * ABC News, Hacker News, The Hill, Bellingcat, Japan Today — answered HTTP 200
 * with items when called from inside the same container with the same headers.
 * They were not broken. They had been aborted as the build deadline
 * approached, the caller swallowed the AbortError as a null body, and the feed
 * was stamped `empty` AND written to the rss:feed cache for CACHE_TTL_EMPTY_S.
 *
 * That last part is what made it self-sustaining: the retry five minutes later
 * could land in another deadline-pressured build and re-stamp it, so a healthy
 * feed could stay "empty" indefinitely. It also made feedStatuses useless as a
 * health signal, which is how a list of "45 broken feeds" got written down
 * from feeds that were mostly fine.
 *
 * The distinction the code now draws: every other failure reason is a verdict
 * about upstream (it answered, and the answer was unusable), so the short
 * cache still applies as a retry throttle. `cancelled` is a verdict about us.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { __testing__ } from '../server/worldmonitor/news/v1/list-feed-digest';

const { fetchRssText, isAbortError, CACHE_TTL_EMPTY_S, FEED_TIMEOUT_MS } = __testing__;

const DIGEST_SRC = readFileSync(
  new URL('../server/worldmonitor/news/v1/list-feed-digest.ts', import.meta.url),
  'utf8',
);

const RSS_BODY = '<?xml version="1.0"?><rss version="2.0"><channel><item><title>x</title></item></channel></rss>';

/** Minimal stand-in for the parts of Response that fetchRssText touches. */
const response = (body: string, { ok = true, contentType = 'application/rss+xml' } = {}) => ({
  ok,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
  async arrayBuffer() { return new TextEncoder().encode(body).buffer; },
}) as unknown as Response;

const realFetch = globalThis.fetch;
const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  globalThis.fetch = ((url: string, init: RequestInit) => impl(url, init)) as typeof fetch;
};

describe('fetchRssText reports why it failed', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('returns the body when upstream answers with a feed', async () => {
    stubFetch(async () => response(RSS_BODY));
    const result = await fetchRssText('https://example.test/rss', new AbortController().signal);
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.text.includes('<item>'));
  });

  it('distinguishes an interstitial body from an empty feed', async () => {
    // PBS NewsHour's real shape: a 2xx with a body that is not a feed. This is
    // a verdict about upstream, so the caller is expected to cache it short.
    stubFetch(async () => response('<!DOCTYPE html><html><body>Checking your browser…</body></html>'));
    const result = await fetchRssText('https://example.test/rss', new AbortController().signal);
    assert.deepEqual(result, { ok: false, reason: 'not-rss' });
  });

  it('reports a non-OK status separately from a bad body', async () => {
    stubFetch(async () => response('', { ok: false }));
    const result = await fetchRssText('https://example.test/rss', new AbortController().signal);
    assert.deepEqual(result, { ok: false, reason: 'http-error' });
  });

  it('reports a network error as network, not as an empty feed', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed'); });
    const result = await fetchRssText('https://example.test/rss', new AbortController().signal);
    assert.deepEqual(result, { ok: false, reason: 'network' });
  });

  it('reports an abort as cancelled — the case that was being cached as empty', async () => {
    stubFetch(async (_url, init) => {
      // Reproduce what the deadline does: abort the linked signal mid-flight.
      const signal = (init as { signal: AbortSignal }).signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });
    const parent = new AbortController();
    const pending = fetchRssText('https://example.test/rss', parent.signal);
    parent.abort();
    assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
  });
});

describe('isAbortError', () => {
  it('recognises an AbortError regardless of message', () => {
    const err = new Error('anything');
    err.name = 'AbortError';
    assert.equal(isAbortError(err), true);
  });

  it('does not mistake other failures for cancellation', () => {
    assert.equal(isAbortError(new TypeError('fetch failed')), false);
    assert.equal(isAbortError(new Error('AbortError')), false, 'the message is not the name');
    assert.equal(isAbortError('AbortError'), false);
    assert.equal(isAbortError(null), false);
  });
});

describe('a cancellation is never written to the feed cache', () => {
  // fetchAndParseRss does network and Redis I/O and is not exported, so this
  // is a structural assertion in the style of digest-buildDigest-*.test.mjs.
  // The invariant is positional: the cancelled branch must return BEFORE the
  // setCachedJson call that stamps a feed empty.
  const body = DIGEST_SRC.slice(
    DIGEST_SRC.indexOf('async function fetchAndParseRss'),
    DIGEST_SRC.indexOf('// Date-tag priority lists'),
  );

  it('extracted the function body', () => {
    assert.ok(body.length > 500, 'failed to locate fetchAndParseRss');
  });

  it('returns on cancellation before reaching the empty-cache write', () => {
    const cancelledReturn = body.indexOf("outcome: 'cancelled'");
    const emptyCacheWrite = body.indexOf('setCachedJson(cacheKey, cachedFailure, CACHE_TTL_EMPTY_S)');
    assert.notEqual(cancelledReturn, -1, 'the cancelled branch must exist');
    assert.notEqual(emptyCacheWrite, -1, 'the short-cache write must still exist for real failures');
    assert.ok(
      cancelledReturn < emptyCacheWrite,
      'the cancelled branch must return before the empty-cache write, or a deadline abort poisons the cache again',
    );
  });

  it('still caches the failures that ARE evidence about upstream', () => {
    // not-rss and unreachable mean upstream answered unusably. Losing the
    // short cache for those would hammer a broken host every build.
    assert.ok(
      body.includes('outcome: outcomeForFailure(reason)'),
      'non-cancelled failures must still be classified and cached',
    );
  });

  it('keeps the empty-cache TTL short enough to recover', () => {
    assert.ok(CACHE_TTL_EMPTY_S > 0 && CACHE_TTL_EMPTY_S <= 900, `unexpected empty TTL ${CACHE_TTL_EMPTY_S}`);
    assert.ok(FEED_TIMEOUT_MS > 0 && FEED_TIMEOUT_MS < 30_000, `unexpected feed timeout ${FEED_TIMEOUT_MS}`);
  });
});

describe('feedStatuses stays a problem-only map', () => {
  const buildDigest = DIGEST_SRC.slice(DIGEST_SRC.indexOf('async function buildDigest'));

  it('never records a healthy or cache-served feed', () => {
    // The payload ships on every response, so healthy feeds must stay out of
    // it — the constraint tests/digest-no-reclassify.test.mjs also guards.
    assert.ok(
      buildDigest.includes("result.outcome !== 'ok' && result.outcome !== 'cached'"),
      "feedStatuses must skip 'ok' and 'cached' outcomes",
    );
  });

  it('keeps the date classifications spelled as log aggregation expects', () => {
    for (const status of ['all-undated', 'partial-undated']) {
      assert.ok(buildDigest.includes(`'${status}'`), `${status} must survive — it is keyword-matched`);
    }
  });
});

/**
 * Feed fetching must not use a barrier.
 *
 * Measured cold on 2026-08-08: 99 feeds reported `timeout` — never begun — and
 * the digest shipped 129 items against a warm-cache 272. The cause was the
 * batch loop awaiting Promise.allSettled per batch, so every batch cost its
 * slowest member. With FEED_TIMEOUT_MS at 8s inside a 10s OVERALL_DEADLINE_MS,
 * one hung feed spent 80% of the build's budget while the other 19 slots in
 * its batch idled and everything behind it never started.
 */
describe('feed fetching runs as a pool, not synchronised batches', () => {
  const buildDigest = DIGEST_SRC.slice(DIGEST_SRC.indexOf('async function buildDigest'));

  it('does not await a barrier over a slice of feeds', () => {
    assert.ok(
      !/Promise\.allSettled\(\s*batch/.test(buildDigest),
      'a per-batch barrier makes every batch cost its slowest feed',
    );
    assert.ok(
      !/for \(let i = 0; i < allEntries\.length; i \+= /.test(buildDigest),
      'stepping through allEntries in fixed strides is the batched shape',
    );
  });

  it('pulls from one shared queue so a slow feed occupies one worker', () => {
    assert.ok(buildDigest.includes('nextEntryIndex++'), 'workers must share a cursor');
    assert.ok(
      /Math\.min\(resolveFeedConcurrency\(\), allEntries\.length\)/.test(buildDigest),
      'worker count must be bounded by concurrency AND by how many feeds exist',
    );
  });

  it('keeps a single feed failure from killing its worker', () => {
    // Promise.allSettled absorbed this per batch; a worker loop has to catch.
    const worker = buildDigest.slice(
      buildDigest.indexOf('const runWorker'),
      buildDigest.indexOf('await Promise.all('),
    );
    assert.ok(worker.includes('} catch {'), 'the worker body must swallow a per-feed throw');
  });

  it('bounds the concurrency override so it cannot be set absurdly', () => {
    const resolver = DIGEST_SRC.slice(
      DIGEST_SRC.indexOf('function resolveFeedConcurrency'),
      DIGEST_SRC.indexOf('function resolveFeedConcurrency') + 400,
    );
    assert.ok(/raw > 0 && raw <= 64/.test(resolver), 'the override must be range-checked');
    assert.ok(
      /FEED_FETCH_CONCURRENCY_DEFAULT/.test(resolver),
      'an unparseable or out-of-range value must fall back to the default',
    );
  });

  it('still stops promptly when the build deadline fires', () => {
    assert.ok(
      /while \(!deadlineController\.signal\.aborted\)/.test(buildDigest),
      'workers must check the deadline between feeds, not run the queue dry',
    );
  });
});

/**
 * A cached failure keeps saying why.
 *
 * The gap this closes, measured 2026-08-08: eight healthy feeds — ABC News,
 * Atlantic Council, Civil.ge, Correctiv, Financial Times, Japan Today, The Hill
 * and ThisDay — failed under the cold round's full ~460-feed load and were
 * correctly stamped `unreachable`. The reason was then thrown away: the cached
 * row carried only an empty item list, so every request inside the 300s window
 * reported a flat `empty`. That is why the steady-state list read as though it
 * were full of working feeds being slandered, and why the diagnosis took three
 * rounds of measurement to reach.
 *
 * The invariant: reasons belong to the ROW (they describe why it was written
 * and they expire with it); outcomes belong to the ATTEMPT and must not be
 * cached. A genuinely empty parse still carries no reason — calling that a
 * failure would recreate the conflation from the other direction.
 */
describe('a cached failure carries its reason', () => {
  const body = DIGEST_SRC.slice(
    DIGEST_SRC.indexOf('async function fetchAndParseRss'),
    DIGEST_SRC.indexOf('// Date-tag priority lists'),
  );

  it('bumps the cache prefix, because warm rows lack the new field', () => {
    // The repo's established pattern for a ParseResult shape change — the same
    // reasoning as the v5→v6 droppedFeedCap bump.
    assert.ok(
      DIGEST_SRC.includes('`rss:feed:v9:${variant}:${feed.url}`'),
      'adding a field to the cached struct requires a prefix bump',
    );
    assert.ok(
      !DIGEST_SRC.includes('`rss:feed:v8:${variant}:${feed.url}`'),
      'no residual v8 key may remain',
    );
  });

  it('writes the reason into the row it caches', () => {
    assert.ok(
      /failureReason: reason/.test(body),
      'the short-cached failure row must record why it failed',
    );
  });

  it('reads the reason back instead of flattening it to empty', () => {
    assert.ok(
      /cached\.failureReason \? outcomeForFailure\(cached\.failureReason\) : 'cached'/.test(body),
      'a cache hit must report the stored reason, and only healthy rows may read as cached',
    );
  });

  it('does not label a genuinely empty parse as a failure', () => {
    // parsedTotal === 0 from a successful parse is upstream having nothing.
    // Only the null-parse branch (unusable body) gets a reason.
    assert.ok(
      body.includes("failureReason: 'not-rss',"),
      'a null parse is upstream answering unusably, so it carries a reason',
    );
    assert.ok(
      /outcome: result\.parsedTotal > 0[\s\S]{0,160}: 'empty'/.test(body),
      'a parse that simply found nothing must still read as empty, not as a failure',
    );
  });

  it('still never caches a cancellation, reason or not', () => {
    const cancelledReturn = body.indexOf("outcome: 'cancelled'");
    const firstCacheWrite = body.indexOf('setCachedJson(cacheKey, cachedFailure');
    assert.ok(cancelledReturn !== -1 && firstCacheWrite !== -1);
    assert.ok(
      cancelledReturn < firstCacheWrite,
      'the cancelled branch must still return before any failure row is written',
    );
  });
});

/**
 * Feed concurrency is a measured value, and the measurement refuted the
 * hypothesis it was made to test.
 *
 * The suspicion was that the pool's sustained concurrency caused healthy feeds
 * to return unreachable, so lowering it should help. Sweeping 8/20/40 from a
 * fully cold cache on the deployment target gave the opposite: more workers,
 * fewer failures, and at 40 the first cold request already returns the full
 * steady-state digest (273 items, reproduced three times) instead of the
 * 203-208 that 8 and 20 delivered.
 */
describe('feed concurrency default', () => {
  it('is the measured value, not the pre-measurement one', () => {
    assert.equal(
      __testing__.FEED_FETCH_CONCURRENCY_DEFAULT,
      40,
      'the sweep settled on 40; changing it should come with a new measurement',
    );
  });

  it('stays under the cap its own resolver enforces', () => {
    assert.ok(__testing__.FEED_FETCH_CONCURRENCY_DEFAULT <= 64);
  });

  it('leaves room for the deadline to matter', () => {
    // Concurrency only helps while feeds still fit inside the build deadline.
    assert.ok(
      __testing__.FEED_TIMEOUT_MS < __testing__.OVERALL_DEADLINE_MS,
      'a per-feed budget at or above the overall deadline makes the per-feed timeout unreachable',
    );
  });
});
