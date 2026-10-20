'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON-file store.
 *
 * Data model:
 *   {
 *     campaigns: [ {id, advertiserName, email, title, body, url, cta,
 *                   budgetUSD, targetPlatforms, status, createdAt,
 *                   reviewedAt, reviewNote, exhaustedNotified} ],
 *     networkAds: [ {id, network, title, body, url, cta, imageUrl,
 *                    createdAt} ],
 *     stats: { [adId]: { impressions: n, clicks: n } },
 *     earnings: { installs: { [installId]: { impressions: n, clicks: n,
 *                     firstSeen, lastSeen } } }
 *   }
 *
 * The earnings ledger counts PAID-campaign impressions/clicks per
 * anonymous install id only. Balances are derived from those counts with
 * lib/pricing.js — never stored as money — so the math can't drift.
 *
 * All mutations happen in memory; persistence is serialized through a
 * write queue and done atomically (write temp file + rename), so a crash
 * mid-write can never corrupt the store. Stats flushes are debounced so
 * high-frequency tracking calls don't hammer the disk; the queue is also
 * flushed on process shutdown by the server.
 */
class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { campaigns: [], networkAds: [], stats: {}, earnings: { installs: {} }, platformStats: {} };
    this._queue = Promise.resolve();
    this._dirty = false;
    this._flushTimer = null;
  }

  async load() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.campaigns) && parsed.stats) {
        this.data = parsed;
        if (!Array.isArray(this.data.networkAds)) this.data.networkAds = [];
        if (!this.data.earnings || typeof this.data.earnings !== 'object') this.data.earnings = { installs: {} };
        if (!this.data.earnings.installs) this.data.earnings.installs = {};
        if (!this.data.platformStats || typeof this.data.platformStats !== 'object') this.data.platformStats = {};
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this.save();
    }
  }

  save() {
    this._dirty = false;
    const snapshot = JSON.stringify(this.data, null, 2);
    this._queue = this._queue.then(async () => {
      const tmp = this.filePath + '.tmp';
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.promises.writeFile(tmp, snapshot, 'utf8');
      await fs.promises.rename(tmp, this.filePath);
    });
    return this._queue;
  }

  /** Debounced save for high-frequency stat increments. */
  saveSoon(delayMs = 1500) {
    this._dirty = true;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      if (this._dirty) this.save().catch((e) => console.error('[store] save failed:', e.message));
    }, delayMs);
    if (this._flushTimer.unref) this._flushTimer.unref();
  }

  async flush() {
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    if (this._dirty) await this.save();
    await this._queue;
  }

  // ---- campaigns ----

  addCampaign(campaign) {
    this.data.campaigns.push(campaign);
    return this.save().then(() => campaign);
  }

  getCampaign(id) {
    return this.data.campaigns.find((c) => c.id === id) || null;
  }

  listCampaigns() {
    return [...this.data.campaigns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // ---- network ads ----

  addNetworkAd(ad) {
    this.data.networkAds.push(ad);
    return this.save().then(() => ad);
  }

  listNetworkAds() {
    return [...this.data.networkAds].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  removeNetworkAd(id) {
    const idx = this.data.networkAds.findIndex((a) => a.id === id);
    if (idx === -1) return Promise.resolve(false);
    this.data.networkAds.splice(idx, 1);
    return this.save().then(() => true);
  }

  // ---- stats ----

  bump(adId, field) {
    if (!this.data.stats[adId]) this.data.stats[adId] = { impressions: 0, clicks: 0 };
    this.data.stats[adId][field] += 1;
    this.saveSoon();
    return this.data.stats[adId];
  }

  statsFor(adId) {
    return this.data.stats[adId] || { impressions: 0, clicks: 0 };
  }

  allStats() {
    return this.data.stats;
  }

  // ---- earnings ledger (paid campaigns only) ----

  bumpInstall(installId, field) {
    const now = new Date().toISOString();
    let rec = this.data.earnings.installs[installId];
    if (!rec) {
      rec = { impressions: 0, clicks: 0, firstSeen: now, lastSeen: now };
      this.data.earnings.installs[installId] = rec;
    }
    rec[field] += 1;
    rec.lastSeen = now;
    this.saveSoon();
    return rec;
  }

  installRecord(installId) {
    return this.data.earnings.installs[installId] || null;
  }

  allInstalls() {
    return this.data.earnings.installs;
  }

  // ---- per-platform aggregates (host only, no user data) ----

  bumpPlatform(host, field) {
    if (!this.data.platformStats[host]) this.data.platformStats[host] = { impressions: 0, clicks: 0 };
    this.data.platformStats[host][field] += 1;
    this.saveSoon();
  }

  allPlatformStats() {
    return this.data.platformStats || {};
  }
}

module.exports = { Store };
