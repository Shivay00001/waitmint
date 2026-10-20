'use strict';

/**
 * WaitMint pricing — deliberately simple and public.
 *
 * Every approved campaign is billed at a FLAT CPM of $12:
 *   spend (USD) = impressions / 1000 * 12
 *
 * Rationale: WaitMint's inventory is the "thinking" pause inside premium AI
 * chat products. The audience is AI power users (developers, researchers,
 * founders) in a high-attention, uncluttered slot — one card, no competing
 * banners. $12 CPM is the founding rate shown on the advertiser page; it is
 * the same number advertisers see before they submit, and the same number
 * the admin stats use. No hidden fees, no auction, no dynamic pricing.
 *
 * A campaign auto-pauses (drops out of the feed) the moment its accrued
 * spend reaches its budget. Advertisers can never be charged past budget
 * by this system because delivery stops at the budget line.
 */

const CPM_USD = 12;
const MIN_BUDGET_USD = 50;
const MAX_BUDGET_USD = 100000;

/**
 * Revenue split — where each advertiser dollar goes. CONFIG: change the
 * three numbers here and nowhere else; every pool figure in the admin
 * stats, the user balance endpoint and the docs derives from these.
 *
 *   platform 50% — WaitMint's share (hosting, review, development).
 *   users    40% — shared with the people who saw the card, accrued per
 *                  impression to their anonymous install id.
 *   cited    10% — the sources/content the AI answers drew on. In v1 this
 *                  accrues into a platform-level pool, honestly labelled
 *                  "cited pool (undistributed)": attributing an impression
 *                  to specific cited pages is phase-2 work.
 *
 * The split applies to REVENUE DISTRIBUTION only. Advertisers always burn
 * budget at the gross $12 CPM above.
 */
const REVENUE_SPLIT = { platform: 50, users: 40, cited: 10 };

/** Users start becoming eligible for a (manual, v1) payout at this balance. */
const PAYOUT_THRESHOLD_USD = 10;

/** Accrued spend in USD for a given impression count, rounded to cents. */
function spendForImpressions(impressions) {
  const n = Number(impressions);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / 1000) * CPM_USD * 100) / 100;
}

/** True when a campaign has spent its full budget and must stop serving. */
function isExhausted(budgetUSD, impressions) {
  return spendForImpressions(impressions) >= Number(budgetUSD);
}

/** Impressions remaining before the budget is exhausted (never negative). */
function impressionsRemaining(budgetUSD, impressions) {
  const left = Math.floor((Number(budgetUSD) / CPM_USD) * 1000) - Number(impressions || 0);
  return Math.max(0, left);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** USD a single paid impression pays into the users' pool. */
function userSharePerImpression() {
  return (CPM_USD / 1000) * (REVENUE_SPLIT.users / 100);
}

/**
 * Split the gross revenue of `impressions` paid-campaign impressions into
 * the three pools. Example: 1000 impressions → gross $12.00 →
 * platform $4.80, users $1.20, cited $6.00.
 */
function splitForImpressions(impressions) {
  const grossUSD = spendForImpressions(impressions);
  return {
    grossUSD,
    platformUSD: round2(grossUSD * (REVENUE_SPLIT.platform / 100)),
    usersUSD: round2(grossUSD * (REVENUE_SPLIT.users / 100)),
    citedUSD: round2(grossUSD * (REVENUE_SPLIT.cited / 100)),
  };
}

/** Accrued user balance for one install id, from its paid impressions. */
function accruedForInstall(impressions) {
  const n = Number(impressions);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * userSharePerImpression() * 10000) / 10000;
}

module.exports = {
  CPM_USD,
  MIN_BUDGET_USD,
  MAX_BUDGET_USD,
  REVENUE_SPLIT,
  PAYOUT_THRESHOLD_USD,
  spendForImpressions,
  isExhausted,
  impressionsRemaining,
  splitForImpressions,
  userSharePerImpression,
  accruedForInstall,
};
