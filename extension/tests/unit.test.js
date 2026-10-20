'use strict';
/*
 * WaitMint unit tests (Node + jsdom). Run: node tests/unit.test.js
 * Covers: manifest validity (both variants), feed schema validation,
 * waterfall merge + rotation rules, and detector show/dismiss behaviour
 * on simulated ChatGPT + Claude DOMs.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const D = require(path.join(SRC, 'detectors.js'));
const A = require(path.join(SRC, 'ads.js'));
const S = require(path.join(SRC, 'settings.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS', name); }
  catch (e) { failed++; console.log('  FAIL', name, '—', e.message); }
}

function doc(html, url) {
  return new JSDOM(html, { url }).window.document;
}

/* ------------------------------ manifests ------------------------------ */
console.log('manifests');
for (const f of ['manifest.json', 'manifest.firefox.json']) {
  test(f + ' parses as JSON and is MV3', () => {
    const m = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
    assert.strictEqual(m.manifest_version, 3);
    assert.ok(m.content_scripts[0].matches.length >= 25, 'host matches present');
    assert.ok(m.permissions.includes('storage'));
    assert.ok(!m.permissions.includes('tabs'), 'no tabs permission');
    assert.ok(!m.permissions.includes('history'), 'no history permission');
    assert.ok(!m.permissions.includes('webRequest'), 'no webRequest permission');
    assert.ok(m.optional_host_permissions && m.optional_host_permissions.length === 1,
      'arbitrary hosts only via optional permissions');
  });
}
test('firefox manifest has gecko id', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.firefox.json'), 'utf8'));
  assert.strictEqual(m.browser_specific_settings.gecko.id, 'waitmint@visionquantech.com');
  assert.ok(Array.isArray(m.background.scripts), 'firefox uses background scripts array');
});
test('chrome manifest background is a service worker', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.background.service_worker, 'background.js');
});
test('every adapter host appears in manifest matches', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const all = m.content_scripts[0].matches.join(' ');
  for (const site of D.SITES) for (const h of site.hosts) {
    assert.ok(all.includes(`*://${h}/*`), 'missing match for ' + h);
  }
});
test('25 site-specific adapters registered', () => {
  assert.strictEqual(D.SITES.length, 25, 'expected 25, got ' + D.SITES.length);
});

/* -------------------------------- feeds -------------------------------- */
console.log('feeds');
test('platform feed ads.json validates against schema', () => {
  const feedDoc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'feed', 'ads.json'), 'utf8'));
  const ads = A.validateFeed(feedDoc, 'platform');
  assert.strictEqual(ads.length, 8);
  for (const ad of ads) {
    assert.ok(ad.title && ad.body && /^https:\/\//.test(ad.url) && ad.cta, 'creative complete: ' + ad.id);
  }
});
test('network feed validates (empty until a deal is configured)', () => {
  const feedDoc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'feed', 'network-ads.json'), 'utf8'));
  assert.deepStrictEqual(A.validateFeed(feedDoc, 'network'), []);
});
test('bundled fallback mirrors the platform feed ids', () => {
  const feedDoc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'feed', 'ads.json'), 'utf8'));
  const feedIds = A.validateFeed(feedDoc, 'house').map(a => a.id).sort();
  const bundledIds = A.FALLBACK_ADS.map(a => a.id).sort();
  assert.deepStrictEqual(bundledIds, feedIds);
});
test('invalid creatives are rejected', () => {
  assert.strictEqual(A.validateCreative({ id: 'x', title: 't', body: 'b', url: 'http://insecure.example' }), null);
  assert.strictEqual(A.validateCreative({ id: 'x', title: '', body: 'b', url: 'https://ok.example' }), null);
  assert.strictEqual(A.validateCreative({ title: 't', body: 'b', url: 'https://ok.example' }), null);
  assert.strictEqual(A.validateCreative(null), null);
  const ok = A.validateCreative({ id: 'x', title: 't', body: 'b', url: 'https://ok.example', network: 'Adsterra' }, 'network');
  assert.strictEqual(ok.network, 'Adsterra');
  assert.strictEqual(ok.source, 'network');
});

/* --------------------------- waterfall/rotation ------------------------ */
console.log('waterfall');
test('mergePools respects per-source toggles', () => {
  const pools = {
    platform: [{ id: 'p1' }],
    network: [{ id: 'n1' }],
    house: [{ id: 'h1' }]
  };
  assert.strictEqual(A.mergePools(pools, { platform: true, network: true, house: true }).length, 3);
  assert.strictEqual(A.mergePools(pools, { platform: true, network: false, house: true }).length, 2);
  assert.strictEqual(A.mergePools(pools, { platform: false, network: false, house: true }).length, 1);
  assert.strictEqual(A.mergePools(pools, { platform: false, network: false, house: false }).length, 0);
});
test('rotation is round-robin with no back-to-back repeat', () => {
  const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  let state = { index: 0, lastId: null };
  const seq = [];
  for (let i = 0; i < 7; i++) {
    const r = A.nextFromPool(pool, state);
    seq.push(r.ad.id);
    state = r.state;
  }
  assert.deepStrictEqual(seq, ['a', 'b', 'c', 'a', 'b', 'c', 'a']);
  const r2 = A.nextFromPool(pool, { index: 0, lastId: 'a' });
  assert.notStrictEqual(r2.ad.id, 'a', 'must skip lastId');
  assert.strictEqual(A.nextFromPool([], { index: 0, lastId: null }).ad, null);
});

