/**
 * Per-category native-language reserve.
 *
 * The regression this locks: on 2026-08-08 the live digest was read for eight
 * non-English UI languages after ~40 native sources had been added to both
 * catalogs. All eight returned byte-identical results and not one of the new
 * sources appeared. They were fetched and parsed — per-feed statuses reported
 * no errors — and then every item ranked below MAX_ITEMS_PER_CATEGORY.
 * `cs`/europe held 20 items from 13 sources, every one English-pool.
 *
 * Catalog size could not have fixed it. The deciding variable is how crowded
 * the category already is: the Brazilian pack takes 15 of latam's 20 slots
 * because latam holds ~11 sources, while europe (~90) and asia (~61) admit
 * none at any pack size. So the fix is a reserve at the truncation point, and
 * this file is what keeps it honest.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __testing__ } from '../server/worldmonitor/news/v1/list-feed-digest.ts';

const {
  sliceCategoryWithNativeReserve,
  pickAcrossSources,
  MAX_ITEMS_PER_CATEGORY,
  NATIVE_LANGUAGE_RESERVED_SLOTS,
  UNIVERSAL_POOL_LANGUAGE,
  ITEMS_PER_FEED,
} = __testing__;

/**
 * Items are consumed pre-sorted by rank, so descending scores here mirror what
 * buildDigest hands the slicer. English items outrank every native one, which
 * is exactly the situation that produced 0/20 in production.
 */
const makeItems = (specs: Array<{ source: string; count: number }>, startScore = 1000) => {
  let score = startScore;
  return specs.flatMap(({ source, count }) =>
    Array.from({ length: count }, (_, i) => ({
      source,
      title: `${source} item ${i}`,
      importanceScore: score--,
      publishedAt: 1_700_000_000_000 - score,
    })),
  );
};

