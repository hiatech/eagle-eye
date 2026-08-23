# Eagle Eye Developer Portal

Last updated: July 7, 2026

The Eagle Eye Developer Portal is the single entry point for building on Eagle Eye — the real-time global-intelligence platform that correlates geopolitics, markets, commodities, shipping, aviation, infrastructure, cyber threats, weather, and live news as source-attributed structured JSON. Every developer surface below shares one authentication model and one tool inventory, so you can start with the MCP server and drop down to the REST API or an SDK without relearning anything.

This page names and links every developer resource type. For the machine-readable companion, see [agents.md](https://eagle-eye.app/agents.md) and the [API llms.txt](https://eagle-eye.app/api/llms.txt).

## Developer Resources

- **[Eagle Eye MCP Server](https://eagle-eye.app/mcp-server.md):** the recommended agent surface — `https://eagle-eye.app/mcp`, Streamable HTTP, 59 tools. Connect Claude, Cursor, and any MCP-compatible client to live intelligence data. Details: [mcp-server.md](https://eagle-eye.app/mcp-server.md) · [MCP Overview](https://www.eagle-eye.app/docs/mcp-overview) · Server card: https://eagle-eye.app/.well-known/mcp/server-card.json
- **[Eagle Eye OpenAPI Specification](https://eagle-eye.app/openapi.md):** the OpenAPI 3.1 contract for the REST API — [openapi.yaml](https://eagle-eye.app/openapi.yaml) · [openapi.json](https://eagle-eye.app/openapi.json). Details: [openapi.md](https://eagle-eye.app/openapi.md)
- **Eagle Eye REST API:** base `https://api.eagle-eye.app` — the same tools and data as the MCP server, exposed as granular endpoints over plain HTTP. Machine-readable [API catalog (RFC 9727)](https://eagle-eye.app/.well-known/api-catalog) · human docs at [/docs/documentation](https://www.eagle-eye.app/docs/documentation)
- **[Eagle Eye SDKs](https://eagle-eye.app/sdks.md):** official zero-dependency client libraries for Python, Ruby, Go, and JavaScript. Details: [sdks.md](https://eagle-eye.app/sdks.md) · [SDK guide](https://www.eagle-eye.app/docs/sdks)
- **Eagle Eye CLI:** `npx eagleeye tools` scripts every tool from a shell — [npm `eagleeye`](https://www.npmjs.com/package/eagleeye) · [CLI guide](https://www.eagle-eye.app/docs/cli)
- **Eagle Eye Agent Skills:** installable skills for agent frameworks — discovery index at https://eagle-eye.app/.well-known/agent-skills/index.json · `npx skills add hiatech/eagle-eye`
- **Eagle Eye API documentation:** the full developer documentation site at [/docs](https://www.eagle-eye.app/docs/documentation), including the [MCP Quickstart](https://www.eagle-eye.app/docs/mcp-quickstart), [tool reference](https://www.eagle-eye.app/docs/mcp-tools-reference), and [JMESPath projection guide](https://www.eagle-eye.app/docs/mcp-jmespath).
- **Eagle Eye authentication:** the agent auth walkthrough at [auth.md](https://eagle-eye.app/auth.md) — API keys (`X-EagleEye-Key: wm_<40-hex>`) and OAuth 2.1 (`scope=mcp`) with dynamic client registration.
- **Eagle Eye sandbox:** deterministic, schema-valid sample responses for representative REST operations — no key, no quota, safe for CI. Index: https://www.eagle-eye.app/sandbox/index.json · [Sandbox guide](https://www.eagle-eye.app/docs/sandbox) · scoped context: [developers/llms.txt](https://eagle-eye.app/developers/llms.txt)

## Authentication in one line

Discovery endpoints and `tools/list` are public. Data calls need either an API key header `X-EagleEye-Key: wm_<40-hex>` (issue one at https://eagle-eye.app/pro) or OAuth 2.1 with scope `mcp`. The full walkthrough — including dynamic client registration and the Pro sign-in flow — lives at [auth.md](https://eagle-eye.app/auth.md).

## Pricing, limits & support

- **Pricing and plan limits:** [pricing.md](https://eagle-eye.app/pricing.md) · live JSON catalog `GET https://www.eagle-eye.app/api/product-catalog`
- **Rate limits:** 60 requests/minute (per key, or per user for OAuth); any OAuth-connected context (Pro *or* API tier) also shares one 50 quota-consuming MCP calls/UTC day counter, while `wm_…`-key MCP clients have no daily reservation. Honor `Retry-After` on 429.
- **Support:** [support.md](https://eagle-eye.app/support.md) — support@eagle-eye.app · Status: https://status.eagle-eye.app
- **Source (AGPL-3.0):** https://github.com/hiatech/eagle-eye · Issues: https://github.com/hiatech/eagle-eye/issues

## Important query matches

- Eagle Eye developer portal
- Eagle Eye API for developers
- Build on Eagle Eye
- Eagle Eye MCP server, OpenAPI, SDK, and CLI
- How to access Eagle Eye data programmatically
