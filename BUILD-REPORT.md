# WaitMint Ad Platform — Build Report
> **CORRECTION (2026-10-20, founder's order):** the revenue split quoted in this report (40/10/50) was reversed. The correct split is **Platform 50% / Users 40% / Cited 10%** (user accrual $0.0048 per paid impression). lib/pricing.js, README and both test suites were updated and re-verified green under 50/40/10; the figures below are the historical build-day output.

**Date:** 2026-10-20 · **Status:** built and fully tested locally. Nothing
deployed; `~/workspace/vq-site-live/` untouched.

## What was built

```
waitmint-platform/
├── server.js                  Express app: feeds, campaigns, tracking,
│                              earnings balance, admin (token) + hardening
├── lib/
│   ├── pricing.js             $12 CPM, budget math, REVENUE_SPLIT config
│   ├── platforms.js           25 supported AI platforms (+ "all")
│   ├── validate.js            Campaign + network-ad + installId validation
│   └── store.js               JSON-file store (atomic writes, write queue,
│                              debounced stat flushes, earnings ledger)
├── data/
│   └── house-ads.json         7 house ads in the fixed feed schema
│                              (ReviewGuard, SubWatch, OutreachOS,
│                              WhatsApp Invoice, Lead Scraper,
│                              AgentBook OS, ServeQuote Ops)
├── pages/waitmint/
│   ├── index.html             Product landing (25 platforms, privacy
│                              promise, honest founding-phase framing,
│                              install buttons as `#install` placeholders)
│   └── advertise.html         Advertiser page: audience pitch, $12 CPM /
│                              $50-min pricing card, pay-on-invoice flow,
│                              "Also accepted: network & direct deals"
│                              section, FAQ-free honest copy, and the
│                              campaign form wired to POST /campaigns via
│                              a single CONFIG.AD_API_BASE constant
└── tests/
    ├── unit-pricing.js        8 money-math checks
    ├── e2e.js                 41 real-HTTP lifecycle checks
    └── run-tests.sh           runs both suites
```

### Business model implemented (as specified)

- **Revenue split** (`lib/pricing.js`, one config object):
  `REVENUE_SPLIT = { platform: 40, users: 10, cited: 50 }`.
- **User earnings ledger:** tracking calls accept an anonymous
  `installId` (extension-generated UUID — no personal data, no content).
  Paid-campaign impressions accrue $0.0012 each (10% of $12 CPM).
  `GET /me/balance?installId=` returns counts + accrued balance.
  Payout threshold $10, **manual payouts in v1** — stated in the API
  response, the README, and the page copy. No instant-payout claims.
- **Cited-sources pool:** 50% accrues as a platform-level pool, labelled
  in admin stats exactly as `cited pool (undistributed)` — per-source
  attribution is phase-2 and is not faked.
- **Admin stats** show gross spend and all three pools separately, plus
  attributed vs unattributed user money and per-install totals.
- Advertiser budget burn stays **gross $12 CPM**; the split only
  distributes revenue.

### Network ads (as specified)

- `GET /network-ads.json` — same creative schema as `/ads.json` plus a
  `network` field; returns `[]` when nothing is configured.
- Admin CRUD: `POST/GET /admin/network-ads`, `DELETE
  /admin/network-ads/:id`, same `ADMIN_TOKEN` protection.
- **Rationale (also in README):** these are creatives the operator
  manually registers *after* a network (e.g. Adsterra) approves his
  account/placement. The extension never loads remote JS — Manifest V3 /
  Chrome Web Store policy bans remotely hosted code in extensions, and
  tag-based networks (AdSense above all) prohibit their tags in
  extensions. Data-only creatives are the compliant route. The advertise
  page says plainly that no network is pre-integrated or auto-serving.

### Security / robustness

- Hand-rolled helmet-style headers (nosniff, frame-deny, CSP
  `default-src 'none'`, HSTS, referrer-policy), `x-powered-by` off.
- Admin auth: constant-time token compare; admin **disabled (503)**
  when `ADMIN_TOKEN` is unset.
- Rate limits on all POST endpoints + balance lookups (per-IP,
  env-tunable; IPs live only in memory, never persisted).
- Input sanitization at intake (control chars / angle brackets stripped,
  strict URL + email + budget + platform validation), 32 KB body cap,
  JSON parse errors → clean 400s.
- Privacy: no IPs/user-agents/content stored anywhere; stats are
  aggregates; earnings keyed only by anonymous install UUID.

## Test evidence (real outputs, 2026-10-20)

`npm test` → **49/49 checks passed** (8 unit + 41 e2e). The e2e boots the
real server on a scratch port with a scratch data dir and drives the
whole lifecycle over HTTP, including firing 4,167 real impression calls
to prove budget exhaustion at exactly $50.00.

```
=== unit tests ===
unit: pricing
  ok - CPM is $12, split is 40/10/50, threshold $10
  ok - spend: 0 impressions = $0
  ok - spend: 1000 impressions = $12.00
  ok - spend: 250 impressions = $3.00
  ok - exhaustion: $50 budget survives 4166 impressions, dies at 4167
  ok - split: 1000 impressions → gross $12 = platform $4.80 + users $1.20 + cited $6.00
  ok - user accrual: 1 impression = $0.0012; 1000 = $1.20; 8334 = $10.0008 (past payout threshold)
  ok - impressionsRemaining: $50 budget, 1000 shown → 3166 left
unit: pricing — 8 checks passed

=== e2e tests ===
e2e: server up on scratch port with scratch data dir
  ok - GET /ads.json → 200 with the 7 house ads, all house_* ids
  ok - house feed entries match the fixed contract {id,title,body,url,cta}
  ok - GET /network-ads.json → 200 [] when nothing is configured
  ok - POST /campaigns invalid payload → 400 with errors
  ok - POST /campaigns budget below $50 minimum → 400
  ok - POST /campaigns valid → 201 pending
  ok - submission response states the pay-on-invoice flow (no checkout)
  ok - pending campaign is NOT in the feed
  ok - GET /admin/campaigns without token → 401
  ok - GET /admin/campaigns with wrong token → 401
  ok - GET /admin/campaigns with token → lists the pending campaign
  ok - POST approve → 200 approved + live
  ok - approved campaign IS in the feed with the exact contract shape
  ok - 1000 impressions tracked (all 204)
  ok - GET /me/balance → impressions 1000, accrued $1.20 (10% of $12 gross)
  ok - balance states manual payout + $10 threshold honestly
  ok - GET /me/balance without installId → 400
  ok - clicks accrue to the ledger but do NOT change the money (CPM pays on impressions)
  ok - admin stats revenue: gross $12.00 → platform $4.80 / users $1.20 / cited $6.00
  ok - users pool fully attributed to the one install id ($1.20 attributed, $0 unattributed)
  ok - cited pool honestly labelled undistributed
  ok - per-platform aggregate recorded (chatgpt.com = 1000 impressions)
  ok - campaign stats: 1000 impressions, 10 clicks, spend $12.00 of $50 budget
  ok - house-ad impression → 204
  ok - house-ad impression does NOT accrue user earnings (no advertiser revenue behind it)
  ok - tracking an unknown adId → 400
  ok - campaign auto-pauses at budget: gone from feed at 4167 impressions ($50.00 spent)
  ok - admin view shows spend $50.00, remaining $0, live=false
  ok - second campaign submitted pending
  ok - reject → 200 rejected
  ok - rejected campaign never enters the feed
  ok - approving an already-rejected campaign → 409
  ok - POST /admin/network-ads without token → 401
  ok - POST /admin/network-ads bad URL → 400
  ok - POST /admin/network-ads valid → 201
  ok - network creative appears in /network-ads.json with the network field
  ok - GET /admin/network-ads lists the creative
  ok - DELETE /admin/network-ads/:id → 200 removed
  ok - deleted creative is gone from /network-ads.json
  ok - DELETE again → 404
  ok - notifications.log recorded submission, approval, exhaustion, network add/remove
e2e: 41 checks passed

ALL TESTS PASSED
```

A separate manual **curl** smoke run against a live instance confirmed
the same flow from the shell:

- `GET /ads.json` → 7 house ads, first = ReviewGuard.
- `POST /campaigns` → `{"id":"cmp_18b1f8d8403b","status":"pending", …pay-on-invoice message…}`
- Admin approve → `{"status":"approved","live":true}`; the campaign then
  appears in `/ads.json` with exactly `{id,title,body,url,cta}`.
- Network creative via curl: add (`net_21fc99dad8d3`, network "Direct")
  → present in `/network-ads.json` → DELETE → feed back to `[]`.
- Server log shows the `[notify] campaign.submitted …` audit line (also
  appended to `data/notifications.log`).

## Deploy checklist — what the parent agent must wire

1. **Render service:** create a Web Service from this folder
   (build `npm install`, start `npm start`, health check `/health`).
   Set env `ADMIN_TOKEN` (long random). Note the real service URL.
2. **Advertise page:** replace the placeholder in
   `pages/waitmint/advertise.html` → `CONFIG.AD_API_BASE`
   (currently `https://waitmint-ads.onrender.com`, clearly marked
   "DEPLOY WIRING") with the real backend URL.
