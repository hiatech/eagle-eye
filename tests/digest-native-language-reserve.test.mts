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
  MAX_ITEMS_PER_CATEGORY,
  NATIVE_LANGUAGE_RESERVED_SLOTS,
  UNIVERSAL_POOL_LANGUAGE,
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
