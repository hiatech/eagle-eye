import type {
  ServerContext,
  ListFeedDigestRequest,
  ListFeedDigestResponse,
  CategoryBucket,
  NewsItem as ProtoNewsItem,
  ThreatLevel as ProtoThreatLevel,
  StoryMeta as ProtoStoryMeta,
  StoryPhase as ProtoStoryPhase,
} from '../../../../src/generated/server/eagleeye/news/v1/service_server';
import { cachedFetchJson, getCachedJson, setCachedJson, getCachedJsonBatch, runRedisPipeline } from '../../../_shared/redis';
import { markNoCacheResponse } from '../../../_shared/response-headers';
import { sha256Hex } from '../../../_shared/hash';
import { CHROME_UA } from '../../../_shared/constants';
import {
  isServerFeedReachableForLanguage,
  resolveServerFeedUrl,
  VARIANT_FEEDS,
  INTEL_SOURCES,
  type ServerFeed,
} from './_feeds';

/**
 * A ServerFeed whose locale map has already been resolved for the request's
 * language. Everything past buildDigest's entry assembly works with this, so
 * the fetch/cache/telemetry path never has to know a feed can be multi-URL.
 */
type ResolvedServerFeed = Omit<ServerFeed, 'url'> & { url: string };
import { classifyByKeyword, hasHistoricalMarker, type ThreatLevel } from './_classifier';
import { assignStoryIdentity, adoptExistingCanonical } from './dedup.mjs';
import { classifyOpinion } from '../../../_shared/opinion-classifier.js';
import { classifyFeelGood } from '../../../_shared/feelgood-classifier.js';
import { classifyEphemeralLiveCoverage } from '../../../../shared/ephemeral-live-classifier.js';
import { buildTickerDictionary, extractTickers } from '../../../../shared/ticker-extract.js';
import stocksData from '../../../../shared/stocks.json';
import { buildClassifyCacheKey } from '../../intelligence/v1/_shared';
import { getSourceTier } from '../../../_shared/source-tiers';
import {
  STORY_TRACK_KEY,
  STORY_SOURCES_KEY,
  STORY_PEAK_KEY,
  STORY_ALIAS_KEY,
  DIGEST_ACCUMULATOR_KEY,
  STORY_TTL,
  DIGEST_ACCUMULATOR_TTL,
} from '../../../_shared/cache-keys';
import { getRelayBaseUrl, getRelayHeaders } from '../../../_shared/relay';
import diplomacyKeywordsData from '../../../../shared/diplomacy-keywords.json';

const RSS_ACCEPT = 'application/rss+xml, application/xml, text/xml, */*';

const VALID_VARIANTS = new Set(['full', 'tech', 'finance', 'happy', 'commodity']);
const fallbackDigestCache = new Map<string, { data: ListFeedDigestResponse; ts: number }>();
const ITEMS_PER_FEED = 5;
const MAX_ITEMS_PER_CATEGORY = 20;
/**
 * Slots per category held for sources written in the reader's own language.
 *
 * Without this the reserve is zero and native sources are simply outranked. A
 * live measurement on 2026-08-08 read the digest for eight non-English UI
 * languages: all eight returned byte-identical results and not one of the ~40
 * newly added native sources appeared. They had been fetched and parsed — the
 * per-feed statuses showed no errors — and then every item ranked below the
 * cap. `cs`/europe held 20 items from 13 sources, all English-pool.
 *
 * The deciding variable is how crowded the category already is: the Brazilian
 * pack takes 15 of latam's 20 slots because latam has ~11 sources, while
 * europe (~90) and asia (~61) admit none. So this cannot be fixed by adding
 * more sources — in a saturated category no pack is ever large enough.
 *
 * 8 of 20 leaves the majority of every category to the global ranking. The
 * reserve is a ceiling, not a quota: unused slots fall back to normal ranking,
 * so a language with two native sources loses nothing.
 */
const NATIVE_LANGUAGE_RESERVED_SLOTS = 8;
/**
 * The language the untagged feed pool is written in — untagged feeds reach
 * every locale and are the bulk of both catalogs. Mirrors `universalPoolLanguage`
 * in shared/language-coverage-policy.json, duplicated as a constant because
 * Vercel's esbuild rejects JSON import attributes in bundled Edge code (the
 * same reason api/_rss-allowed-domains.js keeps a literal array).
 */
const UNIVERSAL_POOL_LANGUAGE = 'en';
const FEED_TIMEOUT_MS = 8_000;
// Vercel Edge functions have a 25s initial-response ceiling. The digest
// must fail closed to the warmed in-isolate fallback before the platform does.
const VERCEL_INITIAL_RESPONSE_LIMIT_MS = 25_000;
const DIGEST_RESPONSE_TIMEOUT_MS = 14_000;
const POST_FETCH_HEADROOM_MS = 15_000;
const RESPONSE_GUARD_BAND_MS = 3_000;
const OVERALL_DEADLINE_MS = VERCEL_INITIAL_RESPONSE_LIMIT_MS - POST_FETCH_HEADROOM_MS;
const FEED_FETCH_CONCURRENCY_DEFAULT = 40;
/**
 * How many feed fetches are in flight at once (default 20, env override
 * NEWS_FEED_CONCURRENCY). Same shape as resolveMaxAgeMs — out-of-range or
 * unparseable values fall back silently.
 *
 * 40 is measured, not guessed, and it refuted the hypothesis it was meant to
 * test. The suspicion was that the pool's sustained concurrency was what made
 * healthy feeds come back `unreachable`, so lowering it should help. Sweeping
 * 8 / 20 / 40 on the deployment target (own server + Docker), each from a fully
 * cold cache:
 *
 *   8   cold 208 items, 50 timeout   steady 25 unreachable
 *   20  cold 203 items, 35 timeout   steady 23 unreachable
 *   40  cold 273 items,  0 timeout   steady 17 unreachable
 *
 * More concurrency gave FEWER failures, not more, and at 40 the first cold
 * request already returns the full steady-state digest — the cold-start
 * shortfall disappears rather than shrinking. Reproduced three times at 40:
 * 273 items every run. The unreachable count wanders (16-28 across runs) and is
 * noise; the item count is the stable signal.
 *
 * So the remaining unreachable feeds are not load casualties. Whatever is
 * wrong with them is not something this number fixes.
 *
 * Still overridable, because this was measured in one environment and the next
 * may answer differently.
 *
 * Capped at 64: past that the ceiling stops being ours and starts being the
 * host's socket and DNS limits, which fail in less legible ways.
 */
function resolveFeedConcurrency(): number {
  const raw = Number.parseInt(process.env.NEWS_FEED_CONCURRENCY ?? '', 10);
  return Number.isInteger(raw) && raw > 0 && raw <= 64 ? raw : FEED_FETCH_CONCURRENCY_DEFAULT;
}

// U3 — hard freshness floor (default 96h, env override NEWS_MAX_AGE_HOURS).
// Items older than this are dropped before scoring. The 24h `recencyScore`
// component already treats anything older than 24h as zero recency, so the
// freshness floor is purely a "don't surface week-old news" guard, not a
// scoring input.
//
// 2026-05-03: bumped 48 → 96 after a production incident where every
// single-source category panel (GitHub Trending: github.blog/feed/, Product
// Hunt: producthunt.com/feed) went UNAVAILABLE over a weekend. Both feeds
// publish on a weekday cadence; over a Sat-Sun window their newest item
// sits at ~50-70h old, which the 48h floor wholesale dropped → category
// renders zero items → panel reads "UNAVAILABLE". 96h covers a Fri→Mon
// weekend with margin so we don't flip empty on Sunday-night dashboard
// checks. The 24h recencyScore still naturally de-ranks 48-96h items vs
// anything fresher, so the visible-but-de-ranked outcome is correct:
// better than "no news" but lower priority than today.
//
// Out-of-range / unparseable env values fall back to the default silently.
// See R3 in docs/plans/2026-04-26-001-fix-brief-static-page-contamination-plan.md.
function resolveMaxAgeMs(): number {
  const raw = Number.parseInt(process.env.NEWS_MAX_AGE_HOURS ?? '', 10);
  const hours = Number.isInteger(raw) && raw > 0 ? raw : 96;
  return hours * 60 * 60 * 1000;
}

const LEVEL_TO_PROTO: Record<ThreatLevel, ProtoThreatLevel> = {
  critical: 'THREAT_LEVEL_CRITICAL',
  high: 'THREAT_LEVEL_HIGH',
  medium: 'THREAT_LEVEL_MEDIUM',
  low: 'THREAT_LEVEL_LOW',
  info: 'THREAT_LEVEL_UNSPECIFIED',
};

/** Numeric severity values for importanceScore computation (0–100). */
const SEVERITY_SCORES: Record<ThreatLevel, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 0,
};

/**
 * Ordinal rank of each threat level, used by the LLM classify-cache
 * upgrade cap (U4). Cap = +2 tiers above the keyword classification.
 *
 * Rationale: keyword=info (no-match fallback at confidence 0.3) jumping
 * straight to high/critical is the static-institutional-page contamination
 * path; capping at info+2=medium blocks it. Cap behavior by keyword:
 *   info(0)+2=medium    — blocks info→{high,critical} (the contamination class)
 *   low(1)+2=high       — preserves low→{medium,high}; caps low→critical at high
 *   medium(2)+2=critical — preserves medium→{high,critical} (e.g. "Markets crash" → critical)
 *   high(3)+2=critical  — passes through (existing 0.9-confidence guard at
 *                         enrichWithAiCache also skips cache for keyword=critical)
 *
 * The keyword=low → LLM=critical case (capped at high) is the bounded
 * loss; logged on every cap-fire so operators can audit if any are real.
 * See R4 in the plan.
 */
const LEVEL_RANK: Record<ThreatLevel, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const RANK_TO_LEVEL: ThreatLevel[] = ['info', 'low', 'medium', 'high', 'critical'];

/**
 * Cap an LLM-classified level to at most +2 tiers above the keyword level.
 * Returns the original `llmLevel` when within the cap, otherwise the
 * level at rank `keywordRank + 2`. Falls back to the keyword level when
 * the LLM level is unrecognized (defensive).
 */
function capLlmUpgrade(keywordLevel: ThreatLevel, llmLevel: string): ThreatLevel {
  const keywordRank = LEVEL_RANK[keywordLevel];
  const rawLlmRank = LEVEL_RANK[llmLevel as ThreatLevel];
  if (rawLlmRank == null) return keywordLevel;
  const cappedRank = Math.min(rawLlmRank, keywordRank + 2);
  return RANK_TO_LEVEL[cappedRank] ?? keywordLevel;
}

/**
 * Importance score component weights (must sum to 1.0).
 * Severity dominates because threat level is the primary signal.
 * Corroboration (independent sources) strongly validates an event.
 * Source tier boosts confidence. Recency is a minor tiebreaker.
 */
const SCORE_WEIGHTS = {
  severity: 0.55,
  sourceTier: 0.2,
  corroboration: 0.15,
  recency: 0.1,
} as const;

const DIPLOMACY_KEYWORDS: readonly string[] = diplomacyKeywordsData.diplomacyKeywords;
const FLASHPOINT_SCORING_KEYWORDS: readonly string[] = diplomacyKeywordsData.flashpointKeywords;
// JSON imports type each pair as `string[]` (length not statically tracked).
// The runtime shape is `[string, string]` — enforced by
// tests/diplomacy-keywords-parity.test.mjs against the canonical JSON.
const DIPLOMACY_FLASHPOINT_PAIRS: ReadonlyArray<readonly [string, string]> =
  diplomacyKeywordsData.diplomacyFlashpointPairs as unknown as ReadonlyArray<readonly [string, string]>;

