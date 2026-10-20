'use strict';

/** Unit tests for the money math: CPM spend, budget exhaustion, revenue split. */

const assert = require('assert');
const pricing = require('../lib/pricing');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log('unit: pricing');

check('CPM is $12, split is 50/40/10, threshold $10', () => {
  assert.strictEqual(pricing.CPM_USD, 12);
  assert.deepStrictEqual(pricing.REVENUE_SPLIT, { platform: 50, users: 40, cited: 10 });
  assert.strictEqual(
    pricing.REVENUE_SPLIT.platform + pricing.REVENUE_SPLIT.users + pricing.REVENUE_SPLIT.cited,
    100
  );
  assert.strictEqual(pricing.PAYOUT_THRESHOLD_USD, 10);
  assert.strictEqual(pricing.MIN_BUDGET_USD, 50);
});

check('spend: 0 impressions = $0', () => {
  assert.strictEqual(pricing.spendForImpressions(0), 0);
});

check('spend: 1000 impressions = $12.00', () => {
  assert.strictEqual(pricing.spendForImpressions(1000), 12);
});

check('spend: 250 impressions = $3.00', () => {
  assert.strictEqual(pricing.spendForImpressions(250), 3);
});

check('exhaustion: $50 budget survives 4166 impressions, dies at 4167', () => {
  assert.strictEqual(pricing.isExhausted(50, 4166), false); // $49.99
  assert.strictEqual(pricing.isExhausted(50, 4167), true); // $50.00
});

check('split: 1000 impressions → gross $12 = platform $6.00 + users $4.80 + cited $1.20', () => {
  const s = pricing.splitForImpressions(1000);
  assert.strictEqual(s.grossUSD, 12);
  assert.strictEqual(s.platformUSD, 6);
  assert.strictEqual(s.usersUSD, 4.8);
  assert.strictEqual(s.citedUSD, 1.2);
  assert.strictEqual(s.platformUSD + s.usersUSD + s.citedUSD, s.grossUSD);
});

check('user accrual: 1 impression = $0.0048; 1000 = $4.80; 2084 = $10.0032 (past payout threshold)', () => {
  assert.strictEqual(pricing.accruedForInstall(1), 0.0048);
  assert.strictEqual(pricing.accruedForInstall(1000), 4.8);
  assert.strictEqual(pricing.accruedForInstall(2084), 10.0032);
  assert.ok(pricing.accruedForInstall(2084) >= pricing.PAYOUT_THRESHOLD_USD);
  assert.strictEqual(pricing.accruedForInstall(0), 0);
});

check('impressionsRemaining: $50 budget, 1000 shown → 3166 left', () => {
  assert.strictEqual(pricing.impressionsRemaining(50, 1000), 3166);
  assert.strictEqual(pricing.impressionsRemaining(50, 999999), 0);
});

console.log(`unit: pricing — ${passed} checks passed`);
