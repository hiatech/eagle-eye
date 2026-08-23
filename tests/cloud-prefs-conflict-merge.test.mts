import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mergeCloudWithLocalDirty,
  parsePersistedDirtyKeys,
  settledDirtyKeys,
} from '../src/utils/cloud-prefs-migrations.ts';

describe('mergeCloudWithLocalDirty', () => {
  it('with no dirty keys, returns the cloud blob verbatim (string values only)', () => {
    const cloud = { 'eagleeye-theme': 'dark', 'wm-market-watchlist-v1': '["AAPL"]' };
    const local = { 'eagleeye-theme': 'light', 'wm-market-watchlist-v1': '["TSLA"]' };
    assert.deepEqual(mergeCloudWithLocalDirty(cloud, local, []), cloud);
  });

  it('a dirty key present locally wins over the cloud value', () => {
    const cloud = { 'wm-market-watchlist-v1': '["AAPL"]', 'eagleeye-theme': 'dark' };
    const local = { 'wm-market-watchlist-v1': '["GLW","LLY","ENTG"]', 'eagleeye-theme': 'dark' };
    const merged = mergeCloudWithLocalDirty(cloud, local, ['wm-market-watchlist-v1']);
    assert.equal(merged['wm-market-watchlist-v1'], '["GLW","LLY","ENTG"]');
    // non-dirty key still takes the cloud value
    assert.equal(merged['eagleeye-theme'], 'dark');
  });

  it('REGRESSION: the just-typed local watchlist survives a 409 conflict', () => {
    // The reported bug: user types 7 tickers, the debounced upload 409s, and
    // the old conflict path overwrote localStorage with the cloud blob —
    // losing all 7. The merge must keep them.
    const cloudData = { 'wm-market-watchlist-v1': '[]' }; // stale cloud row
    const localBlob = { 'wm-market-watchlist-v1': '["GLW","LLY","ENTG","FLNC","KULR","ONDS","QCOM"]' };
    const merged = mergeCloudWithLocalDirty(cloudData, localBlob, ['wm-market-watchlist-v1']);
    assert.equal(
      merged['wm-market-watchlist-v1'],
      '["GLW","LLY","ENTG","FLNC","KULR","ONDS","QCOM"]',
    );
  });

  it('a dirty key removed locally is dropped from the merge', () => {
    // User reset the watchlist (removeItem) — the key is dirty but absent
    // from localBlob. The merge must NOT resurrect the cloud value.
    const cloud = { 'wm-market-watchlist-v1': '["AAPL"]', 'eagleeye-theme': 'dark' };
    const local = { 'eagleeye-theme': 'dark' }; // watchlist removed locally
    const merged = mergeCloudWithLocalDirty(cloud, local, ['wm-market-watchlist-v1']);
    assert.equal('wm-market-watchlist-v1' in merged, false);
    assert.equal(merged['eagleeye-theme'], 'dark');
  });

  it('a concurrent change on a non-dirty key survives (cloud wins for keys we did not touch)', () => {
    // Cloud advanced because another device changed the theme; locally we
    // only touched the watchlist. Both changes must survive the merge.
    const cloud = { 'eagleeye-theme': 'light', 'wm-market-watchlist-v1': '["AAPL"]' };
    const local = { 'eagleeye-theme': 'dark', 'wm-market-watchlist-v1': '["TSLA"]' };
    const merged = mergeCloudWithLocalDirty(cloud, local, ['wm-market-watchlist-v1']);
    assert.equal(merged['eagleeye-theme'], 'light'); // other device's change kept
    assert.equal(merged['wm-market-watchlist-v1'], '["TSLA"]'); // our change kept
  });

  it('a dirty key that exists only locally is included', () => {
    const cloud = { 'eagleeye-theme': 'dark' };
    const local = { 'eagleeye-theme': 'dark', 'wm-market-watchlist-v1': '["TSLA"]' };
    const merged = mergeCloudWithLocalDirty(cloud, local, ['wm-market-watchlist-v1']);
    assert.equal(merged['wm-market-watchlist-v1'], '["TSLA"]');
  });

  it('REGRESSION: a locally dirty My Monitors edit survives a reload before upload', () => {
    const monitors = JSON.stringify([
      { id: 'monitor-1', keywords: ['iran', 'hormuz'], color: '#44ff88' },
    ]);
    const cloud = { 'eagleeye-theme': 'dark' };
    const local = { 'eagleeye-theme': 'dark', 'eagleeye-monitors': monitors };
    const merged = mergeCloudWithLocalDirty(cloud, local, ['eagleeye-monitors']);
    assert.equal(merged['eagleeye-monitors'], monitors);
    assert.equal(merged['eagleeye-theme'], 'dark');
  });

  it('drops non-string cloud values', () => {
    const cloud = { 'eagleeye-theme': 'dark', 'wm-bogus': 42, 'wm-nullish': null } as Record<string, unknown>;
    const merged = mergeCloudWithLocalDirty(cloud, {}, []);
    assert.deepEqual(merged, { 'eagleeye-theme': 'dark' });
  });

  it('does not mutate its inputs', () => {
    const cloud = { 'eagleeye-theme': 'dark' };
    const local = { 'eagleeye-theme': 'light' };
    const cloudCopy = { ...cloud };
    const localCopy = { ...local };
    mergeCloudWithLocalDirty(cloud, local, ['eagleeye-theme']);
    assert.deepEqual(cloud, cloudCopy);
    assert.deepEqual(local, localCopy);
  });
});