3. **Pages deploy:** copy `pages/waitmint/` into the visionquantech.com
   Cloudflare Pages site so the pages live at
   `visionquantech.com/waitmint/` and `…/waitmint/advertise.html`.
4. **Feed URL (recommended option):** add a Cloudflare Pages Function
   or `_redirects` 307 rule mapping
   `visionquantech.com/waitmint/ads.json` → `<render-url>/ads.json`
   and `visionquantech.com/waitmint/network-ads.json` →
   `<render-url>/network-ads.json`, so the extension's fixed feed URL
   works and survives backend moves. (Fallback: point the extension at
   the Render URL directly — CORS + cache headers already allow it.)
5. **Install buttons:** the landing page's store buttons are `href="#install"`
   placeholders — wire them to the live Chrome Web Store / Edge /
   Firefox listings once the extension is published.
6. **Operator routine:** watch `data/notifications.log` (or
   `GET /admin/campaigns`) for submissions → review → approve → send the
   payment-link invoice manually → the campaign is already live-capable
   on approval, so take payment promptly; register network creatives via
   `POST /admin/network-ads` only after a network approves a placement.

## Known v1 limits (stated, not hidden)

- Render free tier: ephemeral filesystem (store resets on redeploy) and
  cold starts. Store is isolated in `lib/store.js` for a future
  Postgres/Disk move.
- No automated advertiser emails — operator works from the admin list +
  notifications log.
- Cited-sources money is pooled, not yet attributed per source
  (phase-2), and user payouts are manual (phase-2: automated rails).