// #4922a: compiled once — the company-name alternation regex is the
// expensive part of ticker extraction.
const TICKER_DICTIONARY = buildTickerDictionary(stocksData.symbols);

const DIPLOMACY_FLASHPOINT_BOOST = 18;
const ENTITY_CORROBORATION_SCORE_PER_SOURCE = 4;
const ENTITY_CORROBORATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const DIPLOMACY_SEVERITY_PROMOTION_MIN_TIER12_SOURCES = 3;


interface ParsedItem {
  source: string;
  title: string;
  link: string;
  publishedAt: number;
  isAlert: boolean;
  level: ThreatLevel;
  category: string;
  confidence: number;
  classSource: 'keyword' | 'keyword-historical-downgrade' | 'llm';
  importanceScore: number;
  corroborationCount: number;
  entityCorroborationCount: number;
  titleHash?: string;
  lang: string;
  // Cleaned RSS/Atom article description: HTML-stripped, entity-decoded,
  // whitespace-normalised, clipped to MAX_DESCRIPTION_LEN. Empty string when
  // absent, too short, or indistinguishable from the headline. Grounding input
  // for brief / whyMatters / SummarizeArticle LLMs.
  description: string;
  // Non-event brief classification (classifyOpinion over title + link +
  // description). Persisted on the legacy `isOpinion` story:track:v1 field
  // so buildDigest can exclude op-ed/column and historical-explainer content
  // — the brief is event-driven intelligence, not an editorial or look-back
  // feed. See
  // docs/plans/2026-05-14-001-…-plan.md (F3). story:track rows feed more
  // than the brief, so this STAMPS rather than drops — only buildDigest
  // filters on it.
  isOpinion: boolean;
  // Feel-good / lifestyle classification (classifyFeelGood over title +
  // link + description). Sibling stamp to isOpinion — same persistence,
  // same buildDigest read-path filter. The brief is event-driven; a
  // vintage-warplane veterans' reunion in a 9,800-person town is not an
  // event. See docs/plans/2026-05-17-001-fix-feelgood-lifestyle-filter-plan.md
  // (Veterans-warplanes anchor case, May 17 0802 brief).
  isFeelGood: boolean;
  // Ephemeral live-programming classification. "WATCH LIVE: ..." and
  // live briefing/hearing previews are not durable event stories for a
  // delayed digest/brief, even when conflict vocabulary makes them score high.
  // Stamped here and re-classified by buildDigest for pre-stamp residue.
  isEphemeralLiveCoverage: boolean;
  // #4922a: stock tickers extracted at parse time from title + description
  // (cashtags + shared/stocks.json company names). Uppercase, deduped,
  // ≤8 (proto NewsItem.tickers max_items=8). Optional so items rehydrated
  // from pre-rollout cache rows stay valid; toProtoItem defaults to [].
  tickers?: string[];
}

const MAX_DESCRIPTION_LEN = 400;
const MIN_DESCRIPTION_LEN = 40;

const DESCRIPTION_TAG_PRIORITY = {
  rss: ['description', 'content:encoded'] as const,
  atom: ['summary', 'content'] as const,
};

interface ImportanceScoreContext {
  title?: string;
  classSource?: ParsedItem['classSource'] | string;
  entityCorroborationCount?: number;
}

