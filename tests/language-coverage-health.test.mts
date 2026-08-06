/**
 * UI-language / native-source coverage gate.
 *
 * The app ships 26 translated UI languages, but a feed only reaches a user
 * whose UI language matches its `lang` tag (src/services/feed-language.ts), and
 * the client and server digest catalogs are independent files. Nothing failed
 * when those drifted apart, so a language could ship a fully translated
 * interface over a news pane with no journalism in that language, or carry
 * native sources the AI briefs never ingest. This locks the audit into CI:
 *
 *   1. every `lang` tag in both catalogs resolves to a supported UI language
 *      (an unsupported tag is unreachable dead config)
 *   2. the zeroNativeAllowlist and digestBlindAllowlist in
 *      shared/language-coverage-policy.json match reality EXACTLY — both
 *      directions: undocumented new gaps fail, and so do stale entries once
 *      native or digest coverage lands
 *
 * Run the human-readable report with: npm run report:language-coverage
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeLanguageCoverage,
  evaluateLanguageCoverage,
  loadLanguageCoverageInputs,
  parseSupportedLanguages,
  validateLanguageTags,
} from '../scripts/language-coverage-health.mjs';

type Inputs = Awaited<ReturnType<typeof loadLanguageCoverageInputs>>;

let inputs: Inputs;
let tempDir: string;

before(async () => {
  inputs = await loadLanguageCoverageInputs();
  tempDir = mkdtempSync(join(tmpdir(), 'language-coverage-gate-'));
});

after(() => {
  inputs?.cleanup();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/** Re-run the audit against a policy override, without touching the repo file. */
async function auditWithPolicy(policy: unknown): Promise<string[]> {
  const policyPath = join(tempDir, `policy-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(policyPath, JSON.stringify(policy), 'utf8');
  const overridden = await loadLanguageCoverageInputs(undefined, { policyPath });
  try {
    const rows = computeLanguageCoverage(overridden);
    return evaluateLanguageCoverage(rows).violations;
  } finally {
    overridden.cleanup();
  }
}

describe('language coverage gate', () => {
  it('audits every supported UI language exactly once', () => {
    const rows = computeLanguageCoverage(inputs);
    assert.deepEqual(
      rows.map((row) => row.language).sort(),
      [...inputs.languages].sort(),
      'every SUPPORTED_LANGUAGES entry must get a coverage row',
    );
    assert.equal(new Set(rows.map((row) => row.language)).size, rows.length, 'no duplicate rows');
  });

  it('ships a locale file for every supported UI language', () => {
    const rows = computeLanguageCoverage(inputs);
    const missing = rows.filter((row) => !row.hasLocale).map((row) => row.language);
    assert.deepEqual(missing, [], 'SUPPORTED_LANGUAGES entries without src/locales/<lang>.json');
  });

  it('has no feed tagged for a language no user can select', () => {
    assert.deepEqual(validateLanguageTags(inputs), []);
  });

  it('matches the committed policy exactly — no undocumented gaps, no stale entries', () => {
    const rows = computeLanguageCoverage(inputs);
    const { violations } = evaluateLanguageCoverage(rows);
    assert.deepEqual(
      violations,
      [],
      'coverage drifted from shared/language-coverage-policy.json — run ' +
      '`npm run report:language-coverage` for the table',
    );
  });

  it('locale-boosts every native source for its own locale', () => {
    // The startup boost (App.ts → getLocaleBoostedSources) walks FULL_FEEDS +
    // INTEL_SOURCES, while the catalog audited here is the canonical union of
    // every variant map. A native feed added to any other variant map would be
    // unreachable in practice: the reduction migration writes it into the
    // disabled set and no boost ever takes it back out, so it would sit in the
    // catalog looking present while no user in its own language could see it.
    const rows = computeLanguageCoverage(inputs);
    const unboosted = rows
      .filter((row) => row.nativeUnboosted.length > 0)
      .map((row) => `${row.language}: ${row.nativeUnboosted.join(', ')}`);
    assert.deepEqual(
      unboosted,
      [],
      'native sources outside FULL_FEEDS are never locale-boosted — move them into ' +
      'FULL_FEEDS or widen getLanguageMatchedSources in src/config/feeds.ts',
    );
  });

  it('exempts only the universal-pool language from the native-source floor', () => {
    const rows = computeLanguageCoverage(inputs);
    const exempt = rows.filter((row) => row.isUniversalPool).map((row) => row.language);
    assert.deepEqual(
      exempt,
      ['en'],
      'exactly one language carries the untagged pool; exempting a second would ' +
      'silently stop auditing it',
    );
  });
});

describe('language coverage ratchet fails in both directions', () => {
  it('fails when a real gap is dropped from the allowlist', async () => {
    const violations = await auditWithPolicy({
      universalPoolLanguage: 'en',
      floors: {},
      zeroNativeAllowlist: {},
      digestBlindAllowlist: {},
    });
    assert.ok(
      violations.some((v) => v.startsWith('fa:')),
      'emptying zeroNativeAllowlist must resurface the fa gap',
    );
    assert.ok(
      violations.some((v) => v.startsWith('ar:')),
      'emptying digestBlindAllowlist must resurface the ar digest gap',
    );
  });

  it('fails when an allowlist entry outlives the gap it documents', async () => {
    const violations = await auditWithPolicy({
      universalPoolLanguage: 'en',
      floors: {},
      // tr has native sources today, so listing it as a zero-coverage language
      // is exactly the stale entry the ratchet must catch.
      zeroNativeAllowlist: { tr: 'stale entry — tr has native sources' },
      digestBlindAllowlist: {},
    });
    assert.ok(
      violations.some((v) => v.startsWith('tr:') && v.includes('stale')),
      'a language that gained coverage must fail until its allowlist entry is removed',
    );
  });

  it('fails when a raised floor is not met', async () => {
    const violations = await auditWithPolicy({
      universalPoolLanguage: 'en',
      floors: { tr: 99 },
      zeroNativeAllowlist: { fa: 'documented' },
      digestBlindAllowlist: { ar: 'documented', pt: 'documented' },
    });
    assert.ok(
      violations.some((v) => v.startsWith('tr:') && v.includes('below floor 99')),
      'floors must be enforced, not decorative',
    );
  });

  it('cannot be silenced by declaring a different universal-pool language', async () => {
    const violations = await auditWithPolicy({
      universalPoolLanguage: 'tr',
      floors: {},
      zeroNativeAllowlist: { fa: 'documented' },
      digestBlindAllowlist: { ar: 'documented', pt: 'documented' },
    });
    // Exempting tr does not exempt en, so en's own (unmeasurable) tag count
    // now surfaces instead of being quietly folded into the pool.
    assert.ok(
      violations.some((v) => v.startsWith('en:')),
      'moving the exemption must expose the language that actually holds the pool',
    );
  });
});

describe('parseSupportedLanguages', () => {
  it('reads the declaration from i18n source', () => {
    const parsed = parseSupportedLanguages(
      "const SUPPORTED_LANGUAGES = ['en', 'tr', 'zh'] as const;\n",
    );
    assert.deepEqual(parsed, ['en', 'tr', 'zh']);
  });

  it('throws rather than falling back when the declaration moves', () => {
    assert.throws(
      () => parseSupportedLanguages('const LANGS = ["en"];\n'),
      /could not find/,
      'a silent fallback would let the audit run against a stale hardcoded list',
    );
  });
});
