/*
 * WaitMint — ad source waterfall + creative validation + rotation.
 *
 * Sources (priority order):
 *   (a) "platform" — WaitMint platform feed
 *       https://visionquantech.com/waitmint/ads.json
 *       (paid campaigns + platform house inventory)
 *   (b) "network"  — partner-network creatives feed
 *       https://visionquantech.com/waitmint/network-ads.json
 *       Same schema, plus a "network" field naming the network
 *       (e.g. "Adsterra"). Populated by the platform backend when a
 *       network deal is configured. Creatives are DATA ONLY (text +
 *       image URL + click URL) rendered by WaitMint's own bundled code.
 *       No third-party JavaScript is ever loaded or executed (MV3).
 *   (c) "house"    — bundled fallback creatives shipped in this file.
 *
 * The merged pool is filtered by the user's per-source toggles and served
 * round-robin with no back-to-back repeats.
 */
(function (root) {
  'use strict';

  /* Platform backend configuration. All WaitMint ad delivery and the
   * earnings API hang off this one base URL. */
  var CONFIG = {
    baseUrl: 'https://visionquantech.com/waitmint',
    platformFeed: 'https://visionquantech.com/waitmint/ads.json',
    networkFeed: 'https://visionquantech.com/waitmint/network-ads.json',
    balanceUrl: 'https://visionquantech.com/waitmint/api/me/balance',
    eventsUrl: 'https://visionquantech.com/waitmint/api/events',
    /* Advertiser revenue split, percent: platform / users / cited sources.
     * At a $12 CPM, 1,000 impressions = $12.00 gross -> platform $6.00,
     * users pool $4.80, cited-sources pool $1.20. A user's accrual is
     * $0.0048 per impression, so the $10 payout threshold is reached at
     * ~2,084 impressions. House creatives earn nothing. */
    revenueSplit: { platform: 50, users: 40, citedSources: 10 },
    cpmUsd: 12,
    userAccrualPerImpressionUsd: 0.0048,
    payoutThresholdUsd: 10
  };
  var PLATFORM_FEED_URL = CONFIG.platformFeed;
  var NETWORK_FEED_URL = CONFIG.networkFeed;
  var FEED_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  /* Bundled house creatives — mirror feed/ads.json. These are real
   * VisionQuantech products; they guarantee the extension always has a
   * legitimate card to show even fully offline. */
  var FALLBACK_ADS = [
    { id: 'house-reviewguard', source: 'house', title: 'ReviewGuard — never miss a Google review',
      body: 'Monitor every new review and draft replies with AI. Free to start.',
      url: 'https://visionquantech.com', cta: 'Try free' },
    { id: 'house-subwatch', source: 'house', title: 'SubWatch — stop paying for forgotten subscriptions',
      body: 'Track renewals and get reminded before you are charged again.',
      url: 'https://visionquantech.com', cta: 'Track subs' },
    { id: 'house-outreachos', source: 'house', title: 'OutreachOS — outreach campaigns that track themselves',
      body: 'Plan, send and follow up on outreach from one clean dashboard.',
      url: 'https://visionquantech.com', cta: 'See how' },
    { id: 'house-whatsapp-invoice', source: 'house', title: 'WhatsApp Invoice — bill clients where they already chat',
      body: 'Create and send GST-ready invoices straight from WhatsApp.',
      url: 'https://visionquantech.com', cta: 'Create invoice' },
    { id: 'house-lead-scraper', source: 'house', title: 'Lead Scraper — find local business leads in minutes',
      body: 'Pull verified local leads for your agency or sales pipeline.',
      url: 'https://visionquantech.com', cta: 'Find leads' },
    { id: 'house-services', source: 'house', title: 'VisionQuantech — AI agents & automation for your business',
      body: 'Custom AI chatbots, agents and automation, built and shipped for you.',
      url: 'https://visionquantech.com', cta: 'Book a call' },
    { id: 'house-agentbook', source: 'house', title: 'AgentBook OS — run your agency like an OS ($27)',
      body: 'The complete Notion-free operating system for solo agencies.',
      url: 'https://gumroad.com/l/rrepnz', cta: 'Get it' },
    { id: 'house-servequote', source: 'house', title: 'ServeQuote Ops — quotes that close ($49)',
      body: 'A field-service quoting system that turns estimates into approvals.',
      url: 'https://gumroad.com/l/mahoqw', cta: 'Get it' }
  ];

  function isHttpUrl(u) {
    return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u);
  }

  /* Validate one creative. Returns a normalized creative or null. */
  function validateCreative(raw, expectedSource) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.title !== 'string' || !raw.title.trim()) return null;
    if (typeof raw.body !== 'string' || !raw.body.trim()) return null;
    if (!isHttpUrl(raw.url)) return null;
    var ad = {
      id: raw.id,
      title: raw.title.trim().slice(0, 90),
      body: raw.body.trim().slice(0, 140),
      url: raw.url,
      cta: (typeof raw.cta === 'string' && raw.cta.trim()) ? raw.cta.trim().slice(0, 24) : 'Learn more',
      source: expectedSource || raw.source || 'platform'
    };
    if (typeof raw.imageUrl === 'string' && isHttpUrl(raw.imageUrl)) ad.imageUrl = raw.imageUrl;
    if (typeof raw.network === 'string' && raw.network.trim()) ad.network = raw.network.trim().slice(0, 40);
    return ad;
  }

  /* Validate a whole feed document: {version?, ads:[...]} or a bare array. */
  function validateFeed(doc, expectedSource) {
    var list = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.ads) ? doc.ads : null);
    if (!list) return [];
    var out = [];
    var seen = {};
    list.forEach(function (raw) {
      var ad = validateCreative(raw, expectedSource);
      if (ad && !seen[ad.id]) { seen[ad.id] = true; out.push(ad); }
    });
    return out;
  }

  /* Merge pools by source toggles. Platform + network creatives are
   * deduplicated by id against each other and against house. */
  function mergePools(pools, sourceToggles) {
    var out = [];
    var seen = {};
    function add(list) {
      (list || []).forEach(function (ad) {
        if (ad && !seen[ad.id]) { seen[ad.id] = true; out.push(ad); }
      });
    }
    if (!sourceToggles || sourceToggles.platform !== false) add(pools.platform);
    if (!sourceToggles || sourceToggles.network !== false) add(pools.network);
    if (!sourceToggles || sourceToggles.house !== false) add(pools.house);
    return out;
  }

  /* Round-robin rotator with no back-to-back repeat. State is a plain
   * object so it can persist in chrome.storage: {index, lastId}. */
  function nextFromPool(pool, state) {
    if (!pool || pool.length === 0) return { ad: null, state: state || { index: 0, lastId: null } };
    state = state || { index: 0, lastId: null };
    var idx = ((state.index || 0) % pool.length + pool.length) % pool.length;
    var ad = pool[idx];
    if (pool.length > 1 && ad.id === state.lastId) {
      idx = (idx + 1) % pool.length;
      ad = pool[idx];
    }
    return { ad: ad, state: { index: (idx + 1) % pool.length, lastId: ad.id } };
  }

  var api = {
    CONFIG: CONFIG,
    PLATFORM_FEED_URL: PLATFORM_FEED_URL,
    NETWORK_FEED_URL: NETWORK_FEED_URL,
    FEED_TTL_MS: FEED_TTL_MS,
    FALLBACK_ADS: FALLBACK_ADS,
    validateCreative: validateCreative,
    validateFeed: validateFeed,
    mergePools: mergePools,
    nextFromPool: nextFromPool
  };
  root.WMAds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
