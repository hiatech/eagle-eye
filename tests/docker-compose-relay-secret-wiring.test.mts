/**
 * The relay's shared secret must actually reach the containers that need it.
 *
 * SELF_HOSTING.md lists RELAY_SHARED_SECRET in its "Required Environment
 * Variables" table and its Quick Start writes it into `.env` — but
 * docker-compose.yml never passed it to any service. Following that document
 * exactly produced an ais-relay stuck in a FATAL restart loop, and the failure
 * was silent from the outside: the app declares `depends_on: ais-relay:
 * condition: service_started`, which is satisfied while a container is
 * restarting, so the dashboard came up healthy on :3000 and only `docker
 * compose logs ais-relay` showed anything wrong.
 *
 * Both sides need it, for different reasons:
 *   - ais-relay  reads it to authenticate inbound requests (scripts/ais-relay.cjs)
 *   - eagleeye reads it to sign outbound ones (server/_shared/relay.ts)
 *
 * A grep-level test rather than a container harness: the failure mode is a
 * missing line in YAML, which absence-of-key catches deterministically.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const REPO_ROOT = new URL('..', import.meta.url);

async function read(rel: string): Promise<string> {
  return readFile(new URL(rel, REPO_ROOT), 'utf8');
}

function serviceBlock(compose: string, serviceName: string): string {
  const normalized = compose.replaceAll('\r\n', '\n');
  const match = normalized.match(
    new RegExp(`^  ${serviceName}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|^volumes:)`, 'm'),
  );
  assert.ok(match, `docker-compose.yml must define ${serviceName} service`);
  return match[1];
}

describe('docker self-hosting — relay secret reaches both sides', () => {
  it('passes RELAY_SHARED_SECRET to the relay and to its caller', async () => {
    const compose = await read('docker-compose.yml');
    for (const service of ['ais-relay', 'eagleeye']) {
      assert.match(
        serviceBlock(compose, service),
        /^\s+RELAY_SHARED_SECRET:\s*"\$\{RELAY_SHARED_SECRET[:-]/m,
        `${service} must receive RELAY_SHARED_SECRET — SELF_HOSTING.md documents it as required`,
      );
    }
  });

  it('keeps the documented dev-only auth opt-out reachable', async () => {
    // The relay's own startup check is the gate, so the variable is passed
    // through rather than `:?`-required. That only works if the opt-out flag
    // reaches the container too — otherwise the escape hatch SELF_HOSTING.md
    // documents cannot be exercised at all.
    assert.match(
      serviceBlock(await read('docker-compose.yml'), 'ais-relay'),
      /^\s+I_UNDERSTAND_THIS_DISABLES_AUTH:\s*"\$\{I_UNDERSTAND_THIS_DISABLES_AUTH[:-]/m,
      'ais-relay must receive I_UNDERSTAND_THIS_DISABLES_AUTH',
    );
  });

  it('does not ship a default value for the relay secret', async () => {
    // Same class as #3804: a documented literal default is an authenticated
    // interface with a known credential the moment a port binding changes.
    const compose = await read('docker-compose.yml');
    const defaulted = compose.match(/RELAY_SHARED_SECRET:\s*"\$\{RELAY_SHARED_SECRET:-(.+?)\}"/);
    assert.equal(
      defaulted?.[1] ?? '',
      '',
      'RELAY_SHARED_SECRET must default to empty so the relay fails loud, never to a literal',
    );
  });

  it('still documents the variable it now wires', async () => {
    const selfHosting = await read('SELF_HOSTING.md');
    assert.match(selfHosting, /RELAY_SHARED_SECRET/);
  });
});

describe('docker self-hosting — browser session auth is configurable', () => {
  it('requires WM_SESSION_SECRET on the app container', async () => {
    // Without it POST /api/wm-session fails closed with 503, so no browser can
    // mint a session token and every session-gated route 401s — the news digest
    // included, which is most of the dashboard. `:?`-required rather than
    // passed through because the alternative is a stack that reports healthy,
    // serves 200 on the shell, and is unusable in a browser: the 503 shows up
    // only in the network tab.
    assert.match(
      serviceBlock(await read('docker-compose.yml'), 'eagleeye'),
      /^\s+WM_SESSION_SECRET:\s*"\$\{WM_SESSION_SECRET:\?/m,
      'eagleeye must require WM_SESSION_SECRET',
    );
  });

  it('documents it in the required-variables table', async () => {
    // It was already in .env.example but in neither the compose file nor this
    // table, so following the Quick Start produced a broken dashboard.
    const selfHosting = await read('SELF_HOSTING.md');
    assert.match(
      selfHosting,
      /^\|\s*`WM_SESSION_SECRET`\s*\|/m,
      'WM_SESSION_SECRET must appear in the Required Environment Variables table',
    );
    assert.match(
      selfHosting,
      /echo "WM_SESSION_SECRET=\$\(openssl rand -hex 32\)"/,
      'the Quick Start must generate it alongside the other required secrets',
    );
  });

  it('ships no default value for it', async () => {
    const compose = await read('docker-compose.yml');
    assert.doesNotMatch(
      compose,
      /WM_SESSION_SECRET:\s*"\$\{WM_SESSION_SECRET:-.+\}"/,
      'a default HMAC key would make every session token forgeable',
    );
  });
});
