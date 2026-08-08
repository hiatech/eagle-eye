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
  validateMultiUrlDigestParity,
  validateTagParity,
  validateVariantTagConsistency,
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

  it('keeps lang tags identical across both catalogs', () => {
    assert.deepEqual(
      validateTagParity(inputs),
      [],
      'a name carried by both catalogs under different lang tags behaves as two ' +
      'different feeds — run `npm run report:language-coverage`',
    );
  });

  it('flags a tag-parity allowlist entry once the drift it excuses is gone', () => {
    // The stale direction, proven without editing the catalogs: an entry for a
    // feed whose tags already agree must fail. Without this the allowlist is a
    // one-way valve — drift gets excused once and the excuse never expires.
    const aligned = inputs.clientFeeds.find((clientFeed) => {
      const serverFeed = inputs.serverFeeds.find((f) => f.name === clientFeed.name);
      return serverFeed && (clientFeed.lang ?? null) === (serverFeed.lang ?? null);
    });
    assert.ok(aligned, 'expected at least one feed with matching tags in both catalogs');
    const problems = validateTagParity({
      ...inputs,
      policy: { tagParityAllowlist: { [aligned.name]: 'stale' } },
    });
    assert.ok(
      problems.some((p) => p.startsWith(`${aligned.name}:`) && p.includes('stale')),
      'an allowlist entry must fail once its drift is resolved',
    );
  });

  it('flags a tag-parity allowlist entry for a feed no longer in both catalogs', () => {
    const problems = validateTagParity({
      ...inputs,
      policy: { tagParityAllowlist: { 'Feed That Does Not Exist': 'dead config' } },
    });
    assert.ok(
      problems.some((p) => p.startsWith('Feed That Does Not Exist:')),
      'a dead allowlist entry would silently excuse a name nothing checks anymore',
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

  it('declares one lang tag per feed name across every client variant map', () => {
    assert.deepEqual(
      validateVariantTagConsistency(inputs),
      [],
      'the canonical union dedupes by URL and keeps the first map, so a variant-only ' +
      'tag is invisible to every other check here — run `npm run report:language-coverage`',
    );
  });

  it('sees a variant-only lang tag the canonical union hides', () => {
    // The blind spot itself, proven without touching the catalogs: FULL declares
    // the feed untagged, a later variant map re-declares the same name tagged.
    // mergeCanonicalFeeds keeps FULL's object, so nativeUnboosted and the tag
    // parity check both stay green while the tech variant fetches the tagged
    // copy and drops it for every non-ja locale.
    const problems = validateVariantTagConsistency({
      variantFeedMaps: {
        full: { tech: [{ name: 'Hacker News', url: 'https://hnrss.org/frontpage' }] },
        tech: { tech: [{ name: 'Hacker News', url: 'https://hnrss.org/frontpage', lang: 'ja' }] },
      },
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^Hacker News: declared with conflicting lang tags/);
    assert.match(problems[0], /untagged in full/);
    assert.match(problems[0], /ja in tech/);
  });

  it('matches the multi-URL digest allowlist exactly', () => {
    // Two-way, like the other allowlists: a NEW locale-keyed client feed whose
    // server twin is single-URL fails until documented, and an entry survives
    // only as long as the divergence does.
    assert.deepEqual(
      validateMultiUrlDigestParity(inputs),
      [],
      'a locale-keyed pane with an English-only brief is invisible to every other ' +
      'check here — run `npm run report:language-coverage`',
    );
  });

  it('flags a locale-keyed feed whose server twin serves one language', () => {
    const problems = validateMultiUrlDigestParity({
      languages: ['en', 'ar'],
      clientFeeds: [{ name: 'Probe', url: { en: 'https://x/en', ar: 'https://x/ar' } }],
      serverFeeds: [{ name: 'Probe', url: 'https://x/en' }],
      policy: {},
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^Probe: client serves ar from a locale-keyed URL/);
  });

  it('flags a multi-URL allowlist entry once the divergence is gone', () => {
    const problems = validateMultiUrlDigestParity({
      languages: ['en', 'ar'],
      clientFeeds: [{ name: 'Probe', url: { ar: 'https://x/ar' } }],
      serverFeeds: [{ name: 'Probe', url: 'https://x/ar', lang: 'ar' }],
      policy: { multiUrlDigestAllowlist: { Probe: 'stale' } },
    });
    assert.ok(
      problems.some((p) => p.startsWith('Probe:') && p.includes('no longer diverges')),
      'a resolved divergence must retire its entry',
    );
  });

  it('carries no inert floor entry', () => {
    // Unlisted languages default to 1 and zero is checked BEFORE the floor, so a
    // committed floor of 0 or 1 can never fire. Such an entry reads as coverage
    // protection in review and provides none — the exact false comfort that let
    // `floors: {}` sit under a _readme claiming it was a ratchet.
    const inert = Object.entries(inputs.policy.floors ?? {})
      .filter(([, floor]) => Number(floor) < 2)
      .map(([language, floor]) => `${language}=${floor}`);
    assert.deepEqual(
      inert,
      [],
      'a floor below 2 is unreachable — drop the entry, or raise it to the pack size it protects',
    );
  });

  it('enforces every committed floor against the live catalog', () => {
    // The floors test below proves the MECHANISM with a synthetic value; this
    // proves the COMMITTED values still bind, so a pack that gets thinned out
    // fails here rather than after someone notices the panel got shorter.
    const rows = computeLanguageCoverage(inputs);
    const byLanguage = new Map(rows.map((row) => [row.language, row]));
    const breaching = Object.entries(inputs.policy.floors ?? {})
      .filter(([language, floor]) => (byLanguage.get(language)?.nativeClient.length ?? 0) < Number(floor))
      .map(([language, floor]) => `${language}: ${byLanguage.get(language)?.nativeClient.length ?? 0} < ${floor}`);
    assert.deepEqual(breaching, [], 'committed floors must hold against the catalogs');
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
  it('fails when a documented gap is dropped from the allowlist', async () => {
    // Data-driven off the committed policy rather than naming a language:
    // pinning this to a specific gap makes the test fail the moment that gap
    // is CLOSED, which punishes exactly the work the audit exists to drive.
    // Vacuous once every gap is closed — the mechanism stays covered by the
    // synthetic stale-entry and floor tests below.
    const documented = [
      ...Object.keys(inputs.policy.zeroNativeAllowlist ?? {}),
      ...Object.keys(inputs.policy.digestBlindAllowlist ?? {}),
    ];
    const violations = await auditWithPolicy({
      universalPoolLanguage: 'en',
      floors: {},
      zeroNativeAllowlist: {},
      digestBlindAllowlist: {},
    });
    const unexplained = documented.filter(
      (lang) => !violations.some((v) => v.startsWith(`${lang}:`)),
    );
    assert.deepEqual(
      unexplained,
      [],
      'every allowlisted language must resurface as a violation once its entry is ' +
      'removed — an entry that does not is documenting a gap that no longer exists',
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
    const policy = {
      universalPoolLanguage: 'tr',
      floors: {},
      zeroNativeAllowlist: { fa: 'documented' },
      digestBlindAllowlist: { ar: 'documented', pt: 'documented' },
    };
    const rows = computeLanguageCoverage({ ...inputs, policy });

    // The exemption MOVES, it does not spread: declaring tr the pool exempts tr
    // and puts en back under audit. (This used to assert an `en:` violation,
    // which worked only while en had zero server-native sources; the locale
    // maps in _feeds.ts gave it some, so the assertion has to test the
    // invariant rather than that incidental gap.)
    assert.deepEqual(rows.filter((row) => row.isUniversalPool).map((row) => row.language), ['tr']);
    assert.notEqual(
      rows.find((row) => row.language === 'en')?.status,
      'UNIVERSAL-POOL',
      'moving the exemption must put the previous pool language back under audit',
    );

    // …and every other language is still evaluated, not globally silenced:
    // these allowlist entries describe gaps that no longer exist, so they must
    // still surface as stale.
    const violations = await auditWithPolicy(policy);
    for (const language of ['fa', 'ar', 'pt']) {
      assert.ok(
        violations.some((v) => v.startsWith(`${language}:`) && v.includes('stale')),
        `${language} must still be audited when the pool language moves`,
      );
    }
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

  it('keeps locale codes that are not two letters', () => {
    // A shape filter (/[a-z]{2}/) silently dropped these, and a language the
    // audit never sees is a language the audit never gates.
    assert.deepEqual(
      parseSupportedLanguages("const SUPPORTED_LANGUAGES = ['en', 'fil', 'ceb', 'pt-BR'] as const;\n"),
      ['en', 'fil', 'ceb', 'pt-BR'],
    );
  });

  it('ignores commented-out entries instead of reading them back as live', () => {
    const source = "const SUPPORTED_LANGUAGES = [\n"
      + "  'en',\n"
      + "  // 'xx' retired in v2\n"
      + "  /* 'yy' never shipped */\n"
      + "  'tr',\n"
      + '] as const;\n';
    assert.deepEqual(parseSupportedLanguages(source), ['en', 'tr']);
  });

  it('throws on an entry it cannot read rather than skipping it', () => {
    assert.throws(
      () => parseSupportedLanguages(
        'const SUPPORTED_LANGUAGES = [...LEGACY_LANGUAGES, \'en\'] as const;\n',
      ),
      /is not a plain string literal/,
      'skipping an unreadable entry is how a language silently escapes the audit',
    );
  });
});