describe('settledDirtyKeys', () => {
  it('a dirty key whose posted value still matches local is settled', () => {
    const posted = { 'wm-market-watchlist-v1': '["GLW"]' };
    const local = { 'wm-market-watchlist-v1': '["GLW"]' };
    assert.deepEqual(settledDirtyKeys(posted, local, ['wm-market-watchlist-v1']), ['wm-market-watchlist-v1']);
  });

  it('a dirty key changed mid-flight (posted != current local) stays dirty', () => {
    const posted = { 'wm-market-watchlist-v1': '["GLW"]' };
    const local = { 'wm-market-watchlist-v1': '["GLW","LLY"]' }; // user typed more during the POST
    assert.deepEqual(settledDirtyKeys(posted, local, ['wm-market-watchlist-v1']), []);
  });

  it('REGRESSION: a key dirtied mid-flight and absent from the posted blob stays dirty', () => {
    // The race the reviewer flagged: postCloudPrefs({watchlist}) is in flight,
    // the user changes the theme. A blanket _dirtyKeys.clear() would drop
    // 'eagleeye-theme' even though it was never posted — then a later 409
    // would clobber it. settledDirtyKeys must keep it.
    const posted = { 'wm-market-watchlist-v1': '["GLW","LLY","ENTG"]' };
    const local = { 'wm-market-watchlist-v1': '["GLW","LLY","ENTG"]', 'eagleeye-theme': 'light' };
    const settled = settledDirtyKeys(posted, local, ['wm-market-watchlist-v1', 'eagleeye-theme']);
    assert.deepEqual(settled, ['wm-market-watchlist-v1']); // theme NOT settled
  });

  it('a synced removal settles (posted absent + local absent)', () => {
    const posted = { 'eagleeye-theme': 'dark' }; // watchlist removed → not in posted blob
    const local = { 'eagleeye-theme': 'dark' };  // still absent locally
    assert.deepEqual(settledDirtyKeys(posted, local, ['wm-market-watchlist-v1']), ['wm-market-watchlist-v1']);
  });

  it('a key removed-then-re-added mid-flight stays dirty', () => {
    const posted = { 'eagleeye-theme': 'dark' }; // posted as removed
    const local = { 'eagleeye-theme': 'dark', 'wm-market-watchlist-v1': '["TSLA"]' }; // re-added during POST
    assert.deepEqual(settledDirtyKeys(posted, local, ['wm-market-watchlist-v1']), []);
  });

  it('only considers keys in the dirty set', () => {
    // A non-dirty key that happens to differ between posted and local must
    // never be returned — we only ever clear keys we were tracking.
    const posted = { 'eagleeye-theme': 'dark' };
    const local = { 'eagleeye-theme': 'light' };
    assert.deepEqual(settledDirtyKeys(posted, local, []), []);
  });
});

describe('parsePersistedDirtyKeys', () => {
  const allowed = ['eagleeye-monitors', 'eagleeye-theme', 'wm-market-watchlist-v1'];

  it('restores a deduped allow-listed dirty key set after reload', () => {
    const raw = JSON.stringify({
      userId: 'user-a',
      keys: [
        'eagleeye-monitors',
        'not-a-sync-key',
        'eagleeye-monitors',
        42,
        'wm-market-watchlist-v1',
      ],
    });
    assert.deepEqual(
      parsePersistedDirtyKeys(raw, allowed, 'user-a'),
      ['eagleeye-monitors', 'wm-market-watchlist-v1'],
    );
  });

  it('rejects persisted dirty keys owned by another signed-in user', () => {
    const raw = JSON.stringify({
      userId: 'user-a',
      keys: ['eagleeye-monitors'],
    });
    assert.deepEqual(parsePersistedDirtyKeys(raw, allowed, 'user-b'), []);
  });

  it('treats corrupt persisted dirty state as empty', () => {
    assert.deepEqual(parsePersistedDirtyKeys('{bad json', allowed, 'user-a'), []);
    assert.deepEqual(parsePersistedDirtyKeys(JSON.stringify({ key: 'eagleeye-monitors' }), allowed, 'user-a'), []);
    assert.deepEqual(parsePersistedDirtyKeys(JSON.stringify(['eagleeye-monitors']), allowed, 'user-a'), []);
  });
});