function normalizeScoringText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Word-start containment in normalized text. Mirrors
// shared/brief-filter.js:containsKeywordToken — prevents 'pact' inside
// 'impact' (false positive) while still matching 'iran' inside
// 'iranian' (demonym preserved). PR #3909 review (P2).
function containsKeywordToken(text: string, kw: string): boolean {
  if (!kw) return false;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}`).test(text);
}

function hasAnySignal(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => containsKeywordToken(text, kw));
}

function hasDiplomacyFlashpointSignal(title: string | undefined): boolean {
  if (!title) return false;
  const text = normalizeScoringText(title);
  if (
    DIPLOMACY_FLASHPOINT_PAIRS.some(([entity, action]) =>
      containsKeywordToken(text, entity) && containsKeywordToken(text, action),
    )
  ) {
    return true;
  }
  return hasAnySignal(text, DIPLOMACY_KEYWORDS) && hasAnySignal(text, FLASHPOINT_SCORING_KEYWORDS);
}

function promoteDiplomacySeverity(
  level: ThreatLevel,
  title: string | undefined,
  tier12SourceCount: number,
): ThreatLevel {
  if (level === 'critical' || level === 'high') return level;
  if (!title || hasHistoricalMarker(title)) return level;
  const finite = Number.isFinite(tier12SourceCount) ? Number(tier12SourceCount) : 0;
  if (
    finite >= DIPLOMACY_SEVERITY_PROMOTION_MIN_TIER12_SOURCES &&
    hasDiplomacyFlashpointSignal(title)
  ) {
    return 'high';
  }
  return level;
}

function diplomacyFlashpointBoost(title: string | undefined): number {
  return hasDiplomacyFlashpointSignal(title) ? DIPLOMACY_FLASHPOINT_BOOST : 0;
}

function entityCorroborationScore(count: number | undefined): number {
  const finite = Number.isFinite(count) ? Number(count) : 0;
  return Math.min(Math.max(finite, 0), 5) * ENTITY_CORROBORATION_SCORE_PER_SOURCE;
}

function computeImportanceScore(
  level: ThreatLevel,
  source: string,
  corroborationCount: number,
  publishedAt: number,
  context: ImportanceScoreContext = {},
): number {
  const tier = getSourceTier(source);
  const tierScore = tier === 1 ? 100 : tier === 2 ? 75 : tier === 3 ? 50 : 25;
  const corroborationScore = Math.min(corroborationCount, 5) * 20;
  const ageMs = Date.now() - publishedAt;
  const recencyScore = Math.max(0, 1 - ageMs / (24 * 60 * 60 * 1000)) * 100;
  const base = Math.round(
    SEVERITY_SCORES[level] * SCORE_WEIGHTS.severity +
    tierScore * SCORE_WEIGHTS.sourceTier +
    corroborationScore * SCORE_WEIGHTS.corroboration +
    recencyScore * SCORE_WEIGHTS.recency,
  );
  return Math.round(
    base +
    diplomacyFlashpointBoost(context.title) +
    entityCorroborationScore(context.entityCorroborationCount),
  );
}

function createTimeoutLinkedController(parentSignal: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onAbort, { once: true });

  return {
    controller,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Sniff a response body to decide whether it looks like RSS/Atom/RDF.
 *
 * Some upstreams (Cloudflare-protected sites, captcha gateways, login walls)
 * return HTTP 200 with an HTML interstitial body when the requesting IP is
 * challenged — Vercel egress IPs are common targets. Without sniffing, the
 * caller forwards the HTML to parseRssXml, which finds zero `<item>` tags
 * and returns an empty ParseResult. That empty result then sits in Redis
 * cache for the full feed TTL (1h), pinning the panel to "No news available"
 * for an hour even after upstream recovers. Sniffing rejects these bodies
 * up front so the relay-fallback path fires and the cache stays clean.
 *
 * Heuristic:
 *   - Reject `<!DOCTYPE html>` / `<html ...>` (HTML wall pages)
 *   - Accept `<rss ...>` (RSS 2.0)
 *   - Accept `<feed ...>` (Atom 1.0)
 *   - Accept `<rdf:RDF ...>` (RSS 1.0 / Dublin Core RDF — Nature News,
 *     Asahi Shimbun, Slashdot, and other long-running feeds still emit
 *     this dialect; parseRssXml handles their `<item>` blocks fine)
 *   - Reject everything else as ambiguous (defensive — a feed without
 *     any of these signatures in the first 2KB is implausible)
 *
 * Exported for direct unit testing.
 */
export function looksLikeRssXml(text: string): boolean {
  const head = text.slice(0, 2048).toLowerCase();
  if (/<!doctype\s+html|<html[\s>]/.test(head)) return false;
  return /<rss[\s>]|<feed[\s>]|<rdf:rdf[\s>]/.test(head);
}

/**
 * Decode an RSS body using the encoding the publisher actually declared.
 *
 * `Response.text()` reads the charset from the `Content-Type` header and
 * silently assumes UTF-8 when there isn't one — it never looks at the XML
 * prolog. Publishers that serve legacy encodings without a charset parameter
 * therefore arrive as replacement characters: Folha de S.Paulo sends
 * `Content-Type: text/xml` over an `encoding="ISO-8859-1"` body, and a single
 * fetch lands ~950 U+FFFD in the digest — every accented Portuguese headline
 * mangled before it reaches the brief LLM.
 *
 * Header charset wins (it is the authoritative transport-level statement);
 * the prolog is the fallback; UTF-8 is the default. An encoding label Node
 * doesn't know falls back to UTF-8 rather than throwing, because a feed we
 * can't name the encoding of is still better read optimistically than dropped.
 *
 * Exported for direct unit testing.
 */
export function decodeRssBody(bytes: ArrayBuffer, contentType: string | null): string {
  const headerCharset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  // The prolog is ASCII-compatible in every encoding we could be facing here,
  // so reading the first bytes as iso-8859-1 is safe for the declaration
  // itself. TextDecoder (not Buffer) because this file has no Node built-ins
  // and must stay runtime-agnostic.
  const prologCharset = headerCharset
    ? undefined
    : /^<\?xml[^>]*\bencoding=["']([\w-]+)["']/i
      .exec(new TextDecoder('iso-8859-1').decode(bytes.slice(0, 256)))?.[1];
  const label = headerCharset ?? prologCharset ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Why a fetch produced no usable body.
 *
 * The distinction that matters is `cancelled` versus everything else. The
 * other reasons are verdicts about the upstream — it answered, and what it
 * answered with was unusable. `cancelled` is a verdict about US: the request
 * was aborted because this feed's 8s budget or the whole build's deadline ran
 * out, and upstream may be perfectly healthy. Caching that as "empty" is what
 * made the failure self-sustaining, so the caller keys on it.
 */
type FetchFailureReason = 'http-error' | 'not-rss' | 'network' | 'cancelled';

type FetchAttempt =
  | { ok: true; text: string }
  | { ok: false; reason: FetchFailureReason; code?: string };

/**
 * Whether a thrown fetch was our own cancellation.
 *
 * `signal` is the authority, not the error. undici rejects with a DOMException
 * named AbortError, but the Docker self-host runs the sidecar's fetch
 * replacement (src-tauri/sidecar/local-api-server.mjs), which rejects with a
 * plain `Error('aborted by signal')` — name `Error`, invisible to a name check.
 *
 * That gap silently undid the fix it was written for: measured 2026-08-08,
 * 19 feeds per cold build reported `network/aborted`, so every deadline
 * cancellation in the deployment target was classified as a real failure and
 * cached for CACHE_TTL_EMPTY_S — precisely the self-sustaining behaviour that
 * separating cancellation from empty was meant to end.
 *
 * Asking the controller avoids depending on any runtime's error shape or on
 * another module's message text.
 */
function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * The transport-level code behind a thrown fetch, for telemetry only.
 *
 * `network` covers everything from a refused connection to a TLS failure to a
 * socket the peer reset, and those want different fixes. undici hides the real
 * one under `cause`. Diagnosing the 2026-08-08 unreachable set stalled exactly
 * here: concurrency, relay health, relay headers and DNS were each measured and
 * cleared, and the one datum never captured was this.
 */
function fetchErrorCode(err: unknown): string {
  if (!(err instanceof Error)) return 'non-error';
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message.slice(0, 40);
  }
  return err.message.slice(0, 40);
}

async function fetchRssText(
  url: string,
  signal: AbortSignal,
): Promise<FetchAttempt> {
  const { controller, cleanup } = createTimeoutLinkedController(signal);

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    if (!resp.ok) return { ok: false, reason: 'http-error' };
    const text = decodeRssBody(await resp.arrayBuffer(), resp.headers.get('content-type'));
    // Defensive: upstream may return HTTP 200 with an HTML interstitial
    // (Cloudflare bot challenge, captcha page). Reject up front so the
    // caller's relay fallback fires instead of caching an empty parse.
    if (!looksLikeRssXml(text)) return { ok: false, reason: 'not-rss' };
    return { ok: true, text };
  } catch (err) {
    if (isAbortError(err, controller.signal)) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'network', code: fetchErrorCode(err) };
  } finally {
    cleanup();
  }
}

/**
 * Parser output: items that survived all parse-time gates plus per-feed
 * stats so the caller can classify feed health (e.g. silent zeroing from
 * an unrecognized date dialect — see U2 in
 * docs/plans/2026-04-26-001-fix-brief-static-page-contamination-plan.md).
 */
interface ParseResult {
  items: ParsedItem[];
  parsedTotal: number;     // count of <item>/<entry> blocks attempted
  droppedUndated: number;  // count dropped because every recognized date tag was empty/unparseable/future
  droppedFeedCap?: number; // #4920: items beyond ITEMS_PER_FEED, previously uncounted
  /**
   * Why this entry is empty, when it is empty because the fetch failed rather
   * than because upstream had nothing. Absent on healthy parses and on
   * genuinely empty ones.
   *
   * This IS a property of the cached content, not of the request that read it:
   * it records why the row was written, and it expires with the row. That is
   * the distinction against FeedOutcome below, which describes an attempt and
   * therefore must not be cached.
   *
   * Without it the reason survived exactly one request. Measured 2026-08-08:
   * eight healthy feeds (ABC News, The Hill, Financial Times and others) failed
   * under the cold round's full load, were stamped `unreachable`, and then
   * every request inside the 300s window read the cache and reported a flat
   * `empty` — which is what made the steady-state list look like it was full of
   * working feeds being slandered.
   */
  failureReason?: FetchFailureReason;
}

/**
 * What became of one feed on this build. Deliberately NOT part of ParseResult:
 * a cached row must never assert an outcome belonging to the request that
 * wrote it. `failureReason` above is the part that legitimately survives,
 * because it describes the row rather than the attempt.
 */
type FeedOutcome =
  | 'cached'      // served from rss:feed, and that row was healthy
  | 'ok'          // fetched and parsed with items
  | 'empty'       // fetched and parsed cleanly, upstream really has no items
  | 'not-rss'     // answered, but the body is an interstitial rather than a feed
  | 'unreachable' // network error or non-OK status on both direct and relay
  | 'cancelled';  // our 8s feed budget or the build deadline cut it off

/** The outcome a failure reason implies, whether read live or out of cache. */
function outcomeForFailure(reason: FetchFailureReason): FeedOutcome {
  if (reason === 'cancelled') return 'cancelled';
  return reason === 'not-rss' ? 'not-rss' : 'unreachable';
}

interface FetchResult extends ParseResult {
  outcome: FeedOutcome;
}

// Cache TTLs: a successful parse (parsedTotal > 0) caches for an hour to
// match the existing aggressive-caching behaviour. A zero-from-zero result
// (no `<item>` tags found at all) caches for only 5 minutes — without this
// split, a single upstream-CF-challenge or transient outage would pin the
// panel to "No news available" for the full hour. 5min keeps load on
// upstream bounded while still recovering quickly when upstream heals.
const CACHE_TTL_HEALTHY_S = 3600;
const CACHE_TTL_EMPTY_S = 300;

async function fetchAndParseRss(
  feed: ResolvedServerFeed,
  variant: string,
  signal: AbortSignal,
): Promise<FetchResult> {
  // v5 cache shape: identical struct to v4 but a new prefix invalidates
  // every pre-fix entry on deploy. v4 entries cached pre-PR contain
  // ParsedItems without the new isEphemeralLiveCoverage field. If a cache hit
  // returned one of those, buildStoryTrackHsetFields would write
  // `'isEphemeralLiveCoverage', undefined ? '1' : '0'` → '0' onto the
  // story:track:v1 row, and buildDigest's stampMissing check would treat
  // '0' as a genuine "not ephemeral live" verdict and skip the residue catch.
  // Live-programming teasers could then silently slip through during the 1h
  // healthy-cache rollout window. Bumping the prefix forces cold parseRssXml
  // runs that stamp isEphemeralLiveCoverage correctly.
  //
  // (Same class of cache-prefix bump as v2→v3 and v3→v4, which this codebase
  // already established as the correct cutover pattern for parsed-cache
  // shape changes.)
  // v5→v6 (#4920 review): ParseResult gained droppedFeedCap; warm v5 rows
  // lack it and would undercount the coverage ledger for their whole TTL.
  // v6→v7: ParsedItems now stamp historical explainers using their persisted
  // publishedAt. Digest reads deliberately trust explicit isOpinion stamps,
  // so warm v6 rows could retain an earlier "0" verdict for one cache TTL.
  // Force a cold parse to stamp the stable ingest-time verdict immediately.
  // v7→v8: extend the same exclusion policy to duration-led anniversary
  // explainers ("10 years on from …"). Warm v7 rows already carry an
  // authoritative isOpinion="0", so force another cold parse on rollout.
  // v8→v9: ParseResult gained failureReason. Same class as the v5→v6 bump —
  // warm v8 rows lack the field, so an entry written because a fetch failed
  // would report a bare `empty` for its whole TTL and keep feedStatuses
  // unable to distinguish a dead feed from one that lost a race. Rolling the
  // prefix makes the first build after deploy write reasons for everything.
  const cacheKey = `rss:feed:v9:${variant}:${feed.url}`;

  try {
    // Read cache unconditionally — the v5 prefix guarantees pre-fix
    // poisoning can't reach this read, so we don't need a parsedTotal
    // bypass. Honoring cached zero-from-zero entries IS the throttle:
    // setCachedJson below writes them with CACHE_TTL_EMPTY_S, so the next
    // request within 5 minutes hits cache instead of upstream. This is
    // what the PR description claimed and what review P1 flagged was
    // missing.
    const cached = (await getCachedJson(cacheKey)) as ParseResult | null;
    if (cached) {
      // A cached failure keeps saying why. 'cached' is reserved for rows that
      // were healthy when written, and the caller treats it as a non-event.
      return {
        ...cached,
        outcome: cached.failureReason ? outcomeForFailure(cached.failureReason) : 'cached',
      };
    }

    // Try direct fetch first
    const fetchStartedAt = Date.now();
    const direct = await fetchRssText(feed.url, signal);
    let text: string | null = direct.ok ? direct.text : null;
    // Why the direct attempt failed, carried so the relay's own failure can be
    // reported against the more informative of the two.
    let failure: FetchFailureReason | null = direct.ok ? null : direct.reason;
    // Kept separate from `failure`, which the relay overwrites — the log needs
    // both hops' verdicts, not just the last one.
    const directFailure: FetchFailureReason | null = direct.ok ? null : direct.reason;
    const directCode: string | null = direct.ok ? null : (direct.code ?? null);
    let relayFailure: FetchFailureReason | null = null;
    let relayCode: string | null = null;
    let source: 'direct' | 'relay' | 'both-failed' = text ? 'direct' : 'both-failed';
    let relayStatus: number | null = null;
    let relayBodyShape: 'rss' | 'html-or-empty' | 'no-relay' | 'fetch-error' = 'no-relay';

    // Fallback: route through Railway relay (different IP, avoids Vercel blocks)
    if (!text) {
      const relayBase = getRelayBaseUrl();
      if (relayBase) {
        relayBodyShape = 'fetch-error';
        const relayUrl = `${relayBase}/rss?url=${encodeURIComponent(feed.url)}`;
        const { controller, cleanup } = createTimeoutLinkedController(signal);
        try {
          const resp = await fetch(relayUrl, {
            headers: getRelayHeaders({ Accept: RSS_ACCEPT }),
            signal: controller.signal,
          });
          relayStatus = resp.status;
          if (resp.ok) {
            // Same decode as the direct path — the relay streams the upstream
            // body through, so a publisher's legacy encoding survives the hop.
            const relayText = decodeRssBody(
              await resp.arrayBuffer(),
              resp.headers.get('content-type'),
            );
            // Relay can also return CF-challenge HTML if the relay's IP is
            // challenged — apply the same sniff to keep the cache clean.
            if (looksLikeRssXml(relayText)) {
              text = relayText;
              source = 'relay';
              relayBodyShape = 'rss';
              failure = null;
            } else {
              relayBodyShape = 'html-or-empty';
              failure = 'not-rss';
            }
          } else {
            failure = 'http-error';
            relayFailure = 'http-error';
          }
        } catch (err) {
          // A cancelled relay attempt is still a cancellation: we ran out of
          // budget, upstream never got the chance to be judged.
          failure = isAbortError(err, controller.signal) ? 'cancelled' : 'network';
          relayFailure = failure;
          if (failure !== 'cancelled') relayCode = fetchErrorCode(err);
        } finally {
          cleanup();
        }
      }
    }

    // Per-feed observability: surfaces which path won the fetch in Vercel
    // function logs. Critical when panels show 0 items — without this
    // breadcrumb you can't tell apart "direct blocked + relay env unset"
    // from "direct blocked + relay 403/429" from "relay returned HTML".
    // Filter logs by `[feed-fetch]` to triage. Volume: one line per cache
    // miss per feed (capped by CACHE_TTL_EMPTY_S=300s + healthy=3600s).
    if (source !== 'direct') {
      const host = (() => { try { return new URL(feed.url).hostname; } catch { return 'invalid-url'; } })();
      // direct_fail / relay_fail are why each hop gave up. Without them the
      // line says a fetch failed but not whether upstream refused us, handed
      // back an interstitial, or we ran out of budget before asking — which is
      // three different fixes. Diagnosing the 2026-08-08 unreachable set needed
      // exactly this and had to guess instead.
      console.log(`[feed-fetch] variant=${variant} category=? host=${host} source=${source} direct_fail=${directFailure ?? 'n/a'}/${directCode ?? '-'} relay_status=${relayStatus ?? 'n/a'} relay_shape=${relayBodyShape} relay_fail=${relayFailure ?? 'n/a'}/${relayCode ?? '-'} elapsed_ms=${Date.now() - fetchStartedAt} feed=${feed.name}`);
    }

    if (!text) {
      const empty: ParseResult = { items: [], parsedTotal: 0, droppedUndated: 0 };
      // A cancellation is NOT evidence about this feed, so it must not be
      // written to the cache. Doing so made the failure feed itself: an abort
      // near the build deadline stamped the feed empty for CACHE_TTL_EMPTY_S,
      // and if the retry landed in another deadline-pressured build it stayed
      // empty indefinitely. Five of the feeds this looked like it had killed —
      // ABC News, Hacker News, The Hill, Bellingcat, Japan Today — answer 200
      // with items when asked directly with the same headers.
      //
      // Every other reason IS evidence: upstream answered and what it said was
      // unusable, so the short cache still applies as a retry throttle.
      if (failure === 'cancelled') {
        return { ...empty, outcome: 'cancelled' };
      }
      // Stamp the reason into the row so it survives the TTL. Reading it back
      // is the only way a later request can tell a dead feed from one that
      // lost a race on a loaded build.
      const reason: FetchFailureReason = failure ?? 'network';
      const cachedFailure: ParseResult = { ...empty, failureReason: reason };
      await setCachedJson(cacheKey, cachedFailure, CACHE_TTL_EMPTY_S);
      return { ...cachedFailure, outcome: outcomeForFailure(reason) };
    }

    // parseRssXml returns null on hard parse failure (malformed XML even
    // after surviving the body-shape sniff). Treat that the same as a
    // network failure: cache empty short so we retry sooner.
    const parsed = parseRssXml(text, feed, variant);
    // A null parse is upstream answering with something unusable, same family
    // as the sniff rejection — so it carries a reason. A parse that succeeded
    // and simply found nothing does NOT: that is a real empty, and labelling it
    // a failure would be the same conflation this whole change removes.
    const result: ParseResult = parsed ?? {
      items: [], parsedTotal: 0, droppedUndated: 0, failureReason: 'not-rss',
    };
    // Long cache only for healthy parses; short cache for zero-from-zero so
    // transient upstream issues don't sticky-fail for an hour.
    const ttl = result.parsedTotal > 0 ? CACHE_TTL_HEALTHY_S : CACHE_TTL_EMPTY_S;
    await setCachedJson(cacheKey, result, ttl);
    return {
      ...result,
      // parsedTotal is the honest signal here: a feed that parsed blocks but
      // dropped them all is 'ok' at this layer, and the caller's undated
      // classification is what describes it.
      outcome: result.parsedTotal > 0
        ? 'ok'
        : (result.failureReason ? outcomeForFailure(result.failureReason) : 'empty'),
    };
  } catch (err) {
    // Reached when the cache read/write itself throws, or the parser does.
    // Nothing was written here, so an abort stays uncached by construction.
    return {
      items: [],
      parsedTotal: 0,
      droppedUndated: 0,
      outcome: isAbortError(err) ? 'cancelled' : 'unreachable',
    };
  }
}

// Date-tag priority lists. RSS feeds typically carry <pubDate>; Atom carries
// <published>/<updated>; ArXiv (and other Dublin Core dialects) carry <dc:date>
// or <dc:Date.Issued>; some hybrid feeds emit RSS-shaped items with Atom-style
// date tags. First non-empty hit wins.
const DATE_TAG_PRIORITY = {
  rss: ['pubDate', 'dc:date', 'dc:Date.Issued', 'published'] as const,
  atom: ['published', 'updated', 'dc:date', 'dc:Date.Issued'] as const,
};

// Future-dated guard: items > 1h ahead of now are clock-skew or malformed.
const FUTURE_DATE_TOLERANCE_MS = 60 * 60 * 1000;

function extractFirstDateTag(block: string, isAtom: boolean): string {
  const tags = isAtom ? DATE_TAG_PRIORITY.atom : DATE_TAG_PRIORITY.rss;
  for (const tag of tags) {
    const value = extractTag(block, tag);
    if (value) return value;
  }
  return '';
}

function parseRssXml(xml: string, feed: ResolvedServerFeed, variant: string): ParseResult | null {
  const items: ParsedItem[] = [];
  let parsedTotal = 0;
  let droppedUndated = 0;

  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;

  let matches = [...xml.matchAll(itemRegex)];
  const isAtom = matches.length === 0;
  if (isAtom) matches = [...xml.matchAll(entryRegex)];

  // #4920 coverage ledger: items beyond the per-feed cap were previously
  // dropped with no counter anywhere — fully invisible.
  const droppedFeedCap = Math.max(0, matches.length - ITEMS_PER_FEED);

  for (const match of matches.slice(0, ITEMS_PER_FEED)) {
    const block = match[1]!;

    const title = extractTag(block, 'title');
    if (!title) continue;

    parsedTotal++;

    let link: string;
    if (isAtom) {
      const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/);
      link = hrefMatch?.[1] ?? '';
    } else {
      link = extractTag(block, 'link');
    }
    // Strip non-HTTP links (javascript:, data:, etc.) before any downstream use.
    if (!/^https?:\/\//i.test(link)) link = '';

    // Strict date gate (R2): walk the dialect-specific tag priority list and
    // require at least one non-empty, parseable, non-future timestamp. Items
    // that fail the gate are dropped — never silently stamped with Date.now()
    // (which is the bug that let static institutional pages reach the brief).
    const pubDateStr = extractFirstDateTag(block, isAtom);
    if (!pubDateStr) {
      droppedUndated++;
      continue;
    }
    const parsedDate = new Date(pubDateStr);
    const parsedMs = parsedDate.getTime();
    if (Number.isNaN(parsedMs)) {
      droppedUndated++;
      continue;
    }
    if (parsedMs > Date.now() + FUTURE_DATE_TOLERANCE_MS) {
      droppedUndated++;
      continue;
    }
    const publishedAt = parsedMs;

    const threat = classifyByKeyword(title, variant);
    const isAlert = threat.level === 'critical' || threat.level === 'high';
    const description = extractDescription(block, isAtom, title);

    items.push({
      source: feed.name,
      title,
      link,
      publishedAt,
      isAlert,
      level: threat.level,
      category: threat.category,
      confidence: threat.confidence,
      classSource: threat.source,
      importanceScore: 0,
      corroborationCount: 1,
      entityCorroborationCount: 0,
      lang: feed.lang ?? 'en',
      description,
      isOpinion: classifyOpinion({ title, link, description, publishedAt }),
      isFeelGood: classifyFeelGood({ title, link, description }),
      isEphemeralLiveCoverage: classifyEphemeralLiveCoverage({ title, link, description }),
      tickers: extractTickers(`${title} ${description}`, TICKER_DICTIONARY),
    });
  }

  // Per-feed structured WARN when every parsed item was dropped for missing
  // dates. Distinguishable from a genuinely empty feed (parsedTotal === 0)
  // by the keyword `FEED_HEALTH_WARNING all-undated` — log aggregation can
  // grep for it. Defers a Redis-backed health-key wiring to a follow-up;
  // see the linked plan.
  if (parsedTotal > 0 && items.length === 0 && droppedUndated > 0) {
    console.warn(
      `[digest] FEED_HEALTH_WARNING all-undated feed="${feed.name}" ` +
        `variant=${variant} parsed=${parsedTotal} dropped=${droppedUndated}`,
    );
  } else if (droppedUndated > 0) {
    console.warn(
      `[digest] partial-undated feed="${feed.name}" variant=${variant} ` +
        `parsed=${parsedTotal} dropped=${droppedUndated} kept=${items.length}`,
    );
  }

  // Two cases:
  //
  // (a) parsedTotal > 0 — we recognized at least one <item>/<entry> block in
  //     the XML, so the stats are meaningful (whether all dropped, partially
  //     dropped, or none dropped). Return the struct so cachedFetchJson
  //     positive-caches it for the full TTL and the 'all-undated' branch in
  //     buildDigest's caller can fire (parsedTotal>0 ∧ items=[] ∧ dropped>0).
  //
  // (b) parsedTotal === 0 — the XML body had no recognizable items at all.
  //     This covers genuinely empty feeds (channel exists, no items),
  //     malformed XML responses, transient block pages, and Cloudflare
  //     interstitials that don't match the item/entry regexes. Return null
  //     so cachedFetchJson writes NEG_SENTINEL with the short negativeTtl
  //     (default 120s) — the feed retries quickly instead of being pinned
  //     empty for the full 3600s TTL.
  if (parsedTotal === 0) return null;
  return { items, parsedTotal, droppedUndated, droppedFeedCap };
}

/**
 * Raw-body extractor for HTML-carrying tags (description, content:encoded,
 * summary, content). Non-greedy `[\s\S]*?` captures the full tag body including
 * nested markup; the CDATA end is anchored to the closing tag so internal `]]>`
 * sequences followed by more content do not truncate the match prematurely.
 * Returns the raw content without entity decoding — caller strips HTML and
 * decodes entities via `decodeXmlEntities`.
 */
const DESCRIPTION_TAG_REGEX_CACHE = new Map<string, { cdata: RegExp; plain: RegExp }>();

function extractRawTagBody(xml: string, tag: string): string {
  let cached = DESCRIPTION_TAG_REGEX_CACHE.get(tag);
  if (!cached) {
    cached = {
      cdata: new RegExp(
        `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
        'i',
      ),
      plain: new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
    };
    DESCRIPTION_TAG_REGEX_CACHE.set(tag, cached);
  }
  const cdataMatch = xml.match(cached.cdata);
  if (cdataMatch) return cdataMatch[1] ?? '';

  const match = xml.match(cached.plain);
  return match ? match[1] ?? '' : '';
}

