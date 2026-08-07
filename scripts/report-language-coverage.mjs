#!/usr/bin/env node
/**
 * Human-readable UI-language / native-source coverage report.
 *
 *   node scripts/report-language-coverage.mjs          # table, exit 1 on violations
 *   node scripts/report-language-coverage.mjs --json   # machine-readable rows
 *
 * Audits SUPPORTED_LANGUAGES (src/services/i18n.ts) against both feed catalogs
 * — src/config/feeds.ts and server/worldmonitor/news/v1/_feeds.ts — using the
 * policy in shared/language-coverage-policy.json.
 * CI gate: tests/language-coverage-health.test.mts.
 */
import {
  computeLanguageCoverage,
  evaluateLanguageCoverage,
  formatLanguageCoverageHuman,
  loadLanguageCoverageInputs,
  validateLanguageTags,
  validateTagParity,
  validateVariantTagConsistency,
} from './language-coverage-health.mjs';

const asJson = process.argv.includes('--json');

const inputs = await loadLanguageCoverageInputs();
try {
  const problems = [
    ...validateLanguageTags(inputs),
    ...validateTagParity(inputs),
    ...validateVariantTagConsistency(inputs),
  ];
  const rows = computeLanguageCoverage(inputs);
  const { violations } = evaluateLanguageCoverage(rows);
  const allViolations = [...problems, ...violations];

  if (asJson) {
    process.stdout.write(`${JSON.stringify({
      clientTotal: inputs.clientFeeds.length,
      serverTotal: inputs.serverFeeds.length,
      violations: allViolations,
      rows,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatLanguageCoverageHuman({
      rows,
      violations,
      problems,
      clientTotal: inputs.clientFeeds.length,
      serverTotal: inputs.serverFeeds.length,
    })}\n`);
  }
  process.exitCode = allViolations.length > 0 ? 1 : 0;
} finally {
  inputs.cleanup();
}
