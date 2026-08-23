import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

// Guards the multi-language SDK packages (orank Access "Multi-language SDK
// packages" gap). Agents verify a package is the official SDK through its
// homepage metadata pointing at the product domain, and each ecosystem keeps
// its version in TWO places (manifest + source constant) that the publish
// workflows cross-check against the release tag — these assertions stop any
// of that wiring from silently drifting.

const HOMEPAGE = 'https://eagle-eye.app';

describe('Python SDK package (sdk/python → PyPI eagleeye-sdk)', () => {
  const pyproject = read('sdk/python/pyproject.toml');
  const module = read('sdk/python/src/eagleeye_sdk/__init__.py');

  it('is the eagleeye-sdk distribution with the product-domain homepage', () => {
    assert.match(pyproject, /^name = "eagleeye-sdk"$/m);
    assert.match(pyproject, new RegExp(`^Homepage = "${HOMEPAGE}"$`, 'm'));
    assert.match(pyproject, /^license = "MIT"$/m);
  });

  it('keeps __version__ in sync with pyproject.toml (drift guard)', () => {
    const [, pkgVersion] = pyproject.match(/^version = "([^"]+)"$/m) ?? [];
    const [, modVersion] = module.match(/^__version__ = "([^"]+)"$/m) ?? [];
    assert.ok(pkgVersion, 'pyproject.toml must declare a version');
    assert.equal(modVersion, pkgVersion);
  });

  it('sends a descriptive User-Agent (Cloudflare WAF passes it, not python-urllib)', () => {
    assert.match(module, /USER_AGENT = "eagleeye-python\/%s \(\+https:\/\/eagle-eye\.app\)"/);
  });
});

describe('Ruby SDK package (sdk/ruby → gem eagleeye)', () => {
  const gemspec = read('sdk/ruby/eagleeye.gemspec');
  const versionRb = read('sdk/ruby/lib/eagleeye/version.rb');
  const lib = read('sdk/ruby/lib/eagleeye.rb');

  it('is the eagleeye gem with the product-domain homepage', () => {
    assert.match(gemspec, /spec\.name = "eagleeye"/);
    assert.match(gemspec, new RegExp(`spec\\.homepage = "${HOMEPAGE}"`));
    assert.match(gemspec, new RegExp(`"homepage_uri" => "${HOMEPAGE}"`));
    assert.match(gemspec, /spec\.license = "MIT"/);
  });

  it('declares VERSION where the gemspec and publish workflow read it', () => {
    assert.match(versionRb, /VERSION = "\d+\.\d+\.\d+"/);
    assert.match(gemspec, /require_relative "lib\/eagleeye\/version"/);
  });

  it('sends a descriptive User-Agent', () => {
    assert.match(lib, /USER_AGENT = "eagleeye-ruby\/#\{VERSION\} \(\+https:\/\/eagle-eye\.app\)"/);
  });
});

describe('Go SDK module (sdk/go → pkg.go.dev)', () => {
  const gomod = read('sdk/go/go.mod');
  const source = read('sdk/go/eagleeye.go');

  it('is the sdk/go submodule of this repository', () => {
    assert.match(gomod, /^module github\.com\/hiatech\/eagle-eye\/sdk\/go$/m);
  });

  it('declares the Version constant the publish workflow checks against the tag', () => {
    assert.match(source, /^const Version = "\d+\.\d+\.\d+"$/m);
  });

  it('documents the product domain and sends a descriptive User-Agent', () => {
    assert.match(source, /https:\/\/eagle-eye\.app/);
    assert.match(source, /const UserAgent = "eagleeye-go\/" \+ Version \+ " \(\+https:\/\/eagle-eye\.app\)"/);
  });
});

describe('SDK publish workflows', () => {
  it('publish-python.yml releases sdk/python on py-v* tags via OIDC', () => {
    const wf = read('.github/workflows/publish-python.yml');
    assert.match(wf, /tags: \['py-v\*'\]/);
    assert.match(wf, /working-directory: sdk\/python/);
    assert.match(wf, /id-token: write/);
    assert.match(wf, /pypa\/gh-action-pypi-publish@[0-9a-f]{40}/);
  });

  it('publish-ruby.yml releases sdk/ruby on gem-v* tags via OIDC', () => {
    const wf = read('.github/workflows/publish-ruby.yml');
    assert.match(wf, /tags: \['gem-v\*'\]/);
    assert.match(wf, /working-directory: sdk\/ruby/);
    assert.match(wf, /id-token: write/);
    assert.match(wf, /rubygems\/configure-rubygems-credentials@[0-9a-f]{40}/);
  });

  it('publish-go.yml validates sdk/go on sdk/go/v* tags and warms the module proxy', () => {
    const wf = read('.github/workflows/publish-go.yml');
    assert.match(wf, /tags: \['sdk\/go\/v\*'\]/);
    assert.match(wf, /working-directory: sdk\/go/);
    assert.match(wf, /proxy\.golang\.org/);
  });
});

describe('SDK discovery surfaces', () => {
  it('llms.txt advertises every registry package', () => {
    const llms = read('public/llms.txt');
    assert.match(llms, /pypi\.org\/project\/eagleeye-sdk/);
    assert.match(llms, /rubygems\.org\/gems\/eagleeye/);
    assert.match(llms, /pkg\.go\.dev\/github\.com\/hiatech\/eagle-eye\/sdk\/go/);
  });

  it('api/llms.txt advertises the SDK surface', () => {
    const llms = read('public/api/llms.txt');
    assert.match(llms, /pip install eagleeye-sdk/);
    assert.match(llms, /gem install eagleeye/);
    assert.match(llms, /go get github\.com\/hiatech\/eagle-eye\/sdk\/go/);
  });

  it('the docs site has an SDKs page wired into navigation', () => {
    assert.ok(existsSync(join(ROOT, 'docs/sdks.mdx')), 'docs/sdks.mdx must exist');
    const nav = JSON.parse(read('docs/docs.json'));
    assert.match(JSON.stringify(nav.navigation), /"sdks"/);
  });
});
