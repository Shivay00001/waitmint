'use strict';

/**
 * WaitMint Ad Platform — backend.
 *
 * Serves the JSON ad feed the WaitMint browser extension consumes, takes
 * advertiser campaign submissions (manual review, pay-on-invoice — there
 * is deliberately NO checkout here), aggregates privacy-respecting
 * impression/click counters, and exposes token-protected admin endpoints.
 *
 * Privacy by design: tracking endpoints store ONLY aggregate counters per
 * ad id, per-platform-host aggregates, and — for the users' revenue share —
 * counts against an anonymous install id (a random UUID the extension
 * generates; it carries no personal data and is tied to nothing else).
 * Never stored, anywhere: prompts, responses, page content, browsing
 * history, IP addresses, or user agents. (IPs are held in memory briefly,
 * solely for rate limiting.)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { Store } = require('./lib/store');
const {
  validateCampaign,
  validateNetworkAd,
  cleanText,
  LIMITS,
  isValidInstallId,
  isValidPlatformHost,
} = require('./lib/validate');
const pricing = require('./lib/pricing');

// ---------------------------------------------------------------- config

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FEED_CACHE_SECONDS = Math.max(0, Number(process.env.FEED_CACHE_SECONDS || 300));

const store = new Store(path.join(DATA_DIR, 'store.json'));
const NOTIFICATIONS_LOG = path.join(DATA_DIR, 'notifications.log');
const HOUSE_ADS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'house-ads.json'), 'utf8')
);
const HOUSE_AD_IDS = new Set(HOUSE_ADS.map((a) => a.id));

// ---------------------------------------------------------------- helpers

function notify(event, details) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...details });
  console.log('[notify]', line);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFile(NOTIFICATIONS_LOG, line + '\n', (err) => {
    if (err) console.error('[notify] failed to append log:', err.message);
  });
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** Public feed shape for a campaign — exactly the fixed extension contract. */
function campaignToFeedAd(c) {
  return { id: c.id, title: c.title, body: c.body, url: c.url, cta: c.cta };
}

/** Public feed shape for a network creative — contract + `network` field. */
function networkAdToFeedAd(a) {
  const ad = { id: a.id, title: a.title, body: a.body, url: a.url, cta: a.cta, network: a.network };
  if (a.imageUrl) ad.imageUrl = a.imageUrl;
  return ad;
}

function isCampaignLive(c) {
  if (c.status !== 'approved') return false;
  const stats = store.statsFor(c.id);
  return !pricing.isExhausted(c.budgetUSD, stats.impressions);
}

function buildAdsFeed() {
  const paid = store.listCampaigns().filter(isCampaignLive).map(campaignToFeedAd);
  return [...paid, ...HOUSE_ADS];
}

function buildNetworkFeed() {
  return store.listNetworkAds().map(networkAdToFeedAd);
}

function knownAdIds() {
  const ids = new Set(HOUSE_AD_IDS);
  for (const c of store.listCampaigns()) ids.add(c.id);
  for (const a of store.listNetworkAds()) ids.add(a.id);
  return ids;
}

// ---------------------------------------------------------------- app

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security headers (helmet-style, hand-rolled — zero extra deps).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

app.use(express.json({ limit: '32kb' }));

// CORS for the public, extension-facing endpoints only. Admin endpoints
// deliberately get no CORS headers — they are token-protected and not
// meant to be called from arbitrary web pages.
const PUBLIC_PATHS = ['/ads.json', '/network-ads.json', '/campaigns', '/track/impression', '/track/click', '/me/balance'];
app.use((req, res, next) => {
  if (PUBLIC_PATHS.includes(req.path)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

// Simple in-memory rate limiter for POST endpoints. IPs live only in
// this Map (memory) and are never written to disk or logs.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: message || 'Too many requests. Please slow down.' });
    }
    next();
  };
}
// Limits are per-IP per minute and env-tunable: many extension users can
// sit behind one NAT address, and the test suite fires thousands of calls.
const submitLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.SUBMIT_RATE_PER_MIN || 5), message: 'Too many submissions. Please wait a minute and try again.' });
const trackLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.TRACK_RATE_PER_MIN || 1200) });
const adminLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.ADMIN_RATE_PER_MIN || 120) });

// ---------------------------------------------------------------- public

app.get('/health', (req, res) => res.json({ ok: true, service: 'waitmint-platform' }));

app.get('/ads.json', (req, res) => {
  const feed = buildAdsFeed();
  const body = JSON.stringify(feed);
  const etag = '"' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 32) + '"';
  res.setHeader('Cache-Control', `public, max-age=${FEED_CACHE_SECONDS}`);
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.sendStatus(304);
  res.type('application/json').send(body);
});

app.get('/network-ads.json', (req, res) => {
  const feed = buildNetworkFeed();
  const body = JSON.stringify(feed);
  const etag = '"' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 32) + '"';
  res.setHeader('Cache-Control', `public, max-age=${FEED_CACHE_SECONDS}`);
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.sendStatus(304);
  res.type('application/json').send(body);
});