function normalizeForDescriptionEquality(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract + clean the article description/summary for an RSS `<item>` or Atom
 * `<entry>` block. Picks the LONGEST non-empty candidate across the dialect's
 * tag priority list after HTML-strip + entity-decode + whitespace-normalise.
 * Returns '' when the best candidate is empty, shorter than
 * MIN_DESCRIPTION_LEN, or normalises-equal to the headline — in those cases
 * downstream consumers must fall back to the cleaned headline (R6).
 */
function extractDescription(block: string, isAtom: boolean, title: string): string {
  const tags = isAtom ? DESCRIPTION_TAG_PRIORITY.atom : DESCRIPTION_TAG_PRIORITY.rss;

  let best = '';
  for (const tag of tags) {
    const raw = extractRawTagBody(block, tag);
    if (!raw) continue;
    const cleaned = decodeXmlEntities(raw)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > best.length) best = cleaned;
  }

  if (best.length === 0) return '';
  if (best.length < MIN_DESCRIPTION_LEN) return '';
  if (normalizeForDescriptionEquality(best) === normalizeForDescriptionEquality(title)) return '';

  return best.slice(0, MAX_DESCRIPTION_LEN);
}

const TAG_REGEX_CACHE = new Map<string, { cdata: RegExp; plain: RegExp }>();
const KNOWN_TAGS = [
  'title',
  'link',
  'pubDate',
  'published',
  'updated',
  // Dublin Core date dialects (ArXiv and similar feeds publish via these
  // instead of <pubDate>). Pre-caching their regexes mirrors the perf
  // pattern used for other hot-path tags.
  'dc:date',
  'dc:Date.Issued',
] as const;
for (const tag of KNOWN_TAGS) {
  TAG_REGEX_CACHE.set(tag, {
    cdata: new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i'),
    plain: new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'),
  });
}

function extractTag(xml: string, tag: string): string {
  const cached = TAG_REGEX_CACHE.get(tag);
  const cdataRe = cached?.cdata ?? new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const plainRe = cached?.plain ?? new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');

  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1]!.trim();

  const match = xml.match(plainRe);
  return match ? decodeXmlEntities(match[1]!.trim()) : '';
}

/**
 * `String.fromCodePoint` throws `RangeError` on anything outside the Unicode
 * range, which would turn one malformed numeric reference into a failed feed
 * parse. Drop those instead. `fromCharCode` is not usable here: it truncates to
 * 16 bits, so `&#128512;` decoded to U+F600 (a private-use glyph) rather than 😀.
 */
