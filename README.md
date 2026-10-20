# WaitMint Ad Platform

The advertiser-side backend for the **WaitMint** browser extension. The
extension shows one clearly-labelled sponsored card while an AI chat tool
(ChatGPT, Claude, Gemini, DeepSeek, 20+ more) is generating an answer;
this service produces the JSON feeds it renders, takes campaign
submissions, and keeps the books.

**There is no checkout in this system, on purpose.** Advertisers submit
a campaign for free → a human reviews it → on approval we email an
invoice with a payment link → the campaign goes live when the invoice is
paid. Nothing about that flow is simulated; the endpoints below are the
whole machine.

## Feeds (public, fixed contract)

| Endpoint | What it returns |
|---|---|
| `GET /ads.json` | Active **approved** campaigns (budget not exhausted) merged with house ads. Array of `{id, title, body, url, cta}` — the exact schema the extension consumes. Sends `ETag` + `Cache-Control` and honours `If-None-Match`. |
| `GET /network-ads.json` | Operator-registered **network/direct creatives**: `{id, title, body, url, cta, network, imageUrl?}`. Empty array `[]` when none are configured — the extension then just uses `/ads.json`. |
| `GET /health` | `{ok: true}` liveness probe. |

## Campaigns

`POST /campaigns` — body:
`{advertiserName, email, title, body, url, cta, budgetUSD, targetPlatforms[]}`

Validated server-side (email format, http(s) URL, copy lengths —
title ≤ 80, body ≤ 200, CTA ≤ 24 — budget **$50 minimum**, platforms
must be from the supported list or `["all"]`). Stored as `pending`.
Nothing is emailed by the server; a line is appended to
`data/notifications.log` and the submission shows up in the admin list,
which is how the operator learns about it in v1.

## Tracking & user earnings

`POST /track/impression` and `POST /track/click` — body:
`{adId, installId?, platform?}`

- Aggregate counters per ad id. Nothing else is stored per event.
- `platform` (optional) is the AI site's host, e.g. `chatgpt.com` —
  kept only as aggregate per-host counts.
- `installId` (optional) is an **anonymous random UUID the extension
  generates**. On **paid-campaign** impressions it accrues the viewer's
  share of the revenue split (see below). House and network cards
  accrue nothing — there is no advertiser revenue behind them.
- `GET /me/balance?installId=` → `{installId, impressions, clicks,
  accruedUSD, payoutThresholdUSD, payoutReady, payoutNote}`.

**Payouts, honestly:** balances become payout-eligible at **$10**, and in
v1 payouts are processed **manually**. There are no instant payouts and
this README will not pretend otherwise.

## Revenue split (business model)

Every gross advertiser dollar is split — config in exactly one place,
`lib/pricing.js` → `REVENUE_SPLIT`:

| Pool | Share | Notes |
|---|---|---|
| Platform | **50%** | WaitMint's share: hosting, review, development. |
| Users | **40%** | Accrued per paid impression to the viewer's anonymous install id: $12 CPM × 40% = **$0.0048 per impression** ($4.80 per 1,000). |
| Cited sources | **10%** | Accrues into a platform-level pool, labelled in admin stats as **“cited pool (undistributed)”**. Attributing an impression to the specific pages an AI answer cited is phase-2; v1 accounts the pool honestly instead of inventing attributions. |

Advertisers always burn budget at the **gross $12 CPM** — the split is
about distributing revenue, never about what advertisers pay.

Worked example (asserted in the tests): 1,000 paid impressions =
$12.00 gross → platform $6.00, users $4.80, cited pool $1.20.

## Pricing

Flat **$12 CPM** for every approved campaign. Spend =
`impressions / 1000 × 12`. A campaign automatically drops out of the
feed the moment accrued spend reaches its budget — delivery can never
overshoot the budget. Minimum campaign budget $50.

## Admin API

All admin endpoints require the `x-admin-token` header to match the
`ADMIN_TOKEN` env var (constant-time comparison). If `ADMIN_TOKEN` is
unset, every admin endpoint returns `503` — fail closed.