app.post('/campaigns', submitLimiter, async (req, res) => {
  const { errors, value } = validateCampaign(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
  const campaign = {
    id: newId('cmp'),
    ...value,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewNote: '',
    exhaustedNotified: false,
  };
  await store.addCampaign(campaign);
  notify('campaign.submitted', {
    id: campaign.id,
    advertiserName: campaign.advertiserName,
    email: campaign.email,
    budgetUSD: campaign.budgetUSD,
    title: campaign.title,
  });
  res.status(201).json({
    id: campaign.id,
    status: campaign.status,
    message:
      'Campaign received and pending manual review. No payment has been taken. ' +
      'If approved, we will email you an invoice with a payment link; the campaign ' +
      'goes live in the feed once that invoice is paid.',
  });
});

function trackHandler(field) {
  return (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const adId = typeof body.adId === 'string' ? body.adId : '';
    if (!adId || !knownAdIds().has(adId)) {
      return res.status(400).json({ error: 'Unknown or missing adId.' });
    }
    store.bump(adId, field);

    // Optional platform host → aggregate-only per-platform counters.
    if (isValidPlatformHost(body.platform)) {
      store.bumpPlatform(body.platform.toLowerCase(), field);
    }

    const campaign = store.getCampaign(adId);
    if (campaign) {
      // Earnings ledger: only PAID-campaign events accrue the users'
      // pool share, and only against a valid anonymous install id.
      // House/network cards earn the viewer nothing — there is no
      // advertiser revenue behind them to split.
      if (isValidInstallId(body.installId)) {
        store.bumpInstall(body.installId, field);
      }
      // One operator notification the first time a paid campaign exhausts.
      if (field === 'impressions' && !campaign.exhaustedNotified) {
        const stats = store.statsFor(adId);
        if (pricing.isExhausted(campaign.budgetUSD, stats.impressions)) {
          campaign.exhaustedNotified = true;
          store.save().catch((e) => console.error('[store] save failed:', e.message));
          notify('campaign.exhausted', { id: adId, impressions: stats.impressions, budgetUSD: campaign.budgetUSD });
        }
      }
    }
    res.sendStatus(204);
  };
}
app.post('/track/impression', trackLimiter, trackHandler('impressions'));
app.post('/track/click', trackLimiter, trackHandler('clicks'));

// A user's own earnings balance, keyed by their anonymous install id.
// Unknown ids return zeros (the extension may ask before its first paid
// impression). Balances accrue per paid impression at the users' share
// of the $12 CPM; payout is manual in v1 once the threshold is reached.
const balanceLimiter = rateLimit({ windowMs: 60_000, max: 300 });
app.get('/me/balance', balanceLimiter, (req, res) => {
  const installId = typeof req.query.installId === 'string' ? req.query.installId : '';
  if (!isValidInstallId(installId)) {
    return res.status(400).json({ error: 'A valid installId is required.' });
  }
  const rec = store.installRecord(installId) || { impressions: 0, clicks: 0 };
  const accruedUSD = pricing.accruedForInstall(rec.impressions);
  res.json({
    installId,
    impressions: rec.impressions,
    clicks: rec.clicks,
    accruedUSD,
    payoutThresholdUSD: pricing.PAYOUT_THRESHOLD_USD,
    payoutReady: accruedUSD >= pricing.PAYOUT_THRESHOLD_USD,
    payoutNote:
      'Payouts are processed manually in v1 once your balance reaches the threshold. ' +
      'There are no instant payouts.',
  });
});

// ---------------------------------------------------------------- admin

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: 'Admin endpoints are disabled (ADMIN_TOKEN is not set).' });
  }
  const provided = req.get('x-admin-token') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid or missing admin token.' });
  }
  next();
}
app.use('/admin', adminLimiter, requireAdmin);

function campaignAdminView(c) {
  const stats = store.statsFor(c.id);
  const spendUSD = pricing.spendForImpressions(stats.impressions);
  return {
    ...c,
    stats,
    spendUSD,
    budgetRemainingUSD: Math.max(0, Math.round((c.budgetUSD - spendUSD) * 100) / 100),
    live: isCampaignLive(c),
  };
}

app.get('/admin/campaigns', (req, res) => {
  res.json({ campaigns: store.listCampaigns().map(campaignAdminView) });
});

async function reviewCampaign(req, res, status) {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  if (campaign.status !== 'pending') {
    return res.status(409).json({ error: `Campaign is already ${campaign.status}.` });
  }
  campaign.status = status;
  campaign.reviewedAt = new Date().toISOString();
  campaign.reviewNote = cleanText(req.body && req.body.note, LIMITS.reviewNote);
  await store.save();
  notify(`campaign.${status}`, { id: campaign.id, advertiserName: campaign.advertiserName });
  res.json({ campaign: campaignAdminView(campaign) });
}
app.post('/admin/campaigns/:id/approve', (req, res) => reviewCampaign(req, res, 'approved'));
app.post('/admin/campaigns/:id/reject', (req, res) => reviewCampaign(req, res, 'rejected'));