function decodeNumericReference(codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '';
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => decodeNumericReference(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => decodeNumericReference(parseInt(n, 16)))
    // `&amp;` MUST be decoded last. Decoding it first turns the escaped
    // ampersand of `&amp;lt;` into a live `&`, which the very next replace then
    // consumes as `&lt;` — one pass decoding twice.
    .replace(/&amp;/g, '&');
}

/**
 * Validates a raw `getCachedJsonBatch` hit at the trust boundary before any
 * field reaches a typed `ParsedItem`. `level`/`category` on `ParsedItem` are
 * declared `string`/`ThreatLevel`-derived, but the cache is Redis-backed JSON
 * — an unrelated payload shape (stale schema, another feature's cache
 * collision, hand-edited Redis value) parses fine as JSON while carrying a
 * non-string, missing, or object/array `level`/`category`. Returns null
 * unless BOTH fields are actually strings, so callers never need a
 * downstream `typeof` guard before assigning onto `item.category`.
 */
function parseClassifyCacheHit(raw: unknown): { level: string; category: string } | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { level, category } = raw as Record<string, unknown>;
  if (typeof level !== 'string' || typeof category !== 'string') return null;
  return { level, category };
}

async function enrichWithAiCache(items: ParsedItem[]): Promise<void> {
  // Apply the LLM cache to BOTH 'keyword' and 'keyword-historical-downgrade'
  // sources. The historical-downgrade path forced an info level based on a
  // headline-shape heuristic; the LLM cache (when warmed) is a stronger
  // signal and should be allowed to either confirm or override.
  const candidates = items.filter(
    i => i.classSource === 'keyword' || i.classSource === 'keyword-historical-downgrade',
  );
  if (candidates.length === 0) return;

  // Use the canonical buildClassifyCacheKey from intelligence/v1/_shared
  // so the cache prefix (currently classify:sebuf:v6:) lives in exactly
  // one place — bumping it again only requires touching _shared.ts and
  // the relay's independent .cjs helper. See U4 of the plan.
  const keyMap = new Map<string, ParsedItem[]>();
  for (const item of candidates) {
    const key = await buildClassifyCacheKey(item.title);
    const existing = keyMap.get(key) ?? [];
    existing.push(item);
    keyMap.set(key, existing);
  }

  const keys = [...keyMap.keys()];
  const cached = await getCachedJsonBatch(keys);

  for (const [key, relatedItems] of keyMap) {
    const hit = parseClassifyCacheHit(cached.get(key));
    // `hit.level === '_skip'` is currently unreachable and kept only as
    // defence-in-depth: both relay skip-writes emit `{ level: '_skip',
    // timestamp }` with no `category` (scripts/ais-relay.cjs:3892, :3968),
    // so the shape check above already rejects them and `!hit` catches them
    // here. It stays because it is the correct guard the moment any writer
    // starts pairing the sentinel with a category — do not read it as the
    // operative skip check today. Locked by the `_skip` cases in
    // tests/news-classify-cache-hit-validation.test.mts.
    if (!hit || hit.level === '_skip' || !hit.level || !hit.category) continue;

    for (const item of relatedItems) {
      // L3 defense-in-depth runs FIRST, BEFORE capLlmUpgrade. If the
      // title carries a historical-retrospective marker, force info
      // regardless of what the LLM cache claimed — retrospective content
      // should never ship at any non-info level.
      //
      // Why before the cap (P1 fix on PR #3429 round 3): when keyword=info
      // and hit=critical, capLlmUpgrade returns medium (info+2=medium).
      // A post-cap check on `cappedLevel === 'critical' || === 'high'`
      // would miss this — `medium` doesn't match — so the brief 2026-04-
      // 26-1302 Chernobyl-style title would have shipped at MEDIUM (which
      // still passes 'all' sensitivity briefs). Running the marker check
      // on the original hit and forcing info — not on cappedLevel — closes
      // that gap.
      //
      // Why force info unconditionally (not just critical/high): retro-
      // spective markers should suppress the LLM verdict at every non-info
      // level, including medium and low. A medium-level retrospective would
      // still ship in 'all'-sensitivity briefs; the goal of this guard is
      // "retrospective content NEVER ships, regardless of LLM verdict."
      if (hasHistoricalMarker(item.title)) {
        console.warn(
          `[classify] LLM hit forced to info by historical marker: ` +
            `keyword=${item.level} llm=${hit.level} title="${item.title.slice(0, 60)}"`,
        );
        item.level = 'info';
        item.category = hit.category;
        item.confidence = 0.9;
        item.classSource = 'llm';
        item.isAlert = false;
        continue;
      }

      // Skip the LLM cache for high-confidence keyword=critical matches
      // (confidence 0.9). Without this skip, capLlmUpgrade is a Math.min
      // — a stale or wrong LLM cache entry saying 'info' would silently
      // demote a genuine current critical event to info via min(critical,
      // info) = info, with no remaining safeguard.
      //
      // The retrospective case the prior PR #3424 wanted to handle here
      // is already handled UPSTREAM: a keyword=critical title with a
      // historical marker becomes classSource='keyword-historical-
      // downgrade' (confidence 0.85, level=info) inside classifyByKeyword
      // BEFORE reaching this function, so the L3 marker check above
      // catches it via the historical-downgrade source. Items reaching
      // here at confidence 0.9 are by construction items where the
      // keyword classifier saw a critical match AND saw no marker —
      // the safer default for those is to trust the keyword verdict.
      //
      // The L3 marker check above intentionally runs BEFORE this skip so
      // that keyword=info (confidence 0.3, no-match) titles with a
      // marker — the brief 2026-04-26-1302 "Science history: melts
      // down…" shape — still get forced to info via the cache hit.
      // Belt-and-suspenders for substring-keyword-miss contamination.
      //
      // P1 fix on PR #3429 round 4 (Greptile review on commit 96d3c12d7).
      if (0.9 <= item.confidence) continue;

      //
      // Cap the LLM upgrade at +2 tiers above the keyword classification
      // so a poisoned cache entry (e.g., "About Section 508" → high) can't
      // promote an info-keyword item past medium (info+2=medium). Legitimate
      // medium→critical upgrades (medium+2=critical) remain reachable.
      // capLlmUpgrade is a Math.min so downgrades pass through freely.
      // See LEVEL_RANK doc + R4 for the full per-keyword cap table.
      const cappedLevel = capLlmUpgrade(item.level, hit.level);
      if (cappedLevel !== hit.level) {
        console.warn(
          `[classify] LLM upgrade capped: keyword=${item.level} ` +
            `llm=${hit.level} applied=${cappedLevel} title="${item.title.slice(0, 60)}"`,
        );
      }
      item.level = cappedLevel;
      item.category = hit.category;
      item.confidence = 0.9;
      item.classSource = 'llm';
      item.isAlert = cappedLevel === 'critical' || cappedLevel === 'high';
    }
  }
}

// ── Story persistence tracking ────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  // \p{L} = any Unicode letter; \p{N} = any Unicode number.
  // The `u` flag is required for Unicode property escapes — without it \w
  // matches only ASCII [A-Za-z0-9_], stripping all Arabic/CJK/Cyrillic chars
  // and collapsing every non-Latin title to the same empty hash.
  return title
    .toLowerCase()
    // Strip source attribution suffixes ("- Reuters", "- reuters.com", etc.)
    // so the same story from different domains hashes identically.
    .replace(/\s*[-\u2013\u2014]\s*[\w\s.]+\.(?:com|org|net|co\.uk)\s*$/, '')
    .replace(/\s*[-\u2013\u2014]\s*(?:reuters|ap news|bbc|cnn|al jazeera|france 24|dw news|pbs newshour|cbs news|nbc|abc|associated press|the guardian|nos nieuws|tagesschau|cnbc|the national)\s*$/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function entityKeysForTitle(title: string): string[] {
  const text = normalizeScoringText(title);
  const keys: string[] = [];
  for (const [entity, action] of DIPLOMACY_FLASHPOINT_PAIRS) {
    if (containsKeywordToken(text, entity) && containsKeywordToken(text, action)) keys.push(`${entity}:${action}`);
  }
  if (
    keys.length === 0 &&
    hasAnySignal(text, DIPLOMACY_KEYWORDS) &&
    hasAnySignal(text, FLASHPOINT_SCORING_KEYWORDS)
  ) {
    keys.push('generic:diplomacy-flashpoint');
  }
  return keys;
}

interface EntityCorroborationSignal {
  sourceCount: number;
  tier12SourceCount: number;
}

function computeEntityCorroborationSignals(
  items: ParsedItem[],
  nowMs = Date.now(),
): Map<string, EntityCorroborationSignal> {
  const buckets = new Map<string, { items: ParsedItem[]; sources: Set<string>; tier12Sources: Set<string> }>();
  for (const item of items) {
    if (!item.titleHash) continue;
    if (!Number.isFinite(item.publishedAt) || nowMs - item.publishedAt > ENTITY_CORROBORATION_WINDOW_MS) continue;
    for (const key of entityKeysForTitle(item.title)) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { items: [], sources: new Set(), tier12Sources: new Set() };
        buckets.set(key, bucket);
      }
      bucket.items.push(item);
      if (item.source) {
        bucket.sources.add(item.source);
        if (getSourceTier(item.source) <= 2) bucket.tier12Sources.add(item.source);
      }
    }
  }

  const signals = new Map<string, EntityCorroborationSignal>();
  for (const bucket of buckets.values()) {
    if (bucket.sources.size < 2) continue;
    for (const item of bucket.items) {
      const previous = signals.get(item.titleHash!);
      signals.set(item.titleHash!, {
        sourceCount: Math.max(previous?.sourceCount ?? 0, bucket.sources.size),
        tier12SourceCount: Math.max(previous?.tier12SourceCount ?? 0, bucket.tier12Sources.size),
      });
    }
  }
  return signals;
}

function computeEntityCorroborationCounts(
  items: ParsedItem[],
  nowMs = Date.now(),
): Map<string, number> {
  const signals = computeEntityCorroborationSignals(items, nowMs);
  return new Map([...signals].map(([hash, signal]) => [hash, signal.sourceCount]));
}

interface StoryTrack {
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
  sourceCount: number;
  currentScore: number;
  peakScore: number;
}

function derivePhase(track: StoryTrack): ProtoStoryPhase {
  const ageMs = Date.now() - track.firstSeen;
  if (track.mentionCount <= 1) return 'STORY_PHASE_BREAKING';
  if (track.mentionCount <= 5 && ageMs < 2 * 60 * 60 * 1000) return 'STORY_PHASE_DEVELOPING';
  // FADING requires real scores from E1. Until E1 ships, currentScore and
  // peakScore are both 0 (HSETNX placeholders), so this branch is intentionally
  // inactive — stories fall through to SUSTAINED rather than incorrectly FADING.
  if (track.currentScore > 0 && track.peakScore > 0 && track.currentScore < track.peakScore * 0.5) return 'STORY_PHASE_FADING';
  return 'STORY_PHASE_SUSTAINED';
}

/**
 * Batch-read existing story:track hashes from Redis for a list of title hashes.
 * Returns a Map<titleHash, StoryTrack>. Missing entries are absent from the map.
 */
