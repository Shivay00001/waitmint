/*
 * WaitMint — background service worker.
 * Jobs: fetch + cache the two creative feeds (platform + network),
 * serve the next creative to content scripts (waterfall + rotation),
 * record local impression/click stats, and register the content script
 * on user-enabled custom domains (optional host permissions).
 * No remote code is ever fetched for execution — feeds are JSON data only.
 */
'use strict';

/* Chrome/Edge service worker: pull in the shared modules. Firefox loads
 * the same files via the manifest "background.scripts" array instead. */
if (typeof importScripts === 'function') {
  try { importScripts('ads.js', 'settings.js', 'detectors.js'); } catch (e) { /* already loaded */ }
}

var CACHE_KEYS = { platform: 'feed_platform', network: 'feed_network' };

function storageLocalGet(keys) {
  return new Promise(function (res) { chrome.storage.local.get(keys, res); });
}
function storageLocalSet(obj) {
  return new Promise(function (res) { chrome.storage.local.set(obj, res); });
}
function storageSyncGet(keys) {
  return new Promise(function (res) { chrome.storage.sync.get(keys, res); });
}

async function fetchFeed(url, expectedSource) {
  var resp = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
  if (!resp.ok) throw new Error('feed HTTP ' + resp.status);
  var doc = await resp.json();
  return WMAds.validateFeed(doc, expectedSource);
}

async function getCachedPool(source) {
  var key = CACHE_KEYS[source];
  var url = source === 'platform' ? WMAds.PLATFORM_FEED_URL : WMAds.NETWORK_FEED_URL;
  var data = await storageLocalGet([key]);
  var cached = data[key];
  var now = Date.now();
  if (cached && (now - cached.fetchedAt) < WMAds.FEED_TTL_MS && Array.isArray(cached.ads)) {
    return cached.ads;
  }
  try {
    var ads = await fetchFeed(url, source);
    var entry = { ads: ads, fetchedAt: now };
    var obj = {}; obj[key] = entry;
    await storageLocalSet(obj);
    return ads;
  } catch (e) {
    /* Network feed is optional: an unreachable/missing network feed is an
     * empty pool, not an error state. Same for platform — callers fall
     * back to bundled house creatives. */
    return cached && Array.isArray(cached.ads) ? cached.ads : [];
  }
}

async function getSettings() {
  var data = await storageSyncGet(['settings']);
  return WMSettings.normalize(data.settings, WMDetectors.SITES);
}

async function serveNextAd() {
  var settings = await getSettings();
  var pools = { platform: [], network: [], house: WMAds.FALLBACK_ADS };
  if (settings.sources.platform) pools.platform = await getCachedPool('platform');
  if (settings.sources.network) pools.network = await getCachedPool('network');
  var pool = WMAds.mergePools(pools, settings.sources);
  var data = await storageLocalGet(['rotation']);
  var result = WMAds.nextFromPool(pool, data.rotation);
  await storageLocalSet({ rotation: result.state });
  return result.ad;
}

/* ------------------------------ stats ------------------------------ */

function todayKey() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

async function recordStat(kind) {
  var data = await storageLocalGet(['stats']);
  var stats = data.stats || { totalImp: 0, totalClicks: 0, byDay: {} };
  var key = todayKey();
  if (!stats.byDay[key]) stats.byDay[key] = { imp: 0, clicks: 0 };
  if (kind === 'impression') { stats.totalImp++; stats.byDay[key].imp++; }
  if (kind === 'click') { stats.totalClicks++; stats.byDay[key].clicks++; }
  await storageLocalSet({ stats: stats });
}

/* Extract ONLY the hostname from a tab URL — paths/queries (which could
 * contain conversation IDs) are never sent anywhere. */
function safeHost(url) {
  try { return new URL(url).hostname || null; } catch (e) { return null; }
}

/* --------------------- anonymous install identity -------------------- */

/* A random UUID generated once on first run. It is NOT linked to any
 * account, name, or browsing data. It is sent ONLY with ad-event pings
 * (together with the ad ID and the platform host) so the backend can
 * credit this install's 40% user share of ad revenue. */
function newInstallId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  var buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  var hex = Array.prototype.map.call(buf, function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20);
}

async function getInstallId() {
  var data = await storageLocalGet(['installId']);
  if (data.installId) return data.installId;
  var id = newInstallId();
  await storageLocalSet({ installId: id });
  return id;
}

/* Best-effort event ping to the platform backend. Payload is exactly:
 * {installId, adId, host, type}. No prompt text, no response text, no
 * page content, no full URL, no history — ever. Failures are silent;
 * local stats remain the on-device source of truth. */
async function pingEvent(kind, adId, host) {
  try {
    var installId = await getInstallId();
    await fetch(WMAds.CONFIG.eventsUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installId: installId, adId: adId || null, host: host || null, type: kind })
    });
  } catch (e) { /* offline is fine */ }
}

/* -------------------- custom-domain content scripts ----------------- */

var CUSTOM_SCRIPT_ID = 'waitmint-custom-sites';

async function registerCustomSites() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  var settings = await getSettings();
  var domains = settings.customSites || [];
  try {
    var existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
    if (existing && existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
    }
  } catch (e) { /* not registered yet */ }
  if (!domains.length) return;
  var matches = [];
  domains.forEach(function (d) {
    matches.push('*://' + d + '/*');
    matches.push('*://*.' + d + '/*');
  });
  try {
    await chrome.scripting.registerContentScripts([{
      id: CUSTOM_SCRIPT_ID,
      matches: matches,
      js: ['detectors.js', 'settings.js', 'ads.js', 'content.js'],
      css: ['styles.css'],
      runAt: 'document_idle',
      persistAcrossSessions: true
    }]);
  } catch (e) {
    /* Permission for a domain may have been revoked; registration is
     * retried on next startup/settings change. */
  }
}

/* ------------------------------ messages ---------------------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'WM_GET_AD') {
    serveNextAd().then(function (ad) { sendResponse({ ad: ad }); })
      .catch(function () { sendResponse({ ad: null }); });
    return true; // async
  }
  if (msg.type === 'WM_IMPRESSION') {
    recordStat('impression');
    pingEvent('impression', msg.adId, sender && sender.tab && sender.tab.url
      ? safeHost(sender.tab.url) : null);
    return;
  }
  if (msg.type === 'WM_CLICK') {
    recordStat('click');
    pingEvent('click', msg.adId, sender && sender.tab && sender.tab.url
      ? safeHost(sender.tab.url) : null);
    return;
  }
  if (msg.type === 'WM_REREGISTER_CUSTOM') {
    registerCustomSites().then(function () { sendResponse({ ok: true }); });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(function () { getInstallId(); registerCustomSites(); });
chrome.runtime.onStartup.addListener(function () { registerCustomSites(); });
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'sync' && changes.settings) registerCustomSites();
});