/* ---------------------------- business model --------------------------- */
console.log('business model');
test('revenue split is Platform 50 / Users 40 / Cited sources 10', () => {
  assert.deepStrictEqual(A.CONFIG.revenueSplit, { platform: 50, users: 40, citedSources: 10 });
  assert.strictEqual(A.CONFIG.cpmUsd, 12);
  // $12 CPM: 1000 impressions gross $12 -> users pool $4.80 -> $0.0048 each
  const perImpression = (A.CONFIG.cpmUsd / 1000) * (A.CONFIG.revenueSplit.users / 100);
  assert.ok(Math.abs(perImpression - 0.0048) < 1e-12, 'accrual $0.0048/impression');
  assert.ok(Math.abs(A.CONFIG.userAccrualPerImpressionUsd - perImpression) < 1e-12);
  // $10 threshold at ~2084 impressions
  assert.strictEqual(Math.ceil(A.CONFIG.payoutThresholdUsd / perImpression), 2084);
});

/* ------------------------------ detectors ------------------------------ */
console.log('detectors');
test('findAdapter resolves all named hosts', () => {
  assert.strictEqual(D.findAdapter('chatgpt.com').id, 'chatgpt');
  assert.strictEqual(D.findAdapter('claude.ai').id, 'claude');
  assert.strictEqual(D.findAdapter('yuanbao.tencent.com').id, 'yuanbao');
  assert.strictEqual(D.findAdapter('chat.olakrutrim.com').id, 'krutrim');
  assert.strictEqual(D.findAdapter('kruti.ai').id, 'krutrim');
  assert.strictEqual(D.findAdapter('duck.ai').id, 'duckai');
  assert.strictEqual(D.findAdapter('huggingface.co').id, 'huggingchat');
  assert.strictEqual(D.findAdapter('example.com'), null);
});

test('ChatGPT adapter: thinking -> streaming transition', () => {
  const adapter = D.findAdapter('chatgpt.com');
  const idle = doc(`<body><form><div data-testid="composer"><textarea id="prompt-textarea"></textarea></div></form></body>`, 'https://chatgpt.com/');
  assert.strictEqual(adapter.isThinking(idle), false, 'idle page must not be thinking');

  const thinking = doc(`<body><form><div data-testid="composer"><textarea id="prompt-textarea"></textarea>
    <button data-testid="stop-button" aria-label="Stop generating"></button></div></form></body>`, 'https://chatgpt.com/');
  assert.strictEqual(adapter.isThinking(thinking), true, 'stop button = thinking');

  const streaming = doc(`<body><div class="result-streaming">partial answer…</div>
    <form><div data-testid="composer"><textarea id="prompt-textarea"></textarea></div></form></body>`, 'https://chatgpt.com/');
  assert.strictEqual(adapter.isThinking(streaming), true, 'result-streaming still generating');
  assert.ok(adapter.anchor(streaming), 'anchor found (composer)');
});

test('Claude adapter: thinking -> streaming transition', () => {
  const adapter = D.findAdapter('claude.ai');
  const idle = doc(`<body><div contenteditable="true" class="ProseMirror"></div></body>`, 'https://claude.ai/');
  assert.strictEqual(adapter.isThinking(idle), false);
  const thinking = doc(`<body><div contenteditable="true" class="ProseMirror"></div>
    <button aria-label="Stop response"></button></body>`, 'https://claude.ai/');
  assert.strictEqual(adapter.isThinking(thinking), true, 'Stop response button = thinking');
});

test('generic adapter heuristics (custom sites)', () => {
  const g = D.GENERIC_ADAPTER;
  const busy = doc(`<body><div aria-busy="true"></div><textarea></textarea></body>`, 'https://some-ai.example/');
  assert.strictEqual(g.isThinking(busy), true);
  const stopBtn = doc(`<body><button aria-label="Stop generating"></button></body>`, 'https://some-ai.example/');
  assert.strictEqual(g.isThinking(stopBtn), true);
  const zhStop = doc(`<body><button>停止生成</button></body>`, 'https://some-ai.example/');
  assert.strictEqual(g.isThinking(zhStop), true, 'Chinese stop label detected');
  const calm = doc(`<body><p>hello</p><textarea></textarea></body>`, 'https://some-ai.example/');
  assert.strictEqual(g.isThinking(calm), false);
});

test('custom-domain matcher', () => {
  assert.strictEqual(S.domainMatchesCustom('chat.example.com', ['example.com']), true);
  assert.strictEqual(S.domainMatchesCustom('example.com', ['example.com']), true);
  assert.strictEqual(S.domainMatchesCustom('notexample.com', ['example.com']), false);
  assert.strictEqual(S.domainMatchesCustom('example.com.evil.io', ['example.com']), false);
});

/* --------------------------- code hygiene ------------------------------ */
console.log('hygiene');
test('no eval / remote script injection anywhere in src', () => {
  for (const f of fs.readdirSync(SRC).filter(x => x.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.ok(!/\beval\s*\(/.test(code), f + ' uses eval');
    assert.ok(!/new\s+Function\s*\(/.test(code), f + ' uses Function constructor');
    assert.ok(!/\.src\s*=\s*['"]https?:/.test(code), f + ' loads remote script');
  }
});
test('only external data endpoints are the visionquantech feed/api URLs', () => {
  const urls = new Set();
  for (const f of fs.readdirSync(SRC).filter(x => x.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const m of code.matchAll(/https:\/\/[a-z0-9.-]+/gi)) urls.add(m[0]);
  }
  for (const u of urls) {
    assert.ok(u === 'https://visionquantech.com' || u === 'https://gumroad.com',
      'unexpected external host referenced: ' + u);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