async function readStoryTracks(titleHashes: string[]): Promise<Map<string, StoryTrack>> {
  if (titleHashes.length === 0) return new Map();
  const fields = ['firstSeen', 'lastSeen', 'mentionCount', 'sourceCount', 'currentScore', 'peakScore'];
  const commands = titleHashes.map(h => [
    'HMGET', STORY_TRACK_KEY(h), ...fields,
  ]);
  const results = await runRedisPipeline(commands);
  const map = new Map<string, StoryTrack>();
  for (let i = 0; i < titleHashes.length; i++) {
    const vals = results[i]?.result as string[] | null;
    if (!vals || !vals[0]) continue; // firstSeen missing → new story
    map.set(titleHashes[i]!, {
      firstSeen:    Number(vals[0]),
      lastSeen:     Number(vals[1] ?? 0),
      mentionCount: Number(vals[2] ?? 0),
      sourceCount:  Number(vals[3] ?? 0),
      currentScore: Number(vals[4] ?? 0),
      peakScore:    Number(vals[5] ?? 0),
    });
  }
  return map;
}

function toProtoItem(item: ParsedItem, storyMeta?: ProtoStoryMeta): ProtoNewsItem {
  return {
    source: item.source,
    title: item.title,
    link: item.link,
    publishedAt: item.publishedAt,
    isAlert: item.isAlert,
    importanceScore: item.importanceScore,
    corroborationCount: item.corroborationCount ?? 0,
    storyMeta,
    threat: {
      level: LEVEL_TO_PROTO[item.level],
      category: item.category,
      confidence: item.confidence,
      source: item.classSource,
    },
    locationName: '',
    snippet: item.description ?? '',
    tickers: item.tickers ?? [],
  };
}

export async function listFeedDigest(
  ctx: ServerContext,
  req: ListFeedDigestRequest,
): Promise<ListFeedDigestResponse> {
  const variant = VALID_VARIANTS.has(req.variant) ? req.variant : 'full';
  const lang = req.lang || 'en';

  const digestCacheKey = `news:digest:v1:${variant}:${lang}`;
  const fallbackKey = `${variant}:${lang}`;

  const empty = (): ListFeedDigestResponse => ({ categories: {}, feedStatuses: {}, generatedAt: new Date().toISOString() });

  try {
    // cachedFetchJson coalesces concurrent cold-path calls: concurrent requests
    // for the same key share a single buildDigest() run instead of fanning out
    // across all RSS feeds. Returning null skips the Redis write and caches a
    // neg-sentinel (120s) to absorb the request storm during degraded periods.
    const fresh = await cachedFetchJson<ListFeedDigestResponse>(
      digestCacheKey,
      900,
      async () => {
        const result = await buildDigest(variant, lang);
        const totalItems = Object.values(result.categories).reduce((sum, b) => sum + b.items.length, 0);
        return totalItems > 0 ? result : null;
      },
      120,
      { timeoutMs: DIGEST_RESPONSE_TIMEOUT_MS },
    );

    if (fresh === null) {
      markNoCacheResponse(ctx.request);
      return fallbackDigestCache.get(fallbackKey)?.data ?? empty();
    }

    if (fallbackDigestCache.size > 50) fallbackDigestCache.clear();
    fallbackDigestCache.set(fallbackKey, { data: fresh, ts: Date.now() });
    return fresh;
  } catch {
    markNoCacheResponse(ctx.request);
    return fallbackDigestCache.get(fallbackKey)?.data ?? empty();
  }
}

const STORY_BATCH_SIZE = 80; // keeps each pipeline call well under Upstash's 1000-command cap

/**
 * Build the HSET field list for a story:track:v1 row.
 *
 * Description is written UNCONDITIONALLY (empty string when the current
 * mention has no body). Rationale: story:track rows are collapsed by
 * normalized-title hash, so multiple wire reports of the same event share a
 * row. If we only wrote description when non-empty, an earlier mention's
 * body would persist on subsequent body-less mentions for up to STORY_TTL
 * (7 days), and consumers would unknowingly ground LLMs on "some mention's
 * body" rather than "this mention's body" — violating the grounding
 * contract advertised to brief / whyMatters / SummarizeArticle. Writing
 * empty is the authoritative signal that the current mention has no body;
 * consumers then fall back to the cleaned headline (R6) honestly, and the
 * next mention with a body re-populates the field naturally.
 */
function buildStoryTrackHsetFields(
  item: ParsedItem,
  nowStr: string,
  score: number,
): Array<string | number> {
  return [
    'lastSeen', nowStr,
    'currentScore', score,
    'title', item.title,
    'link', item.link,
    'severity', item.level,
    'lang', item.lang,
    'description', item.description ?? '',
    // Source publishedAt (the article's actual publication time as parsed
    // from the RSS pubDate or Dublin Core fallback). Persisted so READ-time
    // consumers — buildDigest's freshness floor and the U6 audit's
    // age-mode — can drop residual stale entries that pre-date an
    // ingest-side gate tightening. See:
    //   skill: ingest-gate-tightening-leaves-residue-in-read-path.
    // Defensive cast: write '' when publishedAt isn't a finite number so
    // the field never holds the literal "undefined"/"NaN" string. Read-side
    // parseInt('') yields NaN → falls through the missing-field branch
    // (treats as legacy row) instead of being mis-classified as a stale
    // row with a bogus timestamp.
    'publishedAt', Number.isFinite(item.publishedAt) ? String(item.publishedAt) : '',
    // Entity-level cross-title corroboration count. Distinct from exact
    // normalized-title sourceCount: this captures related flashpoint +
    // diplomacy reports that do not collapse into the same story hash.
    // The digest composer uses it as a narrow lead/card coherence signal.
    'entityCorroborationCount', Number.isFinite(item.entityCorroborationCount)
      ? String(item.entityCorroborationCount)
      : '0',
    // Non-event brief flag (classifyOpinion). '1' = op-ed/column or
    // historical explainer, '0' = hard news. The legacy `isOpinion` field
    // name remains for cache compatibility; buildDigest excludes '1' rows
    // from the brief pool. Written unconditionally for the same
    // shared-row reason as `description` above: story:track rows are
    // collapsed by normalised-title hash, so a stale '1' from an earlier
    // mention must be overwritten by the current mention's verdict.
    // Pre-stamp rows (ingested before this shipped) have no field at
    // all; buildDigest re-classifies those from title/link/description.
    'isOpinion', item.isOpinion ? '1' : '0',
    // Feel-good / lifestyle flag (classifyFeelGood). Sibling to
    // isOpinion — same write semantics, same buildDigest read-path
    // exclusion. Pre-stamp rows are re-classified by buildDigest from
    // title/link/description (residue catch).
    'isFeelGood', item.isFeelGood ? '1' : '0',
    // Ephemeral live-programming flag (classifyEphemeralLiveCoverage).
    // Same write semantics as the opinion/feel-good stamps: overwrite on
    // every mention so a collapsed story row reflects the current headline
    // verdict; buildDigest re-classifies pre-stamp rows for the TTL window.
    'isEphemeralLiveCoverage', item.isEphemeralLiveCoverage ? '1' : '0',
    // Event category (classifyByKeyword EventCategory enum, possibly
    // overridden by enrichWithAiCache). Persisted so the brief's
    // threads card + magazine story-page + public-thread fallback
    // can display a meaningful per-story tag instead of defaulting
    // to 'General' for every story. Defensive empty-string write on
    // missing/non-string: shared/brief-filter.js:384's
    // `asTrimmedString(raw.category) || 'General'` fallback converts
    // empty back to 'General' for graceful degradation. See plan
    // docs/plans/2026-05-17-002-fix-persist-story-track-category-plan.md.
    'category', typeof item.category === 'string' ? item.category : '',
  ];
}

async function writeStoryTracking(items: ParsedItem[], variant: string, lang: string, hashes: string[], memberHashesByFinal?: Map<string, Set<string>>): Promise<void> {
  if (items.length === 0) return;
  const now = Date.now();
  const accKey = DIGEST_ACCUMULATOR_KEY(variant, lang);

  // #4919/#4924: with fuzzy story identity, N same-cycle wording variants
  // share one titleHash. Mutable per-story writes (mentionCount HINCRBY,
  // HSET representative fields) must run ONCE per unique hash per cycle —
  // per-item they would inflate mentionCount by N per cycle (a 6-variant
  // story would skip DEVELOPING straight to SUSTAINED, since the read
  // path treats mentionCount as +1/cycle) and let whichever member
  // iterated last overwrite the representative fields nondeterministically.
  // Representative = highest importanceScore, tie-break newest publishedAt
  // then title — deterministic for a given batch. Per-MEMBER writes that
  // are set-shaped stay per item: SADD source (distinct-source set is the
  // point of corroboration) and ZADD peak GT (max is idempotent).
  const representativeByHash = new Map<string, ParsedItem>();
  for (let i = 0; i < items.length; i++) {
    const hash = hashes[i]!;
    const item = items[i]!;
    const current = representativeByHash.get(hash);
    if (
      !current
      || item.importanceScore > current.importanceScore
      || (item.importanceScore === current.importanceScore && item.publishedAt > current.publishedAt)
      || (item.importanceScore === current.importanceScore && item.publishedAt === current.publishedAt
        && item.title < current.title)
    ) {
      representativeByHash.set(hash, item);
    }
  }

  const writtenHashes = new Set<string>();
  for (let batchStart = 0; batchStart < items.length; batchStart += STORY_BATCH_SIZE) {
    const batch = items.slice(batchStart, batchStart + STORY_BATCH_SIZE);
    const commands: Array<Array<string | number>> = [];

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]!;
      const hash = hashes[batchStart + i]!;
      const trackKey = STORY_TRACK_KEY(hash);
      const sourcesKey = STORY_SOURCES_KEY(hash);
      const peakKey = STORY_PEAK_KEY(hash);
      const score = item.importanceScore;
      const nowStr = String(now);
      const ttl = STORY_TTL;

      if (!writtenHashes.has(hash)) {
        writtenHashes.add(hash);
        const representative = representativeByHash.get(hash) ?? item;
        const hsetFields = buildStoryTrackHsetFields(representative, nowStr, representative.importanceScore);
        commands.push(
          ['HINCRBY', trackKey, 'mentionCount', '1'],
          ['HSET', trackKey, ...hsetFields],
          ['HSETNX', trackKey, 'firstSeen', nowStr],
          ['EXPIRE', trackKey, ttl],
          ['ZADD', accKey, nowStr, hash],
        );
        // #4924: alias rows for every member exact-title hash -> the FINAL
        // (post-adoption) canonical, story-track TTL — next cycle's
        // adoption source. Includes the canonical's own hash.
        for (const memberHash of memberHashesByFinal?.get(hash) ?? []) {
          commands.push(['SET', STORY_ALIAS_KEY(memberHash), hash, 'EX', ttl]);
        }
      }

      commands.push(
        ['ZADD', peakKey, 'GT', score, 'peak'],
        ['SADD', sourcesKey, item.source],
        // #4924 review P2 (TTL ordering): EXPIRE must follow the SADD/ZADD
        // that CREATE these keys — EXPIRE on a missing key is a no-op, so
        // the pre-block ordering left brand-new story:sources/story:peak
        // keys persistent forever. Idempotent per member; kept adjacent to
        // the creating writes so no future reorder can reopen the leak.
        ['EXPIRE', sourcesKey, ttl],
        ['EXPIRE', peakKey, ttl],
      );
    }

    await runRedisPipeline(commands);
  }

  // Refresh accumulator TTL once per build — 48h, shorter than STORY_TTL since digest cron only needs ~24h lookback.
  await runRedisPipeline([['EXPIRE', accKey, DIGEST_ACCUMULATOR_TTL]]);
}