| Endpoint | Purpose |
|---|---|
| `GET /admin/campaigns` | All campaigns with status, stats, spend, remaining budget, live flag. |
| `POST /admin/campaigns/:id/approve` | Approve a pending campaign (`{note?}`). 409 if already reviewed. |
| `POST /admin/campaigns/:id/reject` | Reject a pending campaign (`{note?}`). |
| `GET /admin/stats` | Per-ad impressions/clicks/CTR; per-platform aggregates; the **revenue section** with the three pools and per-install accruals. |
| `GET /admin/network-ads` | List operator-registered network creatives. |
| `POST /admin/network-ads` | Register one: `{network, title, body, url, cta, imageUrl?}`. |
| `DELETE /admin/network-ads/:id` | Remove one. |

## Network & direct creatives — why data-only?

Networks like Adsterra approve an account/placement and hand the
publisher ad creatives or tags. **WaitMint uses the creatives, never the
tags**: the operator registers the finished creative (headline, copy,
link, optional image) through the admin API after the network approves
the placement, and the extension renders it from the JSON feed like any
other card.

This is not an aesthetic choice. Browser extensions are forbidden from
executing remotely hosted code (Chrome Web Store policy / Manifest V3
remote-code ban), and classic tag-based networks — AdSense above all —
prohibit their tags inside extensions and iframes they don't control.
Dropping a network's JS tag into chatgpt.com via a content script would
get the extension removed and the ad account banned. Data-only creatives
keep WaitMint compliant with store policy *and* network terms, and they
keep the privacy promise below intact. Consequence, stated plainly: **no
network is pre-integrated or auto-serving** — every network creative is
registered and reviewed by the operator first.

## Privacy (full rule)

The platform and extension together collect the minimum that ad delivery
and earnings require:

- **Never**: prompts, AI responses, page content, browsing history,
  IP addresses, user agents, names, emails of viewers (advertiser
  emails exist only on their own campaign submissions).
- **Yes, only these**: the ad id shown/clicked, the platform host
  (e.g. `chatgpt.com`), and the anonymous install UUID — the last one
  solely so users can accrue and check their 40% share.
- Stats are aggregates. IPs appear only in server memory, briefly, for
  rate limiting, and are never written to disk or logs.

## Running locally

```bash
npm install
cp .env.example .env   # set ADMIN_TOKEN to a long random value
npm start              # http://localhost:3000
npm test               # unit + end-to-end suite (tests/run-tests.sh)
```

## Deploying to Render (free tier)

1. Push this folder to a Git repo (or use Render's "deploy from repo"
   with this as the service root).
2. **New → Web Service**, runtime **Node**, build command
   `npm install`, start command `npm start`. Free instance type.
3. Environment variables: `ADMIN_TOKEN` (long random value — generate
   with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`),
   optionally `FEED_CACHE_SECONDS`, `DATA_DIR`.
   Render sets `PORT` itself; don't override it.
4. Health check path: `/health`.
5. **Free-tier caveat, honestly:** the filesystem is ephemeral — the
   JSON store (`data/store.json`, `notifications.log`) resets on
   redeploy/restart, and the service sleeps after inactivity (first
   request is slow). Fine for the founding phase; before real advertiser
   volume, attach a Render Disk or move the store to Postgres — the
   `Store` class is the only file that would change.

## Feed URL wiring for the extension

The extension reads `https://visionquantech.com/waitmint/ads.json`.
Cleanest wiring: on the Cloudflare Pages site, add a tiny proxy Function
(or a `_redirects` 307 rule) that forwards
`visionquantech.com/waitmint/ads.json` → this service's `/ads.json`
(and likewise `…/waitmint/network-ads.json` → `/network-ads.json`).
The API already sends permissive CORS + cache headers, so the simpler
fallback — pointing the extension at the Render URL directly — also
works; the vanity domain is nicer and survives backend moves.
