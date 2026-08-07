#!/usr/bin/env node
/**
 * UI-language / native-source coverage health audit.
 *
 * The app ships 26 UI languages, but `fetchCategoryFeeds` silently drops every
 * feed whose declared `lang` is not the current UI language unless it carries
 * `strategicDefault` (src/services/feed-language.ts). A feed with no `lang` is
 * universal — in practice English-language journalism. The consequence is not
 * obvious from either catalog on its own: a UI language can be fully translated
 * down to the last tooltip and still present a news pane containing no
 * journalism written in that language.
 *
 * Two catalogs have to agree for a native source to be fully wired:
 *
 *   src/config/feeds.ts                      → what the browser fetches directly
 *   server/worldmonitor/news/v1/_feeds.ts    → what buildDigest ingests for AI briefs
 *
 * They are independent files. A source present in only the first renders in the
 * news pane but never reaches a brief; present in only the second, the reverse.
 * tests/feeds-client-server-parity.test.mjs catches URL-routing drift between
 * them but not this membership gap, which is what this audit adds.
 *
 * Shared by tests/language-coverage-health.test.mts (CI gate) and
 * scripts/report-language-coverage.mjs (human-readable ops/product report).
 *
 * Loading note: feeds.ts pulls `rssProxyUrl` → `import.meta.env.DEV`, and Node
 * has no Vite env object, so we esbuild-bundle with defines + a stubbed
 * `@/utils` barrel — the same pattern as scripts/geo-coverage-health.mjs.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(SCRIPT_DIR, '..');

const I18N_PATH = 'src/services/i18n.ts';
const CLIENT_FEEDS_PATH = 'src/config/feeds.ts';
const SERVER_FEEDS_PATH = 'server/worldmonitor/news/v1/_feeds.ts';
const LOCALES_DIR = 'src/locales';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Extract SUPPORTED_LANGUAGES from src/services/i18n.ts lexically.
 *
 * Importing the module would drag in i18next plus the browser language
 * detector, which is a far heavier dependency than this audit needs and would
 * make the gate unrunnable in a bare checkout. The declaration is a frozen
 * `as const` array literal, so a lexical read is stable — and it throws rather
 * than falling back to a hardcoded list, because a silent stale copy is exactly
 * the drift this audit exists to catch.
 */
export function parseSupportedLanguages(source) {
  const match = source.match(/const SUPPORTED_LANGUAGES = \[([^\]]*)\] as const;/);
  if (!match) {
    throw new Error(
      `${I18N_PATH}: could not find "const SUPPORTED_LANGUAGES = [...] as const;" — ` +
      'the declaration moved or changed shape; update parseSupportedLanguages()',
    );
  }
  // Tokenise by ELEMENT, not by pattern-matching what a language code looks
  // like. A shape filter drops whatever it fails to recognise and reports
  // success on the remainder: `['en', 'fil', 'ceb', 'tr']` came back as
  // ['en', 'tr'] under an /[a-z]{2}/ read, and the three-letter locales were
  // then never audited at all — silently exempt from every check this file
  // exists to apply. Comments go first so a commented-out code is not read
  // back as a live entry.
  const body = match[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const entries = body.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new Error(`${I18N_PATH}: SUPPORTED_LANGUAGES matched but parsed to zero entries`);
  }
  return entries.map((entry) => {
    const quoted = /^'([^']+)'$/.exec(entry) ?? /^"([^"]+)"$/.exec(entry);
    if (!quoted) {
      throw new Error(
        `${I18N_PATH}: SUPPORTED_LANGUAGES entry ${JSON.stringify(entry)} is not a plain ` +
        'string literal — the declaration changed shape; update parseSupportedLanguages()',
      );
    }
    return quoted[1];
  });
}

/**
 * Bundle both feed catalogs into a temp dir and import them.
 * Returns { client, server, cleanup } — caller MUST run cleanup() when done.
 */
