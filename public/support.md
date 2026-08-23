# Support & Contact - Eagle Eye

Last updated: July 5, 2026

How to reach Eagle Eye, by concern. Human-readable version: https://www.eagle-eye.app/docs/support

## Channels

| Concern | Channel | Notes |
| --- | --- | --- |
| General support, account or billing issues | support@eagle-eye.app | Primary support channel for all plans |
| Enterprise, sales, custom quotas | enterprise@eagle-eye.app | Custom pricing, deployments, higher API limits |
| Bug reports & feature requests | https://github.com/hiatech/eagle-eye/issues | Public open-source repository |
| Community & quick questions | https://discord.gg/re63kWKxaz | Community Discord |
| Service status & incidents | https://status.eagle-eye.app | Email subscription available on the page |
| In-app contact form | Form on https://eagle-eye.app/pro | Submits `POST /api/leads/v1/submit-contact`; Turnstile-protected, intended for humans in a browser — agents should email support@ instead |

## Response Expectations

- Free and Pro: best-effort support via email, GitHub and Discord. No formal SLA.
- API: best-effort support via email; include your key prefix (never the full key) and request IDs.
- Enterprise: dedicated support with committed response times, agreed per contract — contact enterprise@eagle-eye.app.

## Common Self-Serve Answers

- Find, create, or replace a `wm_` key: https://www.eagle-eye.app/docs/api-keys. Full keys are shown only once and cannot be recovered; revoke a lost key and create a replacement.
- API key rotation or limit increases: see https://www.eagle-eye.app/docs/usage-auth and https://www.eagle-eye.app/docs/usage-rate-limits, or email support@eagle-eye.app.
- Pricing and plans: https://eagle-eye.app/pricing.md (markdown) or `GET https://www.eagle-eye.app/api/product-catalog` (JSON, public).
- Billing portal (invoices, cancel/renew): sign in at https://eagle-eye.app/pro and open the customer portal.
- Security reports: see https://www.eagle-eye.app/.well-known/security.txt

## Machine-Readable Summary

```json
{
  "product": "Eagle Eye",
  "support_email": "support@eagle-eye.app",
  "enterprise_email": "enterprise@eagle-eye.app",
  "issues_url": "https://github.com/hiatech/eagle-eye/issues",
  "community_url": "https://discord.gg/re63kWKxaz",
  "status_url": "https://status.eagle-eye.app",
  "security_txt": "https://www.eagle-eye.app/.well-known/security.txt",
  "sla": { "free": "best-effort", "pro": "best-effort", "api": "best-effort", "enterprise": "contracted" }
}
```
