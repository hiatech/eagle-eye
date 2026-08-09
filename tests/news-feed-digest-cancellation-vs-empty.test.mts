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
    const emptyCacheWrite = body.indexOf(`setCachedJson(cacheKey, empty, CACHE_TTL_EMPTY_S)`);
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
      body.includes("outcome: failure === 'not-rss' ? 'not-rss' : 'unreachable'"),
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
