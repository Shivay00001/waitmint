'use strict';

/**
 * End-to-end test: boots the real server on a scratch port with a scratch
 * data dir and exercises the full lifecycle over HTTP —
 *   submit → pending (not in feed) → admin approve → in feed →
 *   tracking → earnings accrual + revenue pools → budget exhaustion
 *   (auto-pause) → reject path → network-ads CRUD.
 *
 * Run via tests/run-tests.sh (sets the env), or directly:
 *   node tests/e2e.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'test-admin-token';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'waitmint-e2e-'));

let passed = 0;
function ok(name, cond, extra) {
  if (!cond) throw new Error(`ASSERT FAILED: ${name}${extra ? ' — ' + extra : ''}`);
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function req(method, url, { body, token } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-admin-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204s etc. */ }
  return { status: res.status, json, text };
}

async function fireImpressions(adId, count, extra = {}) {
  for (let i = 0; i < count; i++) {
    const r = await req('POST', '/track/impression', { body: { adId, ...extra } });
    if (r.status !== 204) throw new Error(`impression ${i} returned ${r.status}`);
  }
}

async function waitForServer(deadlineMs = 15000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await req('GET', '/health');
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > deadlineMs) throw new Error('server did not come up');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_TOKEN: ADMIN,
      DATA_DIR,
      TRACK_RATE_PER_MIN: '1000000',
      SUBMIT_RATE_PER_MIN: '1000',
      ADMIN_RATE_PER_MIN: '100000',
      FEED_CACHE_SECONDS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  try {
    await waitForServer();
    console.log('e2e: server up on scratch port with scratch data dir');

    // ---- feeds start as: house ads only / empty network feed ----
    let r = await req('GET', '/ads.json');
    ok('GET /ads.json → 200 with the 7 house ads, all house_* ids',
      r.status === 200 && Array.isArray(r.json) && r.json.length === 7 && r.json.every((a) => a.id.startsWith('house_')),
      JSON.stringify(r.json && r.json.length));
    ok('house feed entries match the fixed contract {id,title,body,url,cta}',
      r.json.every((a) => ['id', 'title', 'body', 'url', 'cta'].every((k) => typeof a[k] === 'string' && a[k].length > 0)));

    r = await req('GET', '/network-ads.json');
    ok('GET /network-ads.json → 200 [] when nothing is configured', r.status === 200 && Array.isArray(r.json) && r.json.length === 0);

    // ---- validation ----
    r = await req('POST', '/campaigns', { body: { advertiserName: 'Bad Co', email: 'not-an-email', title: 'x', body: 'short', url: 'ftp://nope', cta: '', budgetUSD: 10, targetPlatforms: ['ChatGPT'] } });
    ok('POST /campaigns invalid payload → 400 with errors', r.status === 400 && Array.isArray(r.json.errors) && r.json.errors.length >= 3, r.text);

    r = await req('POST', '/campaigns', { body: { advertiserName: 'Low Budget', email: 'a@b.co', title: 'Valid title', body: 'A perfectly valid body text', url: 'https://example.com', cta: 'Go', budgetUSD: 49.99 } });
    ok('POST /campaigns budget below $50 minimum → 400', r.status === 400);

    // ---- submit a real campaign ----
    const campaignPayload = {
      advertiserName: 'Acme DevTools',
      email: 'ads@acme-devtools.example',
      title: 'Acme — ship code reviews 2x faster',
      body: 'Acme plugs into your repo and reviews every pull request in minutes, not days.',
      url: 'https://acme-devtools.example/pricing',
      cta: 'Try Acme free',
      budgetUSD: 50,
      targetPlatforms: ['ChatGPT', 'Claude'],
    };
    r = await req('POST', '/campaigns', { body: campaignPayload });
    ok('POST /campaigns valid → 201 pending', r.status === 201 && r.json.status === 'pending', r.text);
    const campaignId = r.json.id;
    ok('submission response states the pay-on-invoice flow (no checkout)', /invoice/i.test(r.json.message));

    r = await req('GET', '/ads.json');
    ok('pending campaign is NOT in the feed', !r.json.some((a) => a.id === campaignId));

    // ---- admin auth + review ----
    r = await req('GET', '/admin/campaigns');
    ok('GET /admin/campaigns without token → 401', r.status === 401);
    r = await req('GET', '/admin/campaigns', { token: 'wrong-token' });
    ok('GET /admin/campaigns with wrong token → 401', r.status === 401);
    r = await req('GET', '/admin/campaigns', { token: ADMIN });
    ok('GET /admin/campaigns with token → lists the pending campaign',
      r.status === 200 && r.json.campaigns.some((c) => c.id === campaignId && c.status === 'pending'));

    r = await req('POST', `/admin/campaigns/${campaignId}/approve`, { token: ADMIN, body: { note: 'Looks good' } });
    ok('POST approve → 200 approved + live', r.status === 200 && r.json.campaign.status === 'approved' && r.json.campaign.live === true, r.text);

    r = await req('GET', '/ads.json');
    const feedAd = r.json.find((a) => a.id === campaignId);
    ok('approved campaign IS in the feed with the exact contract shape',
      !!feedAd && feedAd.title === campaignPayload.title && feedAd.url === campaignPayload.url &&
      Object.keys(feedAd).sort().join(',') === 'body,cta,id,title,url',
      JSON.stringify(feedAd));

    // ---- earnings: 1000 paid impressions with one install id ----
    const installId = crypto.randomUUID();
    await fireImpressions(campaignId, 1000, { installId, platform: 'chatgpt.com' });
    ok('1000 impressions tracked (all 204)', true);

    r = await req('GET', `/me/balance?installId=${installId}`);
    ok('GET /me/balance → impressions 1000, accrued $4.80 (40% of $12 gross)',
      r.status === 200 && r.json.impressions === 1000 && r.json.accruedUSD === 4.8, JSON.stringify(r.json));
    ok('balance states manual payout + $10 threshold honestly',
      r.json.payoutThresholdUSD === 10 && r.json.payoutReady === false && /manually/i.test(r.json.payoutNote));

    r = await req('GET', '/me/balance');
    ok('GET /me/balance without installId → 400', r.status === 400);

    for (let i = 0; i < 10; i++) await req('POST', '/track/click', { body: { adId: campaignId, installId } });
    r = await req('GET', `/me/balance?installId=${installId}`);
    ok('clicks accrue to the ledger but do NOT change the money (CPM pays on impressions)',
      r.json.clicks === 10 && r.json.accruedUSD === 4.8, JSON.stringify(r.json));

    // ---- revenue pools in admin stats ----
    r = await req('GET', '/admin/stats', { token: ADMIN });
    const rev = r.json.revenue;
    ok('admin stats revenue: gross $12.00 → platform $6.00 / users $4.80 / cited $1.20',
      rev.grossSpendUSD === 12 && rev.platformUSD === 6 && rev.usersPoolUSD === 4.8 && rev.citedPoolUSD === 1.2,
      JSON.stringify(rev));
    ok('users pool fully attributed to the one install id ($4.80 attributed, $0 unattributed)',
      rev.usersAttributedUSD === 4.8 && rev.usersUnattributedUSD === 0 &&
      rev.installs.length === 1 && rev.installs[0].installId === installId && rev.installs[0].accruedUSD === 4.8);
    ok('cited pool honestly labelled undistributed', /undistributed/i.test(rev.citedPoolStatus));
    ok('per-platform aggregate recorded (chatgpt.com = 1000 impressions)',
      r.json.platforms['chatgpt.com'] && r.json.platforms['chatgpt.com'].impressions === 1000);
    const campStats = r.json.ads.find((a) => a.id === campaignId);
    ok('campaign stats: 1000 impressions, 10 clicks, spend $12.00 of $50 budget',
      campStats.impressions === 1000 && campStats.clicks === 10 && campStats.spendUSD === 12 && campStats.budgetRemainingUSD === 38,
      JSON.stringify(campStats));

    // ---- house ads do not accrue earnings ----
    const houseId = 'house_reviewguard';
    r = await req('POST', '/track/impression', { body: { adId: houseId, installId } });
    ok('house-ad impression → 204', r.status === 204);
    r = await req('GET', `/me/balance?installId=${installId}`);
    ok('house-ad impression does NOT accrue user earnings (no advertiser revenue behind it)',
      r.json.impressions === 1000 && r.json.accruedUSD === 4.8);

    r = await req('POST', '/track/impression', { body: { adId: 'cmp_doesnotexist' } });
    ok('tracking an unknown adId → 400', r.status === 400);

    // ---- budget exhaustion → auto-pause ----
    await fireImpressions(campaignId, 3167); // 1000 + 3167 = 4167 total = $50.00 spend
    r = await req('GET', '/ads.json');
    ok('campaign auto-pauses at budget: gone from feed at 4167 impressions ($50.00 spent)',
      !r.json.some((a) => a.id === campaignId));
    r = await req('GET', '/admin/campaigns', { token: ADMIN });
    const exhausted = r.json.campaigns.find((c) => c.id === campaignId);
    ok('admin view shows spend $50.00, remaining $0, live=false',
      exhausted.spendUSD === 50 && exhausted.budgetRemainingUSD === 0 && exhausted.live === false,
      JSON.stringify(exhausted));

    // ---- reject path ----
    r = await req('POST', '/campaigns', { body: { ...campaignPayload, advertiserName: 'Spammy', email: 'spam@example.com', title: 'Spammy miracle pills', url: 'https://spammy.example' } });
    const spamId = r.json.id;
    ok('second campaign submitted pending', r.status === 201 && !!spamId);
    r = await req('POST', `/admin/campaigns/${spamId}/reject`, { token: ADMIN, body: { note: 'Not a fit' } });
    ok('reject → 200 rejected', r.status === 200 && r.json.campaign.status === 'rejected');
    r = await req('GET', '/ads.json');
    ok('rejected campaign never enters the feed', !r.json.some((a) => a.id === spamId));
    r = await req('POST', `/admin/campaigns/${spamId}/approve`, { token: ADMIN, body: {} });
    ok('approving an already-rejected campaign → 409', r.status === 409);

    // ---- network ads CRUD ----
    r = await req('POST', '/admin/network-ads', { body: { network: 'Adsterra', title: 'Net Ad', body: 'A network creative body text.', url: 'https://network.example/landing', cta: 'Open' } });
    ok('POST /admin/network-ads without token → 401', r.status === 401);

    r = await req('POST', '/admin/network-ads', { token: ADMIN, body: { network: 'Adsterra', title: 'Broken', body: 'A network creative body text.', url: 'notaurl', cta: 'Open' } });
    ok('POST /admin/network-ads bad URL → 400', r.status === 400);

    r = await req('POST', '/admin/network-ads', {
      token: ADMIN,
      body: {
        network: 'Adsterra',
        title: 'Adsterra placement — dev tools weekly',
        body: 'A managed network creative served as data only, reviewed by the operator.',
        url: 'https://network.example/landing',
        cta: 'Learn more',
        imageUrl: 'https://network.example/banner.png',
      },
    });
    ok('POST /admin/network-ads valid → 201', r.status === 201 && r.json.networkAd.network === 'Adsterra', r.text);
    const netId = r.json.networkAd.id;

    r = await req('GET', '/network-ads.json');
    const netFeedAd = r.json.find((a) => a.id === netId);
    ok('network creative appears in /network-ads.json with the network field',
      !!netFeedAd && netFeedAd.network === 'Adsterra' && netFeedAd.imageUrl === 'https://network.example/banner.png',
      JSON.stringify(r.json));

    r = await req('GET', '/admin/network-ads', { token: ADMIN });
    ok('GET /admin/network-ads lists the creative', r.status === 200 && r.json.networkAds.some((a) => a.id === netId));

    r = await req('DELETE', `/admin/network-ads/${netId}`, { token: ADMIN });
    ok('DELETE /admin/network-ads/:id → 200 removed', r.status === 200 && r.json.removed === true);
    r = await req('GET', '/network-ads.json');
    ok('deleted creative is gone from /network-ads.json', !r.json.some((a) => a.id === netId));
    r = await req('DELETE', `/admin/network-ads/${netId}`, { token: ADMIN });
    ok('DELETE again → 404', r.status === 404);

    // ---- audit trail ----
    const log = fs.readFileSync(path.join(DATA_DIR, 'notifications.log'), 'utf8');
    ok('notifications.log recorded submission, approval, exhaustion, network add/remove',
      /campaign\.submitted/.test(log) && /campaign\.approved/.test(log) &&
      /campaign\.exhausted/.test(log) && /network_ad\.added/.test(log) && /network_ad\.removed/.test(log));

    console.log(`e2e: ${passed} checks passed`);
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err.message);
  process.exit(1);
});