async function bundleFeedCatalogs(repoRoot) {
  const tempDir = mkdtempSync(join(tmpdir(), 'language-coverage-health-'));
  const outfile = join(tempDir, 'feeds-bundle.mjs');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(tempDir, { recursive: true, force: true });
  };
  // Stub the @/utils barrel so we don't drag proxy → i18n → import.meta.glob.
  // feeds.ts only needs rssProxyUrl, and identity is fine for a name registry.
  const stubUtilsPlugin = {
    name: 'stub-utils-barrel',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@\/utils$/ }, () => ({
        path: 'stub-utils',
        namespace: 'stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export function rssProxyUrl(url) { return url; }\n',
        loader: 'js',
      }));
    },
  };
  try {
    const result = await build({
      stdin: {
        contents: [
          `export * as client from './${CLIENT_FEEDS_PATH}';`,
          `export * as server from './${SERVER_FEEDS_PATH}';`,
        ].join('\n'),
        resolveDir: repoRoot,
        sourcefile: 'language-coverage-config-entry.ts',
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      write: false,
      absWorkingDir: repoRoot,
      alias: { '@': join(repoRoot, 'src') },
      plugins: [stubUtilsPlugin],
      define: {
        'import.meta.env': JSON.stringify({
          DEV: false,
          PROD: true,
          SSR: false,
          MODE: 'test',
          BASE_URL: '/',
          VITE_VARIANT: 'full',
          VITE_RSS_DIRECT_TO_RELAY: 'false',
        }),
      },
    });
    writeFileSync(outfile, result.outputFiles[0].text, 'utf8');
    const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
    return { client: mod.client, server: mod.server, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Every client feed across the canonical (all-variant) map plus intel sources. */
function collectClientFeeds(client) {
  return [...Object.values(client.CANONICAL_FEEDS).flat(), ...client.INTEL_SOURCES];
}

/** Every server digest feed across all variants plus intel sources. */
function collectServerFeeds(server) {
  const fromVariants = Object.values(server.VARIANT_FEEDS)
    .flatMap((categories) => Object.values(categories).flat());
  return [...fromVariants, ...server.INTEL_SOURCES];
}

/** Dedupe feeds by name, first occurrence wins (mirrors mergeCanonicalFeeds). */
function dedupeByName(feeds) {
  const byName = new Map();
  for (const feed of feeds) {
    if (!byName.has(feed.name)) byName.set(feed.name, feed);
  }
  return [...byName.values()];
}

/** Load every input the audit needs. */
export async function loadLanguageCoverageInputs(repoRoot = DEFAULT_REPO_ROOT, paths = {}) {
  const policyPath = paths.policyPath
    ?? process.env.LANGUAGE_COVERAGE_POLICY_PATH
    ?? join(repoRoot, 'shared/language-coverage-policy.json');

  const policy = readJson(policyPath);
  const languages = parseSupportedLanguages(readFileSync(join(repoRoot, I18N_PATH), 'utf8'));
  const localeFiles = new Set(
    readdirSync(join(repoRoot, LOCALES_DIR))
      .filter((name) => name.endsWith('.json') && !name.includes('.shell.'))
      .map((name) => name.replace(/\.json$/, '')),
  );

  const { client, server, cleanup } = await bundleFeedCatalogs(repoRoot);
  try {
    return {
      languages,
      localeFiles,
      policy,
      clientFeeds: dedupeByName(collectClientFeeds(client)),
      serverFeeds: dedupeByName(collectServerFeeds(server)),
      defaultEnabled: client.getAllDefaultEnabledSources(),
      // Per-variant declarations, pre-union — see validateVariantTagConsistency.
      variantFeedMaps: client.VARIANT_FEED_MAPS,
      // The startup locale boost (App.ts) walks FULL_FEEDS + INTEL_SOURCES, not
      // the canonical all-variant union, so a native feed added to any other
      // variant map would never be boosted for its own locale.
      getLocaleBoostedSources: client.getLocaleBoostedSources,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Flag `lang` tags that no UI language can ever select.
 *
 * A feed tagged for an unsupported language is unreachable dead config: the
 * filter drops it for every user, so it silently contributes nothing while
 * still counting toward the catalog size everyone quotes.
 */
export function validateLanguageTags({ languages, clientFeeds, serverFeeds }) {
  const supported = new Set(languages);
  const problems = [];
  for (const [label, feeds] of [['client', clientFeeds], ['server digest', serverFeeds]]) {
    const orphans = new Map();
    for (const feed of feeds) {
      if (feed.lang && !supported.has(feed.lang)) {
        const names = orphans.get(feed.lang) ?? [];
        names.push(feed.name);
        orphans.set(feed.lang, names);
      }
    }
    for (const [lang, names] of orphans) {
      problems.push(
        `${label} catalog: lang "${lang}" is not in SUPPORTED_LANGUAGES — ` +
        `${names.length} unreachable feed(s): ${names.join(', ')} — ` +
        `add the locale in ${I18N_PATH} or retag the feed(s)`,
      );
    }
  }
  return problems;
}

/**
 * Flag a feed name carrying different `lang` tags across the client's own
 * variant maps.
 *
 * `CANONICAL_FEEDS` — what every other check here reads — is built by
 * `mergeCanonicalFeeds`, which dedupes by URL and keeps the FIRST map's object.
 * Re-declare a FULL_FEEDS entry under the same name and URL in TECH_FEEDS with
 * a `lang` added and the union keeps FULL's untagged copy: the tagged one is
 * invisible to the audit while being the one the tech variant actually fetches,
 * because `FEEDS` is the active variant's map, not the union. Every language
 * check downstream then passes while non-matching locales silently lose the
 * source on that variant. Only the maps themselves can show this.
 */
export function validateVariantTagConsistency({ variantFeedMaps }) {
  const byName = new Map();
  for (const [variant, categories] of Object.entries(variantFeedMaps ?? {})) {
    for (const feeds of Object.values(categories)) {
      for (const feed of feeds) {
        const seen = byName.get(feed.name) ?? new Map();
        const lang = feed.lang ?? null;
        if (!seen.has(lang)) seen.set(lang, []);
        seen.get(lang).push(variant);
        byName.set(feed.name, seen);
      }
    }
  }
  const problems = [];
  for (const [name, byLang] of byName) {
    if (byLang.size < 2) continue;
    const detail = [...byLang.entries()]
      .map(([lang, variants]) => `${lang ?? 'untagged'} in ${[...new Set(variants)].join('/')}`)
      .join(', ');
    problems.push(
      `${name}: declared with conflicting lang tags across client variant maps — ` +
      `${detail}. The canonical union keeps only the first, so the audit cannot ` +
      'see the others; align them in src/config/feeds.ts',
    );
  }
  return problems;
}

/**
 * Flag multi-URL client feeds whose server twin serves a different language.
 *
 * `Feed.url` may be a locale map (`{ en: …, ar: … }`) and `fetchFeed` picks the
 * entry matching the UI language, so an `ar` reader's Middle East pane fetches
 * Al Jazeera in Arabic. `ServerFeed.url` is a plain string with no such
 * mechanism, so the digest fetches the one URL it has — English — under the
 * same feed name. The `ar` brief is then reasoned entirely from English
 * coverage while the pane beside it is in Arabic.
 *
 * Neither existing check sees this. validateTagParity compares `lang` tags and
 * both sides are untagged; the per-language digest check only asks whether a
 * language has ANY server-native source, and ar has Asharq News, so it passes.
 * The gap is per-FEED, and only a per-feed comparison finds it.
 */
export function validateMultiUrlDigestParity({ clientFeeds, serverFeeds, languages, policy }) {
  // `_`-prefixed keys are prose for the reader, not feed names.
  const allowlist = Object.fromEntries(
    Object.entries(policy?.multiUrlDigestAllowlist ?? {}).filter(([key]) => !key.startsWith('_')),
  );
  const supported = new Set(languages);
  const serverByName = new Map(serverFeeds.map((feed) => [feed.name, feed]));
  const problems = [];
  const seen = new Set();

  for (const clientFeed of clientFeeds) {
    if (!clientFeed.url || typeof clientFeed.url !== 'object') continue;
    const serverFeed = serverByName.get(clientFeed.name);
    if (!serverFeed) continue;
    // Locales this feed serves natively in the pane, minus whatever the server
    // twin already covers. An untagged server twin IS the universal pool, so it
    // covers that one language — every other locale key on the client is a pane
    // the digest cannot follow.
    const serverLang = serverFeed.lang ?? (policy?.universalPoolLanguage ?? 'en');
    const unmatched = Object.keys(clientFeed.url)
      .filter((locale) => supported.has(locale) && locale !== serverLang)
      .sort();
    if (unmatched.length === 0) continue;
    seen.add(clientFeed.name);
    if (allowlist[clientFeed.name]) continue;
    problems.push(
      `${clientFeed.name}: client serves ${unmatched.join('/')} from a locale-keyed URL, ` +
      `server digest has a single ${serverLang ?? 'untagged'} URL — readers in those ` +
      'locales get a pane in their language and a brief built from another. Mirror the ' +
      'locale URL into server/worldmonitor/news/v1/_feeds.ts as its own lang-tagged entry, ' +
      'or document it in multiUrlDigestAllowlist',
    );
  }

  for (const name of Object.keys(allowlist)) {
    if (!seen.has(name)) {
      problems.push(
        `${name}: multiUrlDigestAllowlist entry for a feed that no longer diverges — ` +
        'remove it from shared/language-coverage-policy.json',
      );
    }
  }
  return problems;
}

/**
 * Flag feeds whose `lang` tag differs between the two catalogs.
 *
 * The tag is what scopes a feed to a locale, so a name carried by both catalogs
 * under different tags behaves as two different feeds. The direction decides
 * which half breaks: tagged on the server but untagged on the client publishes
 * that language into every locale's panel, while tagged on the client but
 * untagged on the server hides it from the pane for readers whose brief still
 * ingests it. Neither is visible from either file alone.
 */
export function validateTagParity({ clientFeeds, serverFeeds, policy }) {
  const allowlist = policy.tagParityAllowlist ?? {};
  const serverByName = new Map(serverFeeds.map((feed) => [feed.name, feed]));
  const problems = [];
  const seen = new Set();

  for (const clientFeed of clientFeeds) {
    const serverFeed = serverByName.get(clientFeed.name);
    if (!serverFeed) continue;
    seen.add(clientFeed.name);
    const clientLang = clientFeed.lang ?? null;
    const serverLang = serverFeed.lang ?? null;
    if (clientLang === serverLang) {
      if (allowlist[clientFeed.name]) {
        problems.push(
          `${clientFeed.name}: lang tags agree now (${clientLang ?? 'untagged'}) — ` +
          'remove the stale entry from tagParityAllowlist in ' +
          'shared/language-coverage-policy.json',
        );
      }
      continue;
    }
    if (allowlist[clientFeed.name]) continue;
    problems.push(
      `${clientFeed.name}: lang tag differs between catalogs — ` +
      `client=${clientLang ?? 'untagged'} server=${serverLang ?? 'untagged'}. ` +
      'Align them, or document the divergence in tagParityAllowlist',
    );
  }

  // An allowlist entry for a feed that is no longer in both catalogs is dead
  // config that would silently keep excusing a name nothing checks anymore.
  for (const name of Object.keys(allowlist)) {
    if (!seen.has(name)) {
      problems.push(
        `${name}: tagParityAllowlist entry for a feed that is no longer in both ` +
        'catalogs — remove it from shared/language-coverage-policy.json',
      );
    }
  }
  return problems;
}

/** Build one coverage row per supported UI language. */
export function computeLanguageCoverage(inputs) {
  const { languages, localeFiles, policy, clientFeeds, serverFeeds, defaultEnabled } = inputs;

  const universalClient = clientFeeds.filter((feed) => !feed.lang).length;
  const universalServer = serverFeeds.filter((feed) => !feed.lang).length;
  const universalPoolLanguage = policy.universalPoolLanguage ?? 'en';

  return languages.map((language) => {
    // Native the way the RUNTIME resolves it, which is two mechanisms, not one:
    // a `lang` tag, OR a locale key on a multi-URL feed. `fetchFeed` picks
    // `feed.url[language]` when it exists, so an `ar` reader opening Al Jazeera
    // gets aljazeera.net in Arabic — that is native coverage by any measure a
    // human would use, and getLanguageMatchedSources already counts it for the
    // locale boost. Counting only `lang` tags reported ar as having one native
    // source when the pane actually serves three.
    const servesLanguage = (feed) => feed.lang === language
      || (feed.url && typeof feed.url === 'object' && language in feed.url);
    const clientNative = clientFeeds.filter(servesLanguage);
    // The server catalog cannot express this: ServerFeed.url is a plain string,
    // so a multi-URL client feed has exactly one server twin and it is whatever
    // language that URL happens to be. That asymmetry is the point of
    // validateMultiUrlDigestParity below.
    const serverNative = serverFeeds.filter((feed) => feed.lang === language);
    const clientNames = new Set(clientNative.map((feed) => feed.name));
    const serverNames = new Set(serverNative.map((feed) => feed.name));
    // Hoisted: getLocaleBoostedSources rebuilds its set from the whole catalog
    // on every call, so calling it per feed would rescan for each one.
    //
    // The universal-pool language is skipped because the RUNTIME skips it:
    // getLanguageMatchedSources short-circuits to an empty set for 'en' (English
    // is the baseline, not a boost), so every en-tagged feed would be reported
    // unboosted — a finding about the exemption, not about the catalog. Keyed
    // off the policy field rather than a literal so the floor axis and this one
    // cannot disagree about which language holds the pool.
    const boosted = language === universalPoolLanguage
      ? null
      : inputs.getLocaleBoostedSources(language);

    return {
      language,
      hasLocale: localeFiles.has(language),
      // The untagged pool is written in exactly one language; counting that
      // language's `lang`-tagged feeds would report hundreds of sources as none.
      isUniversalPool: language === universalPoolLanguage,
      // Reachable = what a UI in this language actually attempts to fetch.
      reachableClient: clientFeeds.filter(
        (feed) => !feed.lang || feed.lang === language || Boolean(feed.strategicDefault),
      ).length,
      universalClient,
      universalServer,
      nativeClient: clientNative.map((feed) => feed.name),
      nativeServer: serverNative.map((feed) => feed.name),
      // Native sources sitting in DEFAULT_ENABLED_SOURCES — i.e. never written
      // into the initial disabled set, so they are on without a Settings visit
      // even where the startup locale boost never runs (App.ts gates the whole
      // migration block on the `full` variant).
      //
      // This is NOT cross-locale visibility, and reporting it as such was the
      // reading this audit is supposed to prevent: membership in the
      // default-enabled set only means "not disabled". `fetchCategoryFeeds`
      // still applies isFeedInLanguage (src/services/feed-language.ts) at fetch
      // time, and a `lang`-tagged feed is dropped there for every non-matching
      // locale regardless of being enabled. `strategicDefault` is the ONLY flag
      // that bypasses the filter, so nativeStrategic below is the real
      // cross-locale number.
      nativeDefaultEnabled: clientNative.filter((feed) => defaultEnabled.has(feed.name)).length,
      // Native sources the locale boost would miss (see loadLanguageCoverageInputs).
      nativeUnboosted: boosted
        ? clientNative.filter((feed) => !boosted.has(feed.name)).map((feed) => feed.name)
        : [],
      // Native sources that bypass the language filter for every other locale.
      nativeStrategic: clientNative.filter((feed) => Boolean(feed.strategicDefault)).length,
      clientOnly: [...clientNames].filter((name) => !serverNames.has(name)).sort(),
      serverOnly: [...serverNames].filter((name) => !clientNames.has(name)).sort(),
      floor: policy.floors?.[language] ?? 1,
      zeroAllowlistReason: policy.zeroNativeAllowlist?.[language] ?? null,
      digestAllowlistReason: policy.digestBlindAllowlist?.[language] ?? null,
      status: 'OK',
      digestStatus: 'OK',
    };
  });
}

/**
 * Two-way ratchet, mirroring evaluateGeoCoverage: an undocumented gap fails,
 * and so does an allowlist entry left behind after coverage landed.
 */
export function evaluateLanguageCoverage(rows) {
  const violations = [];
  for (const row of rows) {
    const count = row.nativeClient.length;

    // The universal-pool language is carried by the untagged feeds on BOTH
    // sides, so neither the native floor nor digest parity is measurable from
    // its `lang`-tagged count. Auditing it there reports "no journalism in this
    // language" over a catalog that is mostly journalism in this language.
    if (row.isUniversalPool) {
      row.status = 'UNIVERSAL-POOL';
      row.digestStatus = 'UNIVERSAL-POOL';
      continue;
    }

    // Zero is checked before the floor: with the default floor of 1 every gap
    // would otherwise report as FLOOR-BREACH and the allowlist could never
    // document it, so a language stayed permanently red with no way to record
    // the decision. The allowlist IS the documented exception for zero.
    if (count === 0) {
      if (row.zeroAllowlistReason) {
        row.status = 'ALLOWLISTED';
      } else {
        row.status = 'GAP-UNDOCUMENTED';
        violations.push(
          `${row.language}: zero native sources and no allowlist entry — ` +
          'add native coverage or document the exception in shared/language-coverage-policy.json',
        );
      }
    } else if (row.zeroAllowlistReason) {
      row.status = 'ALLOWLIST-STALE';
      violations.push(
        `${row.language}: now has ${count} native source(s) — ` +
        'remove the stale entry from zeroNativeAllowlist in shared/language-coverage-policy.json',
      );
    } else if (count < row.floor) {
      row.status = 'FLOOR-BREACH';
      violations.push(
        `${row.language}: ${count} native source(s), below floor ${row.floor} — ` +
        'add native coverage or lower the floor in shared/language-coverage-policy.json ' +
        'with a documented reason',
      );
    } else {
      row.status = 'OK';
    }

    // Digest parity is a separate axis: a language can clear its source floor
    // client-side and still contribute nothing to any AI brief.
    const digestBlind = count > 0 && row.nativeServer.length === 0;
    if (digestBlind && !row.digestAllowlistReason) {
      row.digestStatus = 'DIGEST-BLIND';
      violations.push(
        `${row.language}: ${count} native client source(s) but zero in the server digest ` +
        `catalog — no AI brief is ever built from ${row.language} journalism. Mirror them ` +
        `into ${SERVER_FEEDS_PATH} or document the exception in digestBlindAllowlist`,
      );
    } else if (!digestBlind && row.digestAllowlistReason) {
      row.digestStatus = 'ALLOWLIST-STALE';
      violations.push(
        `${row.language}: digest coverage exists now — ` +
        'remove the stale entry from digestBlindAllowlist in shared/language-coverage-policy.json',
      );
    } else if (digestBlind) {
      row.digestStatus = 'ALLOWLISTED';
    }
  }
  return { violations, rows };
}

/** Human-readable report for ops/product reviews. */
export function formatLanguageCoverageHuman({ rows, violations, problems, clientTotal, serverTotal }) {
  const lines = [];
  const universalClient = rows[0]?.universalClient ?? 0;
  const universalServer = rows[0]?.universalServer ?? 0;

  lines.push('Language coverage health — UI languages vs native journalism in the feed catalogs');
  lines.push(
    `Client catalog: ${clientTotal} sources, ${universalClient} untagged (universal/EN)`,
  );
  lines.push(
    `Server digest catalog: ${serverTotal} sources, ${universalServer} untagged (universal/EN)`,
  );
  lines.push('');
  lines.push('  native = feeds tagged with this language. A UI language with zero native');
  lines.push('  sources ships a translated interface over journalism in another language.');
  lines.push('');

  const header = ['lang', 'locale', 'native', 'dflt', 'strat', 'digest', 'reach', 'status'];
  const widths = [5, 7, 7, 6, 6, 7, 6, 18];
  const pad = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('').trimEnd();

  lines.push(pad(header));
  lines.push('-'.repeat(widths.reduce((a, b) => a + b, 0)));

  const sorted = [...rows].sort(
    (a, b) => a.nativeClient.length - b.nativeClient.length || a.language.localeCompare(b.language),
  );
  for (const row of sorted) {
    // An allowlisted gap is still a gap. Suppressing it from the table would
    // turn "documented" into "invisible", which is the opposite of the point —
    // so it stays on its own row, marked with * as policy-acknowledged.
    let status = row.status === 'ALLOWLISTED' ? 'NO-NATIVE*' : row.status;
    if (row.digestStatus === 'DIGEST-BLIND') status = 'DIGEST-BLIND';
    else if (row.digestStatus === 'ALLOWLISTED') status = 'DIGEST-BLIND*';
    lines.push(pad([
      row.language,
      row.hasLocale ? 'yes' : 'MISSING',
      row.nativeClient.length,
      row.nativeDefaultEnabled,
      row.nativeStrategic,
      row.nativeServer.length,
      row.reachableClient,
      status,
    ]));
  }

  lines.push('');
  lines.push('  A user IN this locale already sees ALL of its native sources: the startup');
  lines.push('  locale boost (App.ts) removes them from the disabled set on first run.');
  lines.push('  dflt   = native sources in DEFAULT_ENABLED_SOURCES (never disabled by');
  lines.push('           default). NOT cross-locale visibility: the fetch still applies');
  lines.push('           isFeedInLanguage, which drops a tagged feed for every other locale.');
  lines.push('  strat  = native sources flagged strategicDefault — the ONLY flag that');
  lines.push('           bypasses the language filter, so this is the cross-locale count');
  lines.push('  digest = native sources present in the server digest catalog (AI briefs)');
  lines.push('  reach  = total feeds a UI in this language attempts to fetch');
  lines.push('  *      = known gap, documented in shared/language-coverage-policy.json');
  lines.push('');
  lines.push('  Feed liveness is deliberately NOT probed here — this audit must stay runnable');
  lines.push('  in a bare checkout with no network. Use `npm run test:feeds` for reachability.');

  if (problems.length > 0) {
    lines.push('');
    lines.push(`Config problems (${problems.length}):`);
    for (const problem of problems) lines.push(`  - ${problem}`);
  }

  lines.push('');
  if (violations.length === 0) {
    lines.push('No violations.');
  } else {
    lines.push(`Violations (${violations.length}):`);
    for (const violation of violations) lines.push(`  - ${violation}`);
  }

  return lines.join('\n');
}
