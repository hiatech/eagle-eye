import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const panelLayout = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');

describe('variant switcher navigation', () => {
  it('keeps every production variant link on the dashboard route', () => {
    const dashboardUrls = {
      full: 'https://eagle-eye.app/dashboard',
      tech: 'https://tech.eagle-eye.app/dashboard',
      finance: 'https://finance.eagle-eye.app/dashboard',
      commodity: 'https://commodity.eagle-eye.app/dashboard',
      energy: 'https://energy.eagle-eye.app/dashboard',
      happy: 'https://happy.eagle-eye.app/dashboard',
    } as const;

    for (const [variant, url] of Object.entries(dashboardUrls)) {
      assert.match(
        panelLayout,
        new RegExp(`vHref\\('${variant}', '${url.replaceAll('.', '\\.')}'\\)`),
        `${variant} switcher link must target ${url}`,
      );
    }
  });
});
