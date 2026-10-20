'use strict';
/*
 * WaitMint REAL BROWSER functional tests (Playwright + real Chromium +
 * the real unpacked extension). Run under xvfb:
 *   xvfb-run -a node tests/functional.test.js
 *
 * 1) Fixture test: chatgpt.com is route-fulfilled with a local fixture that
 *    reproduces ChatGPT's DOM signals (stop button + result-streaming).
 *    Asserts the sponsored card appears during "thinking" with an Ad tag
 *    and a real creative, and is removed after generation completes.
 * 2) Live smoke test: real chatgpt.com + claude.ai (logged out) load with
 *    the extension — asserts clean injection and zero console errors
 *    originating from WaitMint scripts.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'src');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function record(name, ok, extra) {
  results.push({ name, ok, extra });
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
}

function proxyFromEnv() {
  const raw = process.env.https_proxy || process.env.HTTPS_PROXY;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const p = { server: `${u.protocol}//${u.host}` };
    if (u.username) { p.username = decodeURIComponent(u.username); p.password = decodeURIComponent(u.password); }
    return p;
  } catch (e) { return undefined; }
}

function systemChromePath() {
  const candidates = [process.env.WM_CHROME_PATH, '/opt/meta-chromium/chrome'];
  for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
  return undefined;
}

async function launchWithExtension(userDataDir) {
  const executablePath = systemChromePath();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    timeout: 300000,
    executablePath,
    proxy: proxyFromEnv(),
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--window-size=1280,900'
    ]
  });
  return context;
}

function isWaitMintError(text, location) {
  const loc = (location && location.url) || '';
  return loc.startsWith('chrome-extension://') ||
    /waitmint|content\.js|detectors\.js|background\.js/i.test(text || '');
}

async function fixtureTest() {
  console.log('fixture test (real extension, ChatGPT DOM signals)');
  const context = await launchWithExtension(path.join(__dirname, '.profile-fixture'));
  const errors = [];
  try {
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error' && isWaitMintError(msg.text(), msg.location())) {
        errors.push('console: ' + msg.text());
      }
    });
    page.on('pageerror', (err) => { if (isWaitMintError(String(err))) errors.push('pageerror: ' + err); });

    const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
    await page.route('https://chatgpt.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    await page.goto('https://chatgpt.com/', { waitUntil: 'load', timeout: 30000 });

    const injected = await page.evaluate(() =>
      document.documentElement.getAttribute('data-waitmint'));
    record('content script injected on chatgpt.com host', injected === 'active', 'data-waitmint=' + injected);

    await page.click('#send-btn');

    // Card must appear during the thinking window.
    await page.waitForSelector('.wm-card.wm-visible', { timeout: 9000 });
    record('sponsored card appears during thinking', true);

    const cardInfo = await page.evaluate(() => {
      const card = document.querySelector('.wm-card');
      return {
        tag: card.querySelector('.wm-tag') ? card.querySelector('.wm-tag').textContent : '',
        title: card.querySelector('.wm-title') ? card.querySelector('.wm-title').textContent : '',
        cta: card.querySelector('.wm-cta') ? card.querySelector('.wm-cta').getAttribute('href') : '',
        credit: card.querySelector('.wm-credit') ? card.querySelector('.wm-credit').textContent : ''
      };
    });
    record('card carries an Ad/Sponsored tag', /ad|sponsored/i.test(cardInfo.tag), cardInfo.tag);
    record('card shows a real creative title', cardInfo.title.length > 5, cardInfo.title);
    record('card CTA is a real https URL', /^https:\/\//.test(cardInfo.cta), cardInfo.cta);
    record('card credits WaitMint', /waitmint/i.test(cardInfo.credit));

    await page.screenshot({ path: path.join(SHOTS, 'thinking-card.png') });
    record('screenshot saved: thinking state', fs.existsSync(path.join(SHOTS, 'thinking-card.png')));

    // After generation completes, the card must fade and be removed.
    // (interval polling: rAF is unreliable under Xvfb with no GPU process)
    await page.waitForFunction(() => !document.querySelector('.wm-card'),
      null, { timeout: 20000, polling: 400 });
    record('card removed after generation completes', true);

    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, 'after-dismiss.png') });
    record('screenshot saved: after dismissal', fs.existsSync(path.join(SHOTS, 'after-dismiss.png')));

    record('zero console errors from WaitMint scripts (fixture)', errors.length === 0, errors.join(' | '));
  } catch (e) {
    record('fixture test completed', false, e.message);
    if (errors.length) console.log('   errors:', errors.join(' | '));
    try {
      const dump = await page.evaluate(() => ({
        stopBtn: !!document.querySelector('[data-testid="stop-button"]'),
        streaming: !!document.querySelector('.result-streaming'),
        card: document.querySelector('.wm-card') ? document.querySelector('.wm-card').className : null,
        visibility: document.visibilityState,
        hidden: document.hidden,
        buttons: Array.prototype.map.call(document.querySelectorAll('button'), (b) =>
          (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40))
      }));
      console.log('   STATE DUMP:', JSON.stringify(dump));
    } catch (e2) { console.log('   dump failed:', e2.message); }
  } finally {
    await context.close();
  }
}

async function liveSmokeTest() {
  console.log('live-site smoke test (logged out)');
  const context = await launchWithExtension(path.join(__dirname, '.profile-live'));
  try {
    for (const url of ['https://chatgpt.com/', 'https://claude.ai/']) {
      const page = await context.newPage();
      const errors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isWaitMintError(msg.text(), msg.location())) {
          errors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => { if (isWaitMintError(String(err))) errors.push(String(err)); });
      let injected = null, navError = null;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);
        injected = await page.evaluate(() =>
          document.documentElement.getAttribute('data-waitmint'));
      } catch (e) { navError = e.message; }
      record(`injection on ${url}`, injected === 'active',
        navError ? 'navigation: ' + navError : 'data-waitmint=' + injected);
      record(`zero WaitMint console errors on ${url}`, errors.length === 0, errors.join(' | '));
      await page.close();
    }
  } finally {
    await context.close();
  }
}

(async () => {
  await fixtureTest();
  if (process.env.WM_ONLY === 'fixture') {
    const f = results.filter(r => !r.ok);
    console.log(`\n${results.length - f.length} passed, ${f.length} failed`);
    process.exit(f.length ? 1 : 0);
  }
  await liveSmokeTest();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