/**
 * Truncate one category to MAX_ITEMS_PER_CATEGORY, holding up to
 * NATIVE_LANGUAGE_RESERVED_SLOTS of them for `nativeSources`.
 *
 * `items` must already be sorted by rank. Both partitions keep that order, and
 * the result is re-sorted by it, so the reserve changes WHICH items survive the
 * cut, never how the survivors are ordered.
 *
 * Degrades in both directions: an empty `nativeSources` (the reader is on the
 * universal-pool language, or that language has no native source in this
 * category) reduces to a plain slice, and a language with fewer native items
 * than the reserve hands the difference back to the general ranking rather than
 * shipping short.
 */
function sliceCategoryWithNativeReserve(
  items: ParsedItem[],
  nativeSources: Set<string>,
): ParsedItem[] {
  if (nativeSources.size === 0 || items.length <= MAX_ITEMS_PER_CATEGORY) {
    return items.slice(0, MAX_ITEMS_PER_CATEGORY);
  }
  const native: ParsedItem[] = [];
  const rest: ParsedItem[] = [];
  for (const item of items) {
    (nativeSources.has(item.source) ? native : rest).push(item);
  }
  if (native.length === 0) return rest.slice(0, MAX_ITEMS_PER_CATEGORY);

  const keptNative = pickAcrossSources(native, NATIVE_LANGUAGE_RESERVED_SLOTS);
  const keptNativeSet = new Set(keptNative);
  const kept = [...keptNative, ...rest.slice(0, MAX_ITEMS_PER_CATEGORY - keptNative.length)];
  // Native items beyond the reserve compete for what is left on merit, which
  // matters when the general pool is thin — latam already fills most of its
  // cap from Spanish and Portuguese sources without any reserve at all.
  if (kept.length < MAX_ITEMS_PER_CATEGORY) {
    const spare = native.filter(item => !keptNativeSet.has(item));
    kept.push(...spare.slice(0, MAX_ITEMS_PER_CATEGORY - kept.length));
  }
  return kept.sort((a, b) =>
    b.importanceScore - a.importanceScore || b.publishedAt - a.publishedAt,
  );
}

/**
 * Take `limit` items from a rank-sorted list, spreading them across distinct
 * sources before taking a second item from any one of them.
 *
 * A plain `slice` does not do this. ITEMS_PER_FEED is 5 and the reserve is 8,
 * so two feeds saturate it: measured live on 2026-08-08, every language filled
 * its reserve 8/8 but tr drew all eight from BBC Turkce and DW Turkish while
 * six other Turkish sources sat in the catalog unused. Filling the quota and
 * representing the country's press are not the same thing, and in a
 * consolidated or polarised media market the difference is the whole point —
 * the tr pack spans opposition to state wire precisely so the reserve can.
 *
 * Rank still decides everything within a source, and the round order follows
 * each source's best-ranked item, so a stronger source is never displaced by a
 * weaker one — it just does not take the whole reserve.
 */
function pickAcrossSources(items: ParsedItem[], limit: number): ParsedItem[] {
  const bySource = new Map<string, ParsedItem[]>();
  for (const item of items) {
    const existing = bySource.get(item.source);
    if (existing) existing.push(item);
    else bySource.set(item.source, [item]);
  }
  // Insertion order is first appearance, i.e. sources ordered by their best item.
  const queues = [...bySource.values()];
  const picked: ParsedItem[] = [];
  for (let round = 0; picked.length < limit; round++) {
    let progressed = false;
    for (const queue of queues) {
      const item = queue[round];
      if (item === undefined) continue;
      picked.push(item);
      progressed = true;
      if (picked.length === limit) return picked;
    }
    if (!progressed) break;
  }
  return picked;
}