describe('per-category native-language reserve', () => {
  it('keeps the cap and the reserve in a sane relationship', () => {
    assert.ok(
      NATIVE_LANGUAGE_RESERVED_SLOTS < MAX_ITEMS_PER_CATEGORY,
      'a reserve at or above the cap would hand the whole category to native sources',
    );
    assert.ok(
      NATIVE_LANGUAGE_RESERVED_SLOTS * 2 <= MAX_ITEMS_PER_CATEGORY,
      'the majority of every category must stay with the global ranking',
    );
  });

  it('admits native sources into a category the English pool has saturated', () => {
    // The shape of the observed failure: 90 English items outranking 20 Czech.
    const items = makeItems([
      ...Array.from({ length: 9 }, (_, i) => ({ source: `EN Source ${i}`, count: 10 })),
      { source: 'ČT24', count: 5 },
      { source: 'iRozhlas', count: 5 },
      { source: 'Novinky.cz', count: 5 },
      { source: 'Deník N', count: 5 },
    ]);
    const native = new Set(['ČT24', 'iRozhlas', 'Novinky.cz', 'Deník N']);

    const withoutReserve = items.slice(0, MAX_ITEMS_PER_CATEGORY);
    assert.equal(
      withoutReserve.filter((i) => native.has(i.source)).length,
      0,
      'precondition: a plain slice is what produced 0 native items in production',
    );

    const sliced = sliceCategoryWithNativeReserve(items, native);
    assert.equal(sliced.length, MAX_ITEMS_PER_CATEGORY, 'category stays exactly at the cap');
    assert.equal(
      sliced.filter((i) => native.has(i.source)).length,
      NATIVE_LANGUAGE_RESERVED_SLOTS,
      'the reserve is filled when native items are available',
    );
  });

  it('hands unused reserve back to the global ranking rather than shipping short', () => {
    // A language with two native items must not cost the category six slots.
    const items = makeItems([
      ...Array.from({ length: 9 }, (_, i) => ({ source: `EN Source ${i}`, count: 10 })),
      { source: 'Dnevnik', count: 2 },
    ]);
    const sliced = sliceCategoryWithNativeReserve(items, new Set(['Dnevnik']));

    assert.equal(sliced.length, MAX_ITEMS_PER_CATEGORY, 'no short category');
    assert.equal(sliced.filter((i) => i.source === 'Dnevnik').length, 2, 'both native items kept');
  });

  it('is inert for the universal-pool language, where the untagged pool IS that language', () => {
    const items = makeItems([{ source: 'BBC World', count: 40 }]);
    // buildDigest passes an empty set for UNIVERSAL_POOL_LANGUAGE.
    assert.equal(UNIVERSAL_POOL_LANGUAGE, 'en');
    assert.deepEqual(
      sliceCategoryWithNativeReserve(items, new Set()),
      items.slice(0, MAX_ITEMS_PER_CATEGORY),
      'an empty native set must reduce to a plain slice',
    );
  });

  it('does not disturb a category that was already under the cap', () => {
    const items = makeItems([{ source: 'BBC World', count: 4 }, { source: 'ČT24', count: 3 }]);
    assert.deepEqual(
      sliceCategoryWithNativeReserve(items, new Set(['ČT24'])),
      items,
      'under-cap categories pass through untouched',
    );
  });

  it('lets native sources exceed the reserve on merit when the general pool is thin', () => {
    // latam already behaves this way without any reserve — O Globo, Folha and
    // Brasil Paralelo take 15 of 20 slots because little else competes.
    const items = makeItems([
      { source: 'O Globo', count: 5 },
      { source: 'Folha de S.Paulo', count: 5 },
      { source: 'Brasil Paralelo', count: 5 },
      { source: 'Guardian Americas', count: 4 },
      { source: 'InSight Crime', count: 1 },
    ]);
    const native = new Set(['O Globo', 'Folha de S.Paulo', 'Brasil Paralelo']);
    const sliced = sliceCategoryWithNativeReserve(items, native);

    assert.equal(
      sliced.filter((i) => native.has(i.source)).length,
      15,
      'the reserve is a floor, not a ceiling — merit still applies above it',
    );
  });

  it('spreads the reserve across sources instead of letting two feeds take it', () => {
    // The measured failure: tr filled 8/8 but drew every item from BBC Turkce
    // and DW Turkish while six other Turkish sources sat unused. ITEMS_PER_FEED
    // is 5 and the reserve is 8, so two feeds saturate it on a plain slice.
    assert.ok(
      ITEMS_PER_FEED * 2 >= NATIVE_LANGUAGE_RESERVED_SLOTS,
      'precondition: two feeds can saturate the reserve, which is why spreading is needed',
    );
    const items = makeItems([
      ...Array.from({ length: 9 }, (_, i) => ({ source: `EN Source ${i}`, count: 10 })),
      { source: 'BBC Turkce', count: 5 },
      { source: 'DW Turkish', count: 5 },
      { source: 'Cumhuriyet', count: 5 },
      { source: 'Gazete Duvar', count: 5 },
      { source: 'Sabah', count: 5 },
      { source: 'Anadolu Ajansı', count: 5 },
    ]);
    const native = new Set([
      'BBC Turkce', 'DW Turkish', 'Cumhuriyet', 'Gazete Duvar', 'Sabah', 'Anadolu Ajansı',
    ]);

    const sliced = sliceCategoryWithNativeReserve(items, native);
    const nativeKept = sliced.filter((i) => native.has(i.source));
    assert.equal(nativeKept.length, NATIVE_LANGUAGE_RESERVED_SLOTS, 'reserve still fills');
    assert.equal(
      new Set(nativeKept.map((i) => i.source)).size,
      6,
      'all six native sources are represented, not just the two best-ranked',
    );
  });

  it('never displaces a stronger source with a weaker one while spreading', () => {
    const items = makeItems([
      { source: 'Strong', count: 5 },
      { source: 'Weak', count: 5 },
    ]);
    const picked = pickAcrossSources(items, 4);
    // Round order follows each source's best item, so Strong leads every round.
    assert.deepEqual(
      picked.map((i) => i.source),
      ['Strong', 'Weak', 'Strong', 'Weak'],
      'sources alternate in order of their best-ranked item',
    );
    const strongPicked = picked.filter((i) => i.source === 'Strong');
    assert.deepEqual(
      strongPicked.map((i) => i.importanceScore),
      items.filter((i) => i.source === 'Strong').slice(0, 2).map((i) => i.importanceScore),
      'within a source, rank order is preserved exactly',
    );
  });

  it('falls back to one source when that is all the language has', () => {
    const items = makeItems([{ source: 'Dnevnik', count: 5 }]);
    assert.equal(
      pickAcrossSources(items, NATIVE_LANGUAGE_RESERVED_SLOTS).length,
      5,
      'spreading must not invent items a single source cannot supply',
    );
  });

  it('orders survivors by rank, so the reserve changes which items survive, not their order', () => {
    const items = makeItems([
      ...Array.from({ length: 9 }, (_, i) => ({ source: `EN Source ${i}`, count: 10 })),
      { source: 'ČT24', count: 10 },
    ]);
    const sliced = sliceCategoryWithNativeReserve(items, new Set(['ČT24']));

    const scores = sliced.map((i) => i.importanceScore);
    assert.deepEqual(
      scores,
      [...scores].sort((a, b) => b - a),
      'output stays in descending rank order',
    );
  });
});
