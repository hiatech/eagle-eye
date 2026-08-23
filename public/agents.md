# Eagle Eye — Agent Guide

> How AI agents should work with eagle-eye.app: machine surfaces, authentication, crawl policy, rate limits, and discovery endpoints. Prefer the structured surfaces below over scraping the HTML dashboard — the dashboard is a WebGL SPA and yields nothing useful to a text parser.

Eagle Eye is a real-time global intelligence dashboard: 500+ news feeds, 56 map layer types, country risk/resilience scores, AI briefs, forecasts, and market/supply-chain correlation, served as machine-readable JSON with documented methodology and provenance.

## Machine surfaces (use these)

- **MCP server (recommended):** `https://eagle-eye.app/mcp` — Streamable HTTP, 59 tools; issue `tools/list` for the live inventory. Server card: https://eagle-eye.app/.well-known/mcp/server-card.json
- **Docs MCP server:** `https://www.eagle-eye.app/docs/mcp` — Streamable HTTP, public (no auth); search-and-retrieval tools over the documentation. Use it for "how do I…" questions; use the product MCP above for live data.
- **REST API:** base `https://api.eagle-eye.app` — OpenAPI spec: https://eagle-eye.app/openapi.yaml (JSON: /openapi.json) · API catalog: https://eagle-eye.app/.well-known/api-catalog
- **NLWeb:** `POST https://www.eagle-eye.app/ask` (supports SSE) for natural-language questions; machine-readable dashboard view at `https://www.eagle-eye.app/?mode=agent`
- **Agent Skills:** discovery index at https://eagle-eye.app/.well-known/agent-skills/index.json · install via `npx skills add hiatech/eagle-eye` (https://skills.sh/hiatech/eagle-eye)
- **CLI:** `npx eagleeye tools` lists every tool (public, no key) — https://www.npmjs.com/package/eagleeye
- **SDKs:** Python `pip install eagleeye-sdk` · Ruby `gem install eagleeye` · Go `go get github.com/hiatech/eagle-eye/sdk/go` · JavaScript npm `eagleeye` — guide: https://www.eagle-eye.app/docs/sdks
- **Sandbox / test environment:** https://www.eagle-eye.app/sandbox/index.json — deterministic, schema-valid sample responses for representative REST operations; no auth, no quota, safe for CI. Guide: https://www.eagle-eye.app/docs/sandbox
- **LLM briefings:** https://eagle-eye.app/llms.txt (overview) · https://eagle-eye.app/llms-full.txt (full reference) · section files: https://eagle-eye.app/api/llms.txt (API) · https://www.eagle-eye.app/docs/llms.txt (docs) · https://eagle-eye.app/developers/llms.txt (developer portal) · https://www.eagle-eye.app/blog/llms.txt (blog)
- **Schema map:** https://www.eagle-eye.app/schemamap.xml — NLWeb schemamap indexing the structured-data surfaces
- **Research reports:** https://www.eagle-eye.app/research/ — original source-backed research with downloadable CSV/JSON data, per-figure provenance, and stable citation URLs (no auth, no JavaScript required)
- **Developer portal:** https://eagle-eye.app/developers.md — links every developer resource by name. Named resource pages: [MCP Server](https://eagle-eye.app/mcp-server.md) · [OpenAPI Specification](https://eagle-eye.app/openapi.md) · [SDKs](https://eagle-eye.app/sdks.md)

## Authentication

- **Anonymous** works for discovery endpoints, `tools/list`, and public data (world brief, product catalog, story pages).
- **API key:** header `X-EagleEye-Key: wm_<40-hex>` for REST and MCP data calls — issue one at https://eagle-eye.app/pro. Full agent walkthrough: https://eagle-eye.app/auth.md
- **OAuth2** for MCP (`scope=mcp`), with dynamic client registration at `/oauth/register`. Details in auth.md.

## Crawl & content-usage policy

- **robots.txt** (https://www.eagle-eye.app/robots.txt): AI search/assistant agents (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, DuckAssistBot, MistralAI-User) are explicitly allowed; bulk training-only scrapers (CCBot, Bytespider, anthropic-ai) are disallowed. `/api/` is off-limits to crawlers except the allowlisted story/OG/llms.txt/product-catalog routes.
- **Content-Signal:** `ai-train=no, search=yes, ai-input=yes` — declared as a robots.txt group directive and as an origin-wide HTTP response header. Search indexing and assistant grounding/citation are welcome; bulk model training is opted out.
- **User-Agent:** always send a descriptive `User-Agent` (e.g. `mytool/1.0 (+https://yoursite.example)`). Default HTTP-library UAs (`curl/*`, `python-requests/*`, empty strings) may get a 403 from the edge firewall — a 403 does NOT mean the endpoint is missing; retry with a real UA.

## Rate limits & plans

- Machine-readable pricing and plan limits: https://eagle-eye.app/pricing.md · live JSON catalog: `GET https://www.eagle-eye.app/api/product-catalog` (public, no key)
- Rate-limit documentation: https://www.eagle-eye.app/docs/usage-rate-limits.md · auth matrix: https://www.eagle-eye.app/docs/usage-auth
- Plan-limit responses include upgrade guidance; back off on 429 and honor `Retry-After`.

## Support & escalation

- https://eagle-eye.app/support.md — support@eagle-eye.app (general) · enterprise@eagle-eye.app (sales)
- Status: https://status.eagle-eye.app · Issues: https://github.com/hiatech/eagle-eye/issues
- Source (AGPL-3.0): https://github.com/hiatech/eagle-eye
