'use strict';
/*
 * WaitMint content.js lifecycle test in jsdom with a stubbed chrome API.
 * Simulates: idle -> thinking (stop button appears) -> streaming -> done,
 * and asserts the overlay shows once with a real creative + Ad tag, stays
 * for at least the 1.2s minimum display, then fades and is removed.
 * Run: node tests/content-lifecycle.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
  <div id="thread"></div>
  <form><div data-testid="composer"><textarea id="prompt-textarea"></textarea>
  <span id="actions"><button type="button" id="send-btn">Send</button></span></div></form>
</body></html>`, { url: 'https://chatgpt.com/', runScripts: 'outside-only', pretendToBeVisual: true });

const { window } = dom;

// ---- chrome API stub -------------------------------------------------
const houseAd = {
  id: 'house-reviewguard', source: 'house', title: 'ReviewGuard — never miss a Google review',
  body: 'Monitor every new review and draft replies with AI. Free to start.',
  url: 'https://visionquantech.com', cta: 'Try free'
};
const messages = [];
window.chrome = {
  storage: {
    sync: { get: (keys, cb) => cb({}), set: (obj, cb) => cb && cb() },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    sendMessage: (msg, cb) => {
      messages.push(msg.type);
      if (cb) cb(msg.type === 'WM_GET_AD' ? { ad: houseAd } : undefined);
    }
  }
};

// ---- load the real scripts in manifest order -------------------------
for (const f of ['detectors.js', 'settings.js', 'ads.js', 'content.js']) {
  window.eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const doc = window.document;
  await sleep(300);
  assert.strictEqual(doc.documentElement.getAttribute('data-waitmint'), 'active', 'marker set');
  assert.ok(!doc.querySelector('.wm-card'), 'no card while idle');

  // thinking starts
  const stop = doc.createElement('button');
  stop.setAttribute('data-testid', 'stop-button');
  stop.setAttribute('aria-label', 'Stop generating');
  stop.textContent = 'Stop';
  doc.getElementById('actions').appendChild(stop);
  doc.getElementById('thread').textContent = 'mutation trigger';

  await sleep(900);
  const card = doc.querySelector('.wm-card.wm-visible');
  assert.ok(card, 'card appears during thinking');
  assert.ok(/sponsored/i.test(card.querySelector('.wm-tag').textContent), 'house tag says Sponsored: ' + card.querySelector('.wm-tag').textContent);
  assert.strictEqual(card.querySelector('.wm-title').textContent, houseAd.title, 'real creative rendered');
  assert.ok(messages.includes('WM_IMPRESSION'), 'impression recorded');
  console.log('  PASS card shows during thinking with real creative + Sponsored tag');
  const shownAt = Date.now();

  // streaming starts then completes quickly (< min display window)
  stop.remove();
  await sleep(400);
  assert.ok(doc.querySelector('.wm-card'), 'card still present inside min-display window');

  // after min display (1.2s) + fade, card must be gone
  await sleep(1800);
  assert.ok(!doc.querySelector('.wm-card'), 'card removed after generation end + min display');
  console.log('  PASS min display honoured, then card fades and is removed');
  console.log('  elapsed since show ~' + (Date.now() - shownAt) + 'ms');
  console.log('\ncontent lifecycle: ALL PASS');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
