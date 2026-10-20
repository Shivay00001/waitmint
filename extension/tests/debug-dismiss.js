'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const EXT = path.join(__dirname, '..', 'src');

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

(async () => {
  const context = await chromium.launchPersistentContext(path.join(__dirname, '.profile-debug'), {
    headless: false,
    executablePath: fs.existsSync('/opt/meta-chromium/chrome') ? '/opt/meta-chromium/chrome' : undefined,
    proxy: proxyFromEnv(),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run']
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
  const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
  await page.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await page.goto('https://chatgpt.com/', { waitUntil: 'load' });
  await page.click('#send-btn');
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({
      stop: !!document.querySelector('[data-testid="stop-button"]'),
      streaming: !!document.querySelector('.result-streaming'),
      card: !!document.querySelector('.wm-card'),
      cardVisible: !!document.querySelector('.wm-card.wm-visible'),
      busy: !!document.querySelector('[aria-busy="true"]')
    }));
    console.log(`t=${(i * 0.5).toFixed(1)}s`, JSON.stringify(s));
    if (i > 12 && !s.card) break;
    await page.waitForTimeout(500);
  }
  await context.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