// ---- admin: network creatives (operator-registered, data-only) ----

app.get('/admin/network-ads', (req, res) => {
  res.json({ networkAds: store.listNetworkAds() });
});

app.post('/admin/network-ads', async (req, res) => {
  const { errors, value } = validateNetworkAd(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
  const ad = { id: newId('net'), ...value, createdAt: new Date().toISOString() };
  await store.addNetworkAd(ad);
  notify('network_ad.added', { id: ad.id, network: ad.network, title: ad.title });
  res.status(201).json({ networkAd: ad });
});

app.delete('/admin/network-ads/:id', async (req, res) => {
  const removed = await store.removeNetworkAd(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Network ad not found.' });
  notify('network_ad.removed', { id: req.params.id });
  res.json({ removed: true, id: req.params.id });
});

// ---- admin: stats ----

app.get('/admin/stats', (req, res) => {
  const stats = store.allStats();
  const ads = [];
  for (const ad of HOUSE_ADS) {
    const s = stats[ad.id] || { impressions: 0, clicks: 0 };
    ads.push({ id: ad.id, kind: 'house', title: ad.title, ...s, ctr: s.impressions ? +(s.clicks / s.impressions).toFixed(4) : 0 });
  }
  for (const c of store.listCampaigns()) {
    const s = stats[c.id] || { impressions: 0, clicks: 0 };
    const spendUSD = pricing.spendForImpressions(s.impressions);
    ads.push({
      id: c.id,
      kind: 'campaign',
      title: c.title,
      status: c.status,
      live: isCampaignLive(c),
      ...s,
      ctr: s.impressions ? +(s.clicks / s.impressions).toFixed(4) : 0,
      cpmUSD: pricing.CPM_USD,
      budgetUSD: c.budgetUSD,
      spendUSD,
      budgetRemainingUSD: Math.max(0, Math.round((c.budgetUSD - spendUSD) * 100) / 100),
    });
  }
  for (const a of store.listNetworkAds()) {
    const s = stats[a.id] || { impressions: 0, clicks: 0 };
    ads.push({ id: a.id, kind: 'network', network: a.network, title: a.title, ...s, ctr: s.impressions ? +(s.clicks / s.impressions).toFixed(4) : 0 });
  }
  const totals = ads.reduce(
    (acc, a) => ({ impressions: acc.impressions + a.impressions, clicks: acc.clicks + a.clicks }),
    { impressions: 0, clicks: 0 }
  );

  // Revenue split — computed on GROSS paid-campaign revenue only (house
  // and network cards carry no advertiser spend to split).
  const paidImpressions = store
    .listCampaigns()
    .reduce((sum, c) => sum + (stats[c.id] ? stats[c.id].impressions : 0), 0);
  const split = pricing.splitForImpressions(paidImpressions);
  const installs = Object.entries(store.allInstalls())
    .map(([installId, rec]) => ({
      installId,
      impressions: rec.impressions,
      clicks: rec.clicks,
      accruedUSD: pricing.accruedForInstall(rec.impressions),
      payoutReady: pricing.accruedForInstall(rec.impressions) >= pricing.PAYOUT_THRESHOLD_USD,
      firstSeen: rec.firstSeen,
      lastSeen: rec.lastSeen,
    }))
    .sort((a, b) => b.impressions - a.impressions);
  const usersAttributedUSD =
    Math.round(installs.reduce((sum, i) => sum + i.accruedUSD, 0) * 100) / 100;

  res.json({
    cpmUSD: pricing.CPM_USD,
    totals,
    ads,
    platforms: store.allPlatformStats(),
    revenue: {
      splitPercent: pricing.REVENUE_SPLIT,
      paidImpressions,
      grossSpendUSD: split.grossUSD,
      platformUSD: split.platformUSD,
      usersPoolUSD: split.usersUSD,
      usersAttributedUSD,
      usersUnattributedUSD: Math.max(0, Math.round((split.usersUSD - usersAttributedUSD) * 100) / 100),
      citedPoolUSD: split.citedUSD,
      citedPoolStatus: 'cited pool (undistributed) — per-source attribution is phase-2',
      payoutThresholdUSD: pricing.PAYOUT_THRESHOLD_USD,
      installs,
    },
  });
});

// ---------------------------------------------------------------- errors

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ---------------------------------------------------------------- boot

async function main() {
  await store.load();
  const server = app.listen(PORT, () => {
    console.log(`[waitmint] listening on port ${PORT}`);
    console.log(`[waitmint] data dir: ${DATA_DIR}`);
    console.log(`[waitmint] admin endpoints: ${ADMIN_TOKEN ? 'enabled' : 'DISABLED (ADMIN_TOKEN unset)'}`);
    console.log(`[waitmint] house ads loaded: ${HOUSE_ADS.length}`);
  });
  const shutdown = async (signal) => {
    console.log(`[waitmint] ${signal} — flushing store and shutting down`);
    try { await store.flush(); } catch (e) { console.error('[store] flush failed:', e.message); }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[waitmint] failed to start:', err);
  process.exit(1);
});
