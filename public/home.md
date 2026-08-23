# Eagle Eye — By the time it's news, you already knew.

Free real-time global intelligence dashboard. Eagle Eye streams the world's raw signals — ships, jets, sirens, cables, markets — onto one live map, with AI that flags when they converge into something that matters.

Open-source (AGPL-3.0), used by 2M+ people across 190+ countries, as featured in WIRED. Runs as a web app, installable PWA, and native desktop app for macOS, Windows, and Linux. No signup required.

## What you get

- Real-time global map with 56 data layers, 588+ observed upstream hosts, and 500+ curated news feeds
- CII v8 for 31 Tier-1 countries, 196-country resilience scores, and global live conflict tracking
- Market quotes, sector heatmaps, and macro indicators
- 13 shipping chokepoints with live AIS vessel-transit intelligence
- Satellite tracking, GPS jamming zones, submarine cables, AI datacenters
- Daily AI brief, Scenario Engine, custom monitors and breaking alerts
- 59-tool MCP server so AI agents can query everything above

## Live instances

- [Eagle Eye](https://www.eagle-eye.app/dashboard) — geopolitics, military, conflicts, infrastructure
- [Tech Monitor](https://tech.eagle-eye.app/dashboard) — startups, AI/ML, cloud, cybersecurity
- [Finance Monitor](https://finance.eagle-eye.app/dashboard) — global markets, trading, central banks
- [Commodity Monitor](https://commodity.eagle-eye.app/dashboard) — mining, metals, energy, supply chains
- [Happy Monitor](https://happy.eagle-eye.app/dashboard) — positive news, breakthroughs, conservation
- [Energy Monitor](https://energy.eagle-eye.app/dashboard) — power grids, LNG, renewables

## For AI agents

- **MCP server:** `https://eagle-eye.app/mcp` (Streamable HTTP) — server card at [/.well-known/mcp/server-card.json](https://eagle-eye.app/.well-known/mcp/server-card.json)
- **A2A:** agent card at [/.well-known/agent-card.json](https://eagle-eye.app/.well-known/agent-card.json) — JSON-RPC endpoint at `https://www.eagle-eye.app/a2a`
- **REST API:** base `https://api.eagle-eye.app` — OpenAPI spec at [/openapi.json](https://eagle-eye.app/openapi.json)
- **Agent guidance:** [/llms.txt](https://eagle-eye.app/llms.txt) · skills at [/.well-known/agent-skills/index.json](https://eagle-eye.app/.well-known/agent-skills/index.json)
- **CLI:** `npx eagleeye tools` — [npm package](https://www.npmjs.com/package/eagleeye)
- **Auth:** [/auth.md](https://eagle-eye.app/auth.md) · plans and limits at [/pricing.md](https://eagle-eye.app/pricing.md)

## Documentation

- [Product & API docs](https://www.eagle-eye.app/docs/documentation)
- [Pricing](https://www.eagle-eye.app/pro) · [GitHub](https://github.com/hiatech/eagle-eye)
