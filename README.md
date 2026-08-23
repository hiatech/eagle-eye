# Eagle Eye

> **This is a modified fork.** Maintained by Hiatech at
> [hiatech/eagle-eye](https://github.com/hiatech/eagle-eye), forked from
> [koala73/worldmonitor](https://github.com/koala73/worldmonitor) at `d9a65dd`. It is not
> endorsed by or affiliated with the upstream project. Changes since the fork point are
> recorded in the git history; see [NOTICE](NOTICE) for attribution and the AGPL-3.0-only
> section 13 source offer.

[简体中文](README.zh-CN.md) | [日本語](README.ja-JP.md)

**Real-time global intelligence dashboard** — AI-powered news aggregation, geopolitical monitoring, and infrastructure tracking in a unified situational awareness interface.

[![GitHub stars](https://img.shields.io/github/stars/hiatech/eagle-eye?style=social)](https://github.com/hiatech/eagle-eye/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/re63kWKxaz)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Last commit](https://img.shields.io/github/last-commit/hiatech/eagle-eye)](https://github.com/hiatech/eagle-eye/commits/main)
[![Latest release](https://img.shields.io/github/v/release/hiatech/eagle-eye?style=flat)](https://github.com/koala73/worldmonitor/releases/latest)
[![npm: eagleeye](https://img.shields.io/npm/v/eagleeye?logo=npm&label=npm)](https://www.npmjs.com/package/eagleeye)
[![smithery badge](https://smithery.ai/badge/eagleeye/wm-mcp)](https://smithery.ai/servers/eagleeye/wm-mcp)
[![skills.sh](https://skills.sh/b/hiatech/eagle-eye)](https://skills.sh/hiatech/eagle-eye)

<p align="center">
  <a href="https://www.eagle-eye.app"><img src="https://img.shields.io/badge/Web_App-eagle-eye.app-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Web App"></a>&nbsp;
  <a href="https://tech.eagle-eye.app"><img src="https://img.shields.io/badge/Tech_Variant-tech.eagle-eye.app-0891b2?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Tech Variant"></a>&nbsp;
  <a href="https://finance.eagle-eye.app"><img src="https://img.shields.io/badge/Finance_Variant-finance.eagle-eye.app-059669?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Finance Variant"></a>&nbsp;
  <a href="https://commodity.eagle-eye.app"><img src="https://img.shields.io/badge/Commodity_Variant-commodity.eagle-eye.app-b45309?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Commodity Variant"></a>&nbsp;
  <a href="https://happy.eagle-eye.app"><img src="https://img.shields.io/badge/Happy_Variant-happy.eagle-eye.app-f59e0b?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Happy Variant"></a>&nbsp;
  <a href="https://energy.eagle-eye.app"><img src="https://img.shields.io/badge/Energy_Variant-energy.eagle-eye.app-eab308?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Energy Variant"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/eagleeye"><img src="https://img.shields.io/npm/v/eagleeye?style=for-the-badge&logo=npm&logoColor=white&label=npm%20i%20eagleeye&color=CB3837" alt="npm i eagleeye"></a>&nbsp;
  <a href="https://www.npmjs.com/package/eagleeye"><img src="https://img.shields.io/badge/CLI-npx%20eagleeye-CB3837?style=for-the-badge&logo=npm&logoColor=white" alt="npx eagleeye"></a>&nbsp;
  <a href="https://pypi.org/project/eagleeye-sdk/"><img src="https://img.shields.io/pypi/v/eagleeye-sdk?style=for-the-badge&logo=pypi&logoColor=white&label=pip%20install%20eagleeye-sdk&color=3775A9" alt="pip install eagleeye-sdk"></a>&nbsp;
  <a href="https://rubygems.org/gems/eagleeye"><img src="https://img.shields.io/gem/v/eagleeye?style=for-the-badge&logo=rubygems&logoColor=white&label=gem%20install%20eagleeye&color=E9573F" alt="gem install eagleeye"></a>&nbsp;
  <a href="https://pkg.go.dev/github.com/hiatech/eagle-eye/sdk/go"><img src="https://img.shields.io/badge/go%20get-sdk%2Fgo-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="go get github.com/hiatech/eagle-eye/sdk/go"></a>
</p>

<p align="center">
  <a href="https://www.eagle-eye.app/api/download?platform=windows-exe"><img src="https://img.shields.io/badge/Download-Windows_(.exe)-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download Windows"></a>&nbsp;
  <a href="https://www.eagle-eye.app/api/download?platform=macos-arm64"><img src="https://img.shields.io/badge/Download-macOS_Apple_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download macOS ARM"></a>&nbsp;
  <a href="https://www.eagle-eye.app/api/download?platform=macos-x64"><img src="https://img.shields.io/badge/Download-macOS_Intel-555555?style=for-the-badge&logo=apple&logoColor=white" alt="Download macOS Intel"></a>&nbsp;
  <a href="https://www.eagle-eye.app/api/download?platform=linux-appimage"><img src="https://img.shields.io/badge/Download-Linux_(.AppImage)-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download Linux"></a>
</p>

<p align="center">
  <a href="https://www.eagle-eye.app/docs/documentation"><strong>Documentation</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/koala73/worldmonitor/releases/latest"><strong>Releases</strong></a> &nbsp;·&nbsp;
  <a href="https://www.eagle-eye.app/docs/contributing"><strong>Contributing</strong></a>
</p>

![Eagle Eye Dashboard](docs/images/eagle-eye-7-mar-2026.jpg)

---

## What It Does

- **500+ curated news feeds** across 15 categories, AI-synthesized into briefs
- **Dual map engine** — 3D globe (globe.gl) and WebGL flat map (deck.gl) with 56 map layer types
- **Cross-stream correlation** — military, economic, disaster, and escalation signal convergence
- **Country Instability Index (CII)** — server-authoritative CII v8 stress scoring for 31 Tier-1 countries
- **Finance radar** — 29 stock exchanges, commodities, crypto, and 7-signal market composite
- **Local AI** — run everything with Ollama, no API keys required
- **6 site variants** from a single codebase (world, tech, finance, commodity, happy, energy)
- **Native desktop app** (Tauri 2) for macOS, Windows, and Linux
- **26 languages** with native-language feeds and RTL support

For the full feature list, architecture, data sources, and algorithms, see the **[documentation](https://www.eagle-eye.app/docs/documentation)**.

---

## Support Status

All site variants and desktop binaries are built from a single codebase and ship from the same release process. The table below clarifies maintenance status so you know which surfaces are safe to depend on.

| Surface | Status | Notes |
|---------|--------|-------|
| `eagle-eye.app`, `tech.`, `finance.`, `commodity.`, `happy.`, `energy.` | Stable | Public deployments built from this repo, actively maintained |
| Desktop binaries (Windows / macOS Apple Silicon / macOS Intel / Linux AppImage) | Stable | One Tauri binary for every variant — install Eagle Eye and switch to tech, finance, commodity, energy, or happy in-app. There is deliberately no per-variant download |

Issues filed against any of the above are triaged from the same backlog — see the [issues board](https://github.com/hiatech/eagle-eye/issues) for currently-open work.

---

## Quick Start

```bash
git clone https://github.com/hiatech/eagle-eye.git
cd eagleeye
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000) (override the port with `DEV_PORT` in `.env.local`). The app runs with no environment variables.

Feature-specific data sources may require credentials. See `.env.example` for the full list.

For variant-specific development:

```bash
npm run dev:tech       # tech.eagle-eye.app
npm run dev:finance    # finance.eagle-eye.app
npm run dev:commodity  # commodity.eagle-eye.app
npm run dev:happy      # happy.eagle-eye.app
npm run dev:energy     # energy.eagle-eye.app
```

See the **[self-hosting guide](https://www.eagle-eye.app/docs/getting-started)** for deployment options (Vercel, Docker, static).

---

## Tech Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | Vanilla TypeScript, Vite, globe.gl + Three.js, deck.gl + MapLibre GL |
| **Desktop** | Tauri 2 (Rust) with Node.js sidecar |
| **AI/ML** | Ollama / Groq / OpenRouter, Transformers.js (browser-side) |
| **API Contracts** | Protocol Buffers (295 protos, 36 services), sebuf HTTP annotations |
| **Deployment** | Vercel Edge Functions (60+), Railway relay, Tauri, PWA |
| **Caching** | Redis (Upstash), 3-tier cache, CDN, service worker |

Full stack details in the **[architecture docs](https://www.eagle-eye.app/docs/architecture)**.

---

## Programmatic Access

Eagle Eye is built for agents and scripts as well as browsers:

- **MCP server** — `https://eagle-eye.app/mcp` (Streamable HTTP). Public `tools/list`; `tools/call` authenticates with a `X-EagleEye-Key` header or OAuth.
- **REST API** — base `https://api.eagle-eye.app`, described by the [OpenAPI spec](https://eagle-eye.app/openapi.yaml).
- **CLI** — the official [`eagleeye`](https://www.npmjs.com/package/eagleeye) npm package (source in [`cli/`](cli/)):

  ```sh
  npx eagleeye tools          # run ad-hoc — list every MCP tool (no key needed)
  npm install -g eagleeye     # or install the `eagleeye` (alias `wm`) command
  eagleeye risk IR --api-key wm_xxx
  ```

- **SDKs** — official zero-dependency client libraries mirroring the CLI: Python [`eagleeye-sdk`](https://pypi.org/project/eagleeye-sdk/) (source in [`sdk/python/`](sdk/python/)), Ruby [`eagleeye`](https://rubygems.org/gems/eagleeye) ([`sdk/ruby/`](sdk/ruby/)), Go [`github.com/hiatech/eagle-eye/sdk/go`](https://pkg.go.dev/github.com/hiatech/eagle-eye/sdk/go) ([`sdk/go/`](sdk/go/)). Guide: [eagle-eye.app/docs/sdks](https://www.eagle-eye.app/docs/sdks).

Agent discovery files: [`llms.txt`](https://eagle-eye.app/llms.txt) · [agent-skills manifest](https://eagle-eye.app/.well-known/agent-skills/index.json) · [api-catalog](https://eagle-eye.app/.well-known/api-catalog). Get an API key at [eagle-eye.app/pro](https://www.eagle-eye.app/pro).

---

## Flight Data

Flight data provided graciously by [Wingbits](https://wingbits.com?utm_source=eagleeye&utm_medium=referral&utm_campaign=eagleeye), the most advanced ADS-B flight data solution.

---

## Data Sources

EagleEye aggregates 588+ observed upstream hosts across geopolitics, finance, energy, climate, aviation, cyber, military, infrastructure, and news intelligence — surfaced through 500+ curated feeds and tracked by a freshness monitor covering 35 source groups. See the full [data sources catalog](https://www.eagle-eye.app/docs/data-sources) for providers, feed tiers, license posture, and collection methods.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

```bash
npm run typecheck        # Type checking
npm run build:full       # Production build
```

---

## License

**AGPL-3.0-only** for the source code. Commercial use is permitted under the AGPL when you comply with its copyleft and source-availability terms.

| Use Case | Allowed? |
|----------|----------|
| Personal / research / educational | Yes, under AGPL-3.0-only |
| Self-hosted instance | Yes, under AGPL-3.0-only |
| Fork and modify | Yes, share source under AGPL-3.0-only when required |
| Commercial use / SaaS | Yes, under AGPL-3.0-only when you comply with AGPL obligations |
| Private-source proprietary use or official branding rights | Separate commercial or trademark permission needed |

See [LICENSE](LICENSE) for the full code license and [docs/license.mdx](docs/license.mdx) for a plain-language summary. Commercial licensing is available as an alternative option for teams that need non-AGPL terms.

Copyright (C) 2024-2026 Elie Habib. All rights reserved.
Copyright (C) 2026 Hiatech — modifications in this fork. See [NOTICE](NOTICE).

---

## Author

**Elie Habib** — [GitHub](https://github.com/koala73)

## Contributors

<a href="https://github.com/koala73/worldmonitor/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=koala73/worldmonitor" />
</a>

## Security Acknowledgments

We thank the following researchers for responsibly disclosing security issues:

- **Cody Richard** — Disclosed three security findings covering IPC command exposure, renderer-to-sidecar trust boundary analysis, and fetch patch credential injection architecture (2026)

See our [Security Policy](./SECURITY.md) for responsible disclosure guidelines.

---

<p align="center">
  <a href="https://www.eagle-eye.app">eagle-eye.app</a> &nbsp;·&nbsp;
  <a href="https://www.eagle-eye.app/docs/documentation">docs.eagle-eye.app</a> &nbsp;·&nbsp;
  <a href="https://finance.eagle-eye.app">finance.eagle-eye.app</a> &nbsp;·&nbsp;
  <a href="https://commodity.eagle-eye.app">commodity.eagle-eye.app</a>
</p>

## Star History

<a href="https://api.star-history.com/svg?repos=koala73/worldmonitor&type=Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=koala73/worldmonitor&type=Date&theme=dark" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=koala73/worldmonitor&type=Date" />
 </picture>
</a>