async function buildDigest(variant: string, lang: string): Promise<ListFeedDigestResponse> {
  const feedsByCategory = VARIANT_FEEDS[variant] ?? {};
  const feedStatuses: Record<string, string> = {};
  // #4920 coverage ledger: count every silent drop gate so "how much did
  // we NOT show" is a queryable number instead of a feeling.
  const ledgerDrops = { perFeedCap: 0, undated: 0, freshnessFloor: 0, perCategoryCap: 0 };
  const categories: Record<string, CategoryBucket> = {};

  const deadlineController = new AbortController();
  const deadlineTimeout = setTimeout(() => deadlineController.abort(), OVERALL_DEADLINE_MS);

  try {
    // Locale resolution happens HERE, once, so everything downstream —
    // fetch, relay fallback, per-host telemetry, and the `rss:feed:v9` cache
    // key — sees a concrete URL. A feed whose url is a locale map would
    // otherwise stringify into the cache key and collapse every language onto
    // one entry.
    const allEntries: Array<{ category: string; feed: ResolvedServerFeed }> = [];
    // Pre-resolution feeds. Resolution replaces a locale-keyed `url` with the
    // one concrete URL for this language, which erases the evidence that the
    // feed serves this language at all — so the reserve's native check below
    // has to read these, not allEntries.
    const nativeCandidates: ServerFeed[] = [];
    const resolve = (feed: ServerFeed): ResolvedServerFeed => ({
      ...feed,
      url: resolveServerFeedUrl(feed, lang),
    });

    for (const [category, feeds] of Object.entries(feedsByCategory)) {
      const filtered = feeds.filter(f => isServerFeedReachableForLanguage(f, lang));
      for (const feed of filtered) {
        nativeCandidates.push(feed);
        allEntries.push({ category, feed: resolve(feed) });
      }
    }

    if (variant === 'full') {
      const filteredIntel = INTEL_SOURCES.filter(f => isServerFeedReachableForLanguage(f, lang));
      for (const feed of filteredIntel) {
        nativeCandidates.push(feed);
        allEntries.push({ category: 'intel', feed: resolve(feed) });
      }
    }

    // Sources written in the reader's own language, for the per-category
    // reserve applied at truncation.
    //
    // Two ways a feed qualifies, and both are needed. A `lang` tag is the
    // obvious one. The other is a locale-keyed `url` carrying this language:
    // resolveServerFeedUrl above already fetched such a feed from its Arabic
    // or German edition, so it IS native journalism for this reader even
    // though it carries no tag. Counting only tags cost `ar` its reserve —
    // Al Jazeera and France 24 both serve Arabic through their url maps, which
    // left Asharq News as the only source the reserve could see, and one feed
    // caps at ITEMS_PER_FEED so the category shipped 5 of its 8 slots.
    //
    // This is deliberately the same predicate the coverage audit uses to count
    // native sources (scripts/language-coverage-health.mjs). The audit and the
    // runtime disagreeing about what "native" means is how this whole class of
    // bug started.
    //
    // strategicDefault is still NOT a qualifier: such a feed reaches every
    // locale precisely because it is not native to most of them, so honouring
    // it here would spend the reserve on one source across 26 languages.
    // Empty for the universal-pool language, which turns the reserve off — the
    // untagged pool IS that language.
    const servesReaderLanguage = (feed: ServerFeed) =>
      feed.lang === lang || (typeof feed.url === 'object' && lang in feed.url);
    const nativeSourceNames = lang === UNIVERSAL_POOL_LANGUAGE
      ? new Set<string>()
      : new Set(nativeCandidates.filter(servesReaderLanguage).map(feed => feed.name));

    const results = new Map<string, ParsedItem[]>();
    // Track feeds that actually completed (with or without items) so we can
    // distinguish a genuine timeout (never ran) from a successful empty fetch.
    const completedFeeds = new Set<string>();

    // Feeds are pulled from one shared queue by a fixed set of workers rather
    // than marched through in fixed batches.
    //
    // The batched version awaited Promise.allSettled per batch, which made
    // every batch cost its SLOWEST member. FEED_TIMEOUT_MS is 8s and
    // OVERALL_DEADLINE_MS is 10s, so a single hung feed spent 80% of the whole
    // build's budget while the other 19 slots in its batch sat idle and the
    // ~440 feeds behind it never started. Measured cold, that is exactly what
    // happened: 99 feeds reported 'timeout' — not slow, never begun — and the
    // digest shipped 129 items against a warm-cache 272.
    //
    // With a pool, a slow feed occupies one worker instead of stalling twenty.
    // Cost becomes total work divided by workers, not the sum of per-batch
    // maxima. Worker count is env-tunable (NEWS_FEED_CONCURRENCY) because the
    // right value is empirical and differs per deployment — see
    // resolveFeedConcurrency.
    let nextEntryIndex = 0;
    const runWorker = async (): Promise<void> => {
      while (!deadlineController.signal.aborted) {
        const entry = allEntries[nextEntryIndex++];
        if (!entry) return;
        const { category, feed } = entry;
        try {
          const result = await fetchAndParseRss(feed, variant, deadlineController.signal);
          completedFeeds.add(feed.name);
          // Classify per-feed status. Only problems are recorded — a healthy
          // feed writes nothing, which is what keeps this map small enough to
          // ship on every response.
          //
          // The date classifications come first because they describe content
          // and are the more specific finding: 'all-undated' is the
          // silent-zeroing mode (every parsed item dropped for missing or
          // unparseable dates), 'partial-undated' is informational. Both are
          // keyword-matched by log aggregation, so their spelling is fixed.
          //
          // Below them sit the fetch outcomes, and the reason they are
          // separate names rather than one 'empty' is that the old lumping
          // made this map useless as a health signal: a feed cut off by the
          // build deadline was indistinguishable from a dead one. 'cancelled'
          // says nothing about upstream; 'not-rss' and 'unreachable' do.
          if (result.parsedTotal > 0 && result.items.length === 0 && result.droppedUndated > 0) {
            feedStatuses[feed.name] = 'all-undated';
          } else if (result.items.length > 0) {
            if (result.droppedUndated > 0) feedStatuses[feed.name] = 'partial-undated';
          } else if (result.outcome !== 'ok' && result.outcome !== 'cached') {
            feedStatuses[feed.name] = result.outcome;
          } else {
            // Parsed cleanly, kept nothing, and no date drops explain it —
            // e.g. every item failed the freshness floor.
            feedStatuses[feed.name] = 'empty';
          }

          const existing = results.get(category) ?? [];
          existing.push(...result.items);
          results.set(category, existing);
          ledgerDrops.undated += result.droppedUndated;
          ledgerDrops.perFeedCap += result.droppedFeedCap ?? 0;
        } catch {
          // One feed throwing must not take its worker down with it —
          // Promise.allSettled used to absorb this per batch.
        }
      }
    };
    const workerCount = Math.min(resolveFeedConcurrency(), allEntries.length);
    await Promise.all(Array.from({ length: workerCount }, runWorker));

    // 'timeout' and 'cancelled' are both deadline casualties but not the same
    // event, and telling them apart is how you know which lever to pull.
    // 'timeout' means the deadline fired before any worker reached this feed —
    // it never ran, so the fix is throughput (concurrency, budget, warm cache).
    // 'cancelled' means it ran and was cut off mid-flight — the fix is the
    // per-feed timeout or that upstream is slow. Neither is a verdict on the
    // feed, and neither is cached.
    for (const entry of allEntries) {
      if (!completedFeeds.has(entry.feed.name)) {
        feedStatuses[entry.feed.name] = 'timeout';
      }
    }

    // U3 — hard freshness floor. Drop items older than NEWS_MAX_AGE_HOURS
    // (default 96h) BEFORE corroboration counting so a stale duplicate of a
    // fresh story can't inflate the cluster's source count. Runs after parse
    // (where U2 already dropped undated items) so every item here carries a
    // real publishedAt. See R3.
    const maxAgeMs = resolveMaxAgeMs();
    const freshnessCutoff = Date.now() - maxAgeMs;
    let droppedStaleTotal = 0;
    for (const [category, items] of results) {
      const fresh = items.filter((it) => it.publishedAt >= freshnessCutoff);
      droppedStaleTotal += items.length - fresh.length;
      results.set(category, fresh);
    }
    ledgerDrops.freshnessFloor = droppedStaleTotal;
    if (droppedStaleTotal > 0) {
      console.warn(
        `[digest] freshness floor dropped ${droppedStaleTotal} stale items ` +
          `(max age: ${maxAgeMs / (60 * 60 * 1000)}h)`,
      );
    }

    // Flatten ALL items before any truncation so cross-category corroboration is counted.
    const allItems = [...results.values()].flat();

    // #4919: fuzzy story identity. Items are clustered by the shared
    // story-identity similarity (edit-tolerant: suffixes, truncations,
    // qualifier swaps, reorders, morphology) and every cluster member
    // shares one canonical titleHash + a cluster-wide corroboration
    // count. The previous exact sha256(normalizeTitle) identity forked a
    // story on ANY wording edit, so corroboration only counted verbatim
    // wire syndication — deflating importanceScore's corroboration
    // signal and the BREAKING/DEVELOPING phase tracker. Singleton
    // clusters hash exactly as before, so story:track keys for
    // uncorroborated stories are unchanged.
    const identityByItem = await assignStoryIdentity(allItems, normalizeTitle, sha256Hex);

    // #4924 review P1: adopt a LIVE canonical before assigning hashes.
    // Alias rows (memberHash -> canonicalHash, story-track TTL) written by
    // previous cycles let a cluster keep its story identity when the
    // member that anchored the canonical drops out of the batch. One
    // batched read for all member hashes; failures degrade to
    // batch-derived canonicals (pre-adoption behavior).
    const allMemberHashes = new Set<string>();
    for (const identity of identityByItem.values()) {
      for (const h of identity.memberTitleHashes ?? []) allMemberHashes.add(h);
    }
    const aliasTargetByHash = new Map<string, string>();
    if (allMemberHashes.size > 0) {
      const aliasHashes = [...allMemberHashes];
      const aliasResults = await runRedisPipeline(aliasHashes.map((h) => ['GET', STORY_ALIAS_KEY(h)]));
      for (let i = 0; i < aliasHashes.length; i++) {
        const target = aliasResults[i]?.result;
        if (typeof target === 'string' && target.length > 0) aliasTargetByHash.set(aliasHashes[i]!, target);
      }
    }

    await Promise.all(allItems.map(async (item) => {
      const identity = identityByItem.get(item);
      if (identity) {
        item.titleHash = adoptExistingCanonical(identity.memberTitleHashes, identity.titleHash, aliasTargetByHash);
        item.corroborationCount = identity.corroborationCount;
      } else {
        // Defensive: assignStoryIdentity covers every input by
        // construction; degrade to the pre-#4919 exact identity if not —
        // and say so, or a future coverage-invariant break is invisible.
        console.warn(
          `[digest] story-identity coverage miss — exact-hash fallback for "${item.title.slice(0, 60)}"`,
        );
        item.titleHash = await sha256Hex(normalizeTitle(item.title));
        item.corroborationCount = 1;
      }
    }));

    // Final(post-adoption) hash -> member exact-title hashes, consumed by
    // writeStoryTracking to persist next cycle's alias rows.
    const memberHashesByFinal = new Map<string, Set<string>>();
    for (const item of allItems) {
      const identity = identityByItem.get(item);
      if (!identity || !item.titleHash) continue;
      let set = memberHashesByFinal.get(item.titleHash);
      if (!set) { set = new Set(); memberHashesByFinal.set(item.titleHash, set); }
      for (const h of identity.memberTitleHashes ?? []) set.add(h);
    }

    // Enrich ALL items with the AI classification cache BEFORE scoring so that
    // importanceScore uses the final (post-LLM) threat level, and truncation
    // discards items based on their true score.
    await enrichWithAiCache(allItems);

    const entityCorroborationSignals = computeEntityCorroborationSignals(allItems);
    let diplomacySignalCount = 0;
    let entityCorroborationHitCount = 0;
    let diplomacySeverityPromotionCount = 0;
    let llmScoredCount = 0;
    let keywordFallbackScoredCount = 0;

    // Compute importance score using final (post-enrichment) threat levels.
    for (const item of allItems) {
      const entitySignal = entityCorroborationSignals.get(item.titleHash!);
      item.entityCorroborationCount = entitySignal?.sourceCount ?? 0;
      const promotedLevel = promoteDiplomacySeverity(
        item.level,
        item.title,
        entitySignal?.tier12SourceCount ?? 0,
      );
      if (promotedLevel !== item.level) {
        item.level = promotedLevel;
        item.isAlert = true;
        diplomacySeverityPromotionCount++;
      }
      const scoringCorroboration = Math.max(item.corroborationCount, item.entityCorroborationCount);
      item.importanceScore = computeImportanceScore(
        item.level,
        item.source,
        scoringCorroboration,
        item.publishedAt,
        {
          title: item.title,
          classSource: item.classSource,
          entityCorroborationCount: item.entityCorroborationCount,
        },
      );
      if (hasDiplomacyFlashpointSignal(item.title)) diplomacySignalCount++;
      if (item.entityCorroborationCount > 0) entityCorroborationHitCount++;
      if (item.classSource === 'llm') llmScoredCount++;
      else keywordFallbackScoredCount++;
    }

    if (diplomacySignalCount > 0 || entityCorroborationHitCount > 0) {
      console.log(
        `[digest] importance signals llm=${llmScoredCount} ` +
          `keywordFallback=${keywordFallbackScoredCount} ` +
          `diplomacy=${diplomacySignalCount} ` +
          `entityCorroboration=${entityCorroborationHitCount} ` +
          `diplomacySeverityPromotions=${diplomacySeverityPromotionCount}`,
      );
    }

    // Sort by importanceScore desc, then pubDate desc; then truncate per category.
    const slicedByCategory = new Map<string, ParsedItem[]>();
    let nativeReserved = 0;
    for (const [category, items] of results) {
      items.sort((a, b) =>
        b.importanceScore - a.importanceScore || b.publishedAt - a.publishedAt,
      );
      ledgerDrops.perCategoryCap += Math.max(0, items.length - MAX_ITEMS_PER_CATEGORY);
      const sliced = sliceCategoryWithNativeReserve(items, nativeSourceNames);
      nativeReserved += sliced.filter(item => nativeSourceNames.has(item.source)).length;
      slicedByCategory.set(category, sliced);
    }
    if (nativeSourceNames.size > 0) {
      console.log(
        `[digest] native reserve lang=${lang} sources=${nativeSourceNames.size} ` +
          `itemsKept=${nativeReserved}`,
      );
    }

    const allSliced = [...slicedByCategory.values()].flat();
    // titleHash was already set on each item during the corroboration pass above.
    const titleHashes = allSliced.map(i => i.titleHash!);

    const now = Date.now();

    // Read existing story tracking BEFORE writing so we know the previous cycle's
    // mentionCount. We merge read state + this cycle's increment in memory to
    // produce accurate, current StoryMeta without a second Redis round-trip.
    const uniqueHashes = [...new Set(titleHashes)];
    const storyTracks = await readStoryTracks(uniqueHashes).catch(() => new Map<string, StoryTrack>());

    // Write story tracking. Errors never fail the digest build.
    await writeStoryTracking(allSliced, variant, lang, titleHashes, memberHashesByFinal).catch((err: unknown) =>
      console.warn('[digest] story tracking write failed:', err),
    );

    for (const [category, sliced] of slicedByCategory) {
      categories[category] = {
        items: sliced.map((item) => {
          const hash = item.titleHash!;
          // #4919: cluster-wide source count assigned by assignStoryIdentity.
          const sourceCount = item.corroborationCount ?? 1;
          const stale = storyTracks.get(hash);
          // Merge stale state + this cycle's HINCRBY to get the current mentionCount.
          // New stories (stale = undefined) start at mentionCount=1 this cycle.
          const mentionCount = stale ? stale.mentionCount + 1 : 1;
          const firstSeen = stale?.firstSeen ?? now;
          const merged: StoryTrack = {
            firstSeen,
            lastSeen: now,
            mentionCount,
            sourceCount,
            currentScore: stale?.currentScore ?? 0,
            peakScore: stale?.peakScore ?? 0,
          };
          const storyMeta: ProtoStoryMeta = {
            firstSeen,
            mentionCount,
            sourceCount,
            phase: derivePhase(merged),
          };
          return toProtoItem(item, storyMeta);
        }),
      };
    }

    // #4920: publish the coverage ledger — every gate's drop count plus
    // what survived — as a side key. Best-effort: ledger failures never
    // fail the digest. Read by ops tooling and the completeness reports;
    // deliberately NOT part of the proto response (no schema change).
    const distinctSources = new Set(allItems.map((item) => item.source)).size;
    const ledger = {
      v: 1,
      generatedAt: Date.now(),
      variant,
      lang,
      itemsIngested: allItems.length,
      itemsServed: allSliced.length,
      distinctSources,
      drops: { ...ledgerDrops },
    };
    // Key-cardinality clamp: variant/lang are request-supplied — only write
    // ledgers for known variants and well-formed 2-letter langs so a caller
    // spraying arbitrary values cannot inflate the keyspace.
    if (VARIANT_FEEDS[variant] && /^[a-z]{2}$/.test(lang)) {
      // #4927 review P2: awaited — a fire-and-forget write can be killed
      // when the response finishes before the side write lands.
      await setCachedJson(`news:coverage-ledger:v1:${variant}:${lang}`, ledger, 7200).catch((err: unknown) =>
        console.warn('[digest] coverage-ledger write failed:', err),
      );
    }

    return {
      categories,
      feedStatuses,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(deadlineTimeout);
  }
}

/** Internal exports for unit tests only — do not import in production code. */
export const __testing__ = {
  sliceCategoryWithNativeReserve,
  pickAcrossSources,
  FEED_FETCH_CONCURRENCY_DEFAULT,
  fetchRssText,
  isAbortError,
  FEED_TIMEOUT_MS,
  CACHE_TTL_EMPTY_S,
  ITEMS_PER_FEED,
  MAX_ITEMS_PER_CATEGORY,
  NATIVE_LANGUAGE_RESERVED_SLOTS,
  UNIVERSAL_POOL_LANGUAGE,
  parseRssXml,
  decodeXmlEntities,
  extractDescription,
  extractRawTagBody,
  extractFirstDateTag,
  buildStoryTrackHsetFields,
  computeImportanceScore,
  hasDiplomacyFlashpointSignal,
  promoteDiplomacySeverity,
  computeEntityCorroborationSignals,
  computeEntityCorroborationCounts,
  readStoryTracks,
  resolveMaxAgeMs,
  capLlmUpgrade,
  parseClassifyCacheHit,
  VERCEL_INITIAL_RESPONSE_LIMIT_MS,
  DIGEST_RESPONSE_TIMEOUT_MS,
  POST_FETCH_HEADROOM_MS,
  RESPONSE_GUARD_BAND_MS,
  OVERALL_DEADLINE_MS,
  MAX_DESCRIPTION_LEN,
  MIN_DESCRIPTION_LEN,
  FUTURE_DATE_TOLERANCE_MS,
};
