# Eagle Eye SDKs

Last updated: July 7, 2026

Eagle Eye ships official client libraries in four language ecosystems so you can script country briefs, risk scores, market data, and every one of the 59 [MCP tools](https://eagle-eye.app/mcp-server.md) without writing an HTTP integration. All of them are **zero-dependency**, MCP-first mirrors of the [`eagleeye` npm CLI](https://www.eagle-eye.app/docs/cli), with a small REST escape hatch for host-relative and self-hosted use.

## Official SDKs

| Language | Package | Install | Source |
| --- | --- | --- | --- |
| Python | [`eagleeye-sdk` on PyPI](https://pypi.org/project/eagleeye-sdk/) | `pip install eagleeye-sdk` | [`sdk/python/`](https://github.com/hiatech/eagle-eye/tree/main/sdk/python) |
| Ruby | [`eagleeye` on RubyGems](https://rubygems.org/gems/eagleeye) | `gem install eagleeye` | [`sdk/ruby/`](https://github.com/hiatech/eagle-eye/tree/main/sdk/ruby) |
| Go | [`github.com/hiatech/eagle-eye/sdk/go` on pkg.go.dev](https://pkg.go.dev/github.com/hiatech/eagle-eye/sdk/go) | `go get github.com/hiatech/eagle-eye/sdk/go` | [`sdk/go/`](https://github.com/hiatech/eagle-eye/tree/main/sdk/go) |
| JavaScript / CLI | [`eagleeye` on npm](https://www.npmjs.com/package/eagleeye) | `npm install eagleeye` | [`cli/`](https://github.com/hiatech/eagle-eye/tree/main/cli) |

Every package sets its homepage to `eagle-eye.app` — that is how you (or your agent) verify it is the official SDK and not a look-alike.

## Shared design

All four clients expose the same surface with language-native naming:

- **Any MCP tool** via `call_tool` / `CallTool` with named arguments; the result is the unwrapped JSON-RPC `result`.
- **Curated helpers** for the highest-traffic tools: world brief, country brief/risk, markets, conflicts, cyber, news, disasters, sanctions, forecasts, maritime.
- **Public listings** — `list_tools`, `list_prompts`, `list_resources` — need no key.
- **REST escape hatch** — `get("/api/…")` and `health()` against `https://api.eagle-eye.app`.
- **Configuration** via constructor arguments or the `EAGLEEYE_API_KEY` (alias `WM_API_KEY`), `EAGLEEYE_BASE_URL`, and `EAGLEEYE_MCP_URL` environment variables.
- Every tool accepts an optional `jmespath` argument for [server-side projection](https://www.eagle-eye.app/docs/mcp-jmespath) — typically an 80–95% response-size cut.

## Quick start (Python)

```python
from eagleeye_sdk import Client

client = Client(api_key="wm_...")  # or set EAGLEEYE_API_KEY
client.list_tools()                # public — no key needed
client.country_risk("IR")
client.call_tool("get_market_data", asset_class="crypto")
```

Get an API key at https://eagle-eye.app/pro. The full per-language guide — Ruby, Go, and JavaScript examples included — is at https://www.eagle-eye.app/docs/sdks.

## Learn more

- [Developer Portal](https://eagle-eye.app/developers.md) · [MCP Server](https://eagle-eye.app/mcp-server.md) · [OpenAPI Specification](https://eagle-eye.app/openapi.md) · [CLI guide](https://www.eagle-eye.app/docs/cli) · [agents.md](https://eagle-eye.app/agents.md)

## Important query matches

- Eagle Eye SDK
- Eagle Eye Python / Ruby / Go / JavaScript SDK
- Eagle Eye client library
- pip install eagleeye-sdk
- Official Eagle Eye API client libraries
