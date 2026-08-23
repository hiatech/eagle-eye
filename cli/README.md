# eagleeye

[![npm version](https://img.shields.io/npm/v/eagleeye?logo=npm)](https://www.npmjs.com/package/eagleeye)
[![npm downloads](https://img.shields.io/npm/dm/eagleeye)](https://www.npmjs.com/package/eagleeye)
[![license](https://img.shields.io/npm/l/eagleeye)](https://github.com/hiatech/eagle-eye/blob/main/cli/LICENSE)

Official command-line client for the [Eagle Eye](https://eagle-eye.app)
global-intelligence API. Script country briefs, risk scores, and
conflict / cyber / market / news feeds — plus any of the 59 MCP tools — from
your shell or an agent, without writing an API integration.

The CLI is a thin, dependency-free wrapper over the
[MCP server](https://eagle-eye.app/mcp) (the recommended agent surface) with
a REST escape hatch. It ships as ESM and runs on Node 18+.

📖 **Full documentation:** [eagle-eye.app/docs/cli](https://eagle-eye.app/docs/cli)

## Install

```sh
npm install -g eagleeye   # installs the `eagleeye` command (alias: `wm`)
# or run without installing:
npx eagleeye tools
```

## Quick start

```sh
# Discover every tool — public, no key needed
eagleeye tools

# Data commands need a user API key (get one at https://eagle-eye.app/pro)
export EAGLEEYE_API_KEY=wm_xxxxxxxx

eagleeye world                       # live global situation brief
eagleeye country IR                  # AI strategic brief for a country
eagleeye risk DE                      # country risk / resilience scores
eagleeye conflicts --country IR --limit 5
eagleeye markets --asset_class crypto
eagleeye call get_cyber_threats --min_severity 7
```

## Commands

Data commands map to MCP `tools/call` and require `--api-key`:

- `world` — live global situation brief
- `country <ISO>` — AI strategic brief for a country (ISO 3166-1 alpha-2)
- `risk <ISO>` — country risk / resilience scores
- `markets` — equities, commodities, crypto, FX quotes
- `conflicts` — recent conflict events (`--country`, `--min_fatalities`, `--limit`)
- `cyber` — cyber-threat indicators (`--min_severity`, `--threat_type`, `--country`)
- `news` — classified news intelligence (`--topic`, `--country`, `--alerts_only`)
- `disasters` — earthquakes, fires, storms (`--dataset`, `--active_only`)
- `sanctions` — sanctions designations (`--country`, `--query`)
- `forecasts` — scenario forecasts (`--domain`, `--region`)
- `maritime <ISO>` — maritime / port activity for a country

MCP and REST:

- `tools` — list every MCP tool (public — no key needed)
- `call <tool> [--arg val]` — call any MCP tool (`--args '<json>'` for typed args)
- `prompts` / `resources` — list MCP prompt / resource templates
- `health` — API status / health check (requires `--api-key`)
- `get <path> [--param val]` — call a raw REST path (host-relative `/api/…`)
- `list [service]` — list documented REST operations from the live OpenAPI spec

Any `--key value` pair you pass that is not a recognised flag becomes a tool or
request parameter, so every tool argument is reachable without special wiring.

Every tool also accepts a `jmespath` argument that projects the response
server-side before it crosses the wire — typically 80–95% smaller:

```sh
eagleeye markets --jmespath 'data."stocks-bootstrap".quotes[?symbol==`AAPL`].{s:symbol,p:price}'
```

See the [JMESPath guide](https://eagle-eye.app/docs/mcp-jmespath) for worked examples.

## Flags

- `--api-key <key>` — user API key (or env `EAGLEEYE_API_KEY`)
- `--mcp-url <url>` — MCP endpoint (default `https://eagle-eye.app/mcp`)
- `--base-url <url>` — REST base (default `https://api.eagle-eye.app`)
- `--args <json>` — typed arguments object for a tool call
- `--timeout <ms>` — request timeout (default 30000)
- `--raw` — print the response body verbatim
- `--compact` — print single-line JSON
- `-h, --help` / `-v, --version`

## Exit codes

- `0` — success
- `1` — request or transport error (the response body is written to stderr)
- `2` — usage error

## Programmatic use

```js
import { run } from 'eagleeye/run';

const code = await run(['risk', 'IR'], { env: process.env });
```

## License

MIT-licensed thin client (the Eagle Eye platform itself remains AGPL-3.0). Part of the
[Eagle Eye](https://github.com/hiatech/eagle-eye) project.
