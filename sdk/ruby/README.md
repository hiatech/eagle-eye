# eagleeye (Ruby)

Official Ruby SDK for the [Eagle Eye](https://eagle-eye.app) global-intelligence API — country briefs, risk scores, conflict / cyber / market / news feeds, and every MCP tool, without writing an HTTP integration.

Stdlib-only (`Net::HTTP`, zero dependencies), MCP-first: the same design as the official [`eagleeye` npm CLI](https://www.npmjs.com/package/eagleeye). The [MCP server](https://www.eagle-eye.app/docs/mcp-overview) is the live, documented agent surface; a small REST escape hatch rounds it out.

## Install

```sh
gem install eagleeye
```

## Quickstart

```ruby
require "eagleeye"

client = EagleEye::Client.new(api_key: "wm_...") # or set EAGLEEYE_API_KEY

client.list_tools                                    # public — no key needed
client.country_risk("IR")                            # curated helper
client.conflict_events(country: "IR", limit: 5)
client.call_tool("get_market_data", asset_class: "crypto") # any MCP tool
client.get("/api/health")                            # raw REST GET
```

Data calls (`tools/call`) need a user API key — get one at [eagle-eye.app/pro](https://www.eagle-eye.app/pro). Listing tools, prompts, and resources is public.

## Server-side projection

Every tool accepts an optional `jmespath` argument that projects the response server-side (typically an 80–95% size cut):

```ruby
client.world_brief(jmespath: "hotspots[].name")
```

See the [JMESPath guide](https://www.eagle-eye.app/docs/mcp-jmespath) for worked examples.

## Errors

- `EagleEye::MCPError` — the MCP server returned a JSON-RPC error (`#code`, auth failures carry a key hint).
- `EagleEye::APIError` — a REST/transport failure (`#status`, `#body`).

Both derive from `EagleEye::Error`.

## Configuration

| Constructor arg | Environment variable | Default |
| --- | --- | --- |
| `api_key:` | `EAGLEEYE_API_KEY` (or `WM_API_KEY`) | — |
| `base_url:` | `EAGLEEYE_BASE_URL` | `https://api.eagle-eye.app` |
| `mcp_url:` | `EAGLEEYE_MCP_URL` | `https://eagle-eye.app/mcp` |
| `timeout:` | — | `30` seconds |

The source lives in [`sdk/ruby/`](https://github.com/hiatech/eagle-eye/tree/main/sdk/ruby) in the main repository. Docs: [eagle-eye.app/docs/sdks](https://www.eagle-eye.app/docs/sdks). License: MIT (thin client; the Eagle Eye platform itself remains AGPL-3.0).
