# Eagle Eye MCP Server

Last updated: July 7, 2026

The Eagle Eye MCP Server exposes Eagle Eye's real-time global-intelligence stack over the [Model Context Protocol](https://modelcontextprotocol.io), so any MCP-compatible client — Claude Desktop, Claude web, Cursor, MCP Inspector, or a custom agent — can pull live conflict, market, aviation, maritime, economic, cyber, and forecasting data directly into a model's context. It is the recommended way for AI agents to consume Eagle Eye data.

## Endpoint

- **Server URL:** `https://eagle-eye.app/mcp` — Streamable HTTP transport, JSON-RPC 2.0 (JSON responses by default, SSE when the client advertises `text/event-stream`; `initialize` defaults to protocol `2025-03-26`).
- **Server card:** https://eagle-eye.app/.well-known/mcp/server-card.json
- **Docs MCP server:** `https://www.eagle-eye.app/docs/mcp` — a second, public (no-auth) MCP server with search-and-retrieval tools over the documentation. Route "how do I…" questions there; route live-data calls to the product server above.

## Tools

The server ships **59 tools** covering world and country briefs, country risk and resilience, China decision signals, conflict events, markets, commodities, global procurement opportunities, energy, maritime and aviation activity, cyber threats, sanctions, natural disasters, health signals, prediction markets, and AI forecasts. Issue `tools/list` for the live inventory, `prompts/list` for pre-built workflow templates, and `resources/list` for read-only resources. `tools/list`, `prompts/list`, and `resources/list` are **public** — no key required. Every tool accepts an optional `jmespath` argument for [server-side projection](https://www.eagle-eye.app/docs/mcp-jmespath), typically an 80–95% response-size cut.

## MCP Apps

Eagle Eye supports MCP Apps (`io.modelcontextprotocol/ui`) with ten interactive `ui://` app shells. The linked tools are `get_country_risk`, `get_world_brief`, `get_country_brief`, `get_market_data`, `get_chokepoint_status`, `get_news_intelligence`, `get_conflict_events`, `get_natural_disasters`, `get_prediction_markets`, and `get_forecast_predictions`; their UI resources are:

- `ui://eagleeye/country-risk.html`
- `ui://eagleeye/world-brief.html`
- `ui://eagleeye/country-brief.html`
- `ui://eagleeye/market-radar.html`
- `ui://eagleeye/chokepoint-monitor.html`
- `ui://eagleeye/news-intelligence.html`
- `ui://eagleeye/conflict-events.html`
- `ui://eagleeye/natural-disasters.html`
- `ui://eagleeye/prediction-markets.html`
- `ui://eagleeye/forecasts.html`

Hosts discover the links through `_meta.ui.resourceUri` in `tools/list`, enumerate the shells through `resources/list`, and fetch each template with `resources/read`. `ui://` reads are public and quota-exempt because they return static, data-free HTML; live data still arrives through a normal authenticated `tools/call`. Full contract: [MCP Apps](https://www.eagle-eye.app/docs/mcp-apps).

## Authentication

- **`tools/list` and other discovery calls:** anonymous, no key.
- **`tools/call` and `resources/read` (data):** need either an API key or OAuth.
  - **API key:** header `X-EagleEye-Key: wm_<40-hex>` — issue one at https://eagle-eye.app/pro. Rate limit: 60 requests/minute/key.
  - **OAuth 2.1 (`scope=mcp`):** Pro and API tiers can both connect via OAuth with no API key. Dynamic Client Registration (RFC 7591) at `https://eagle-eye.app/oauth/register`; authorization and token endpoints follow OAuth 2.1 with PKCE. Any OAuth-connected context — Pro *or* API tier — shares one 50 quota-consuming `tools/call` / `resources/read` counter per UTC day; API-tier clients that authenticate with a `wm_…` key instead have no daily reservation (only the 60 requests/minute limiter).

Full agent walkthrough: [auth.md](https://eagle-eye.app/auth.md). Authorization-server metadata: https://eagle-eye.app/.well-known/oauth-authorization-server · protected-resource metadata: https://eagle-eye.app/.well-known/oauth-protected-resource

## Connect in one step

```sh
# Confirm reachability with the public CLI (no key):
npx eagleeye tools
```

Add the server to Claude Desktop / Cursor via their MCP settings using the URL `https://eagle-eye.app/mcp`, or follow the [MCP Quickstart](https://www.eagle-eye.app/docs/mcp-quickstart) for a five-minute path to a real tool call.

## Learn more

- [MCP Overview](https://www.eagle-eye.app/docs/mcp-overview) — auth modes, plans, OAuth setup, full tool catalog
- [MCP Apps](https://www.eagle-eye.app/docs/mcp-apps) — interactive `ui://` resources, host flow, view security, and drift checks
- [MCP Quickstart](https://www.eagle-eye.app/docs/mcp-quickstart) · [Tool reference](https://www.eagle-eye.app/docs/mcp-tools-reference) · [JMESPath projection](https://www.eagle-eye.app/docs/mcp-jmespath) · [Error catalog](https://www.eagle-eye.app/docs/mcp-error-catalog)
- [Developer Portal](https://eagle-eye.app/developers.md) · [REST API OpenAPI spec](https://eagle-eye.app/openapi.md) · [SDKs](https://eagle-eye.app/sdks.md) · [agents.md](https://eagle-eye.app/agents.md)

## Important query matches

- Eagle Eye MCP server
- Eagle Eye Model Context Protocol server
- Connect Claude to Eagle Eye
- Real-time geopolitical intelligence MCP server
- MCP server for markets, conflicts, and global risk data
