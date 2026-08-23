# eagleeye (Go)

Official Go SDK for the [Eagle Eye](https://eagle-eye.app) global-intelligence API — country briefs, risk scores, conflict / cyber / market / news feeds, and every MCP tool, without writing an HTTP integration.

Stdlib-only (zero dependencies), MCP-first: the same design as the official [`eagleeye` npm CLI](https://www.npmjs.com/package/eagleeye). The [MCP server](https://www.eagle-eye.app/docs/mcp-overview) is the live, documented agent surface; a small REST escape hatch rounds it out.

## Install

```sh
go get github.com/hiatech/eagle-eye/sdk/go
```

## Quickstart

```go
package main

import (
	"context"
	"fmt"

	eagleeye "github.com/hiatech/eagle-eye/sdk/go"
)

func main() {
	ctx := context.Background()
	client := eagleeye.New("wm_...") // or "" to read EAGLEEYE_API_KEY

	tools, _ := client.ListTools(ctx) // public — no key needed
	fmt.Println(string(tools))

	risk, err := client.CountryRisk(ctx, "IR", nil) // curated helper
	if err != nil {
		panic(err)
	}
	fmt.Println(string(risk))

	// Any MCP tool:
	quotes, _ := client.CallTool(ctx, "get_market_data", eagleeye.Args{"asset_class": "crypto"})
	fmt.Println(string(quotes))

	// Raw REST GET:
	health, _ := client.Get(ctx, "/api/health", nil)
	fmt.Println(string(health))
}
```

Data calls (`tools/call`) need a user API key — get one at [eagle-eye.app/pro](https://www.eagle-eye.app/pro). Listing tools, prompts, and resources is public.

## Server-side projection

Every tool accepts an optional `jmespath` argument that projects the response server-side (typically an 80–95% size cut):

```go
brief, _ := client.WorldBrief(ctx, eagleeye.Args{"jmespath": "hotspots[].name"})
```

See the [JMESPath guide](https://www.eagle-eye.app/docs/mcp-jmespath) for worked examples.

## Errors

- `*eagleeye.MCPError` — the MCP server returned a JSON-RPC error (`.Code`, auth failures carry a key hint).
- `*eagleeye.APIError` — a REST/transport failure (`.Status`, `.Body`).

Use `errors.As` to branch on them.

## Configuration

| Field | Environment variable | Default |
| --- | --- | --- |
| `APIKey` | `EAGLEEYE_API_KEY` (or `WM_API_KEY`) | — |
| `BaseURL` | `EAGLEEYE_BASE_URL` | `https://api.eagle-eye.app` |
| `MCPURL` | `EAGLEEYE_MCP_URL` | `https://eagle-eye.app/mcp` |
| `HTTPClient` | — | `http.Client` with a 30s timeout |

The source lives in [`sdk/go/`](https://github.com/hiatech/eagle-eye/tree/main/sdk/go) in the main repository and is versioned with `sdk/go/vX.Y.Z` tags. Docs: [eagle-eye.app/docs/sdks](https://www.eagle-eye.app/docs/sdks). License: MIT (thin client; the Eagle Eye platform itself remains AGPL-3.0).
