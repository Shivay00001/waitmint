'use strict';

const { PLATFORMS } = require('./platforms');
const { MIN_BUDGET_USD, MAX_BUDGET_USD } = require('./pricing');

/** Limits shared by the API and the advertise-page form. */
const LIMITS = {
  advertiserName: 80,
  title: 80,
  body: 200,
  cta: 24,
  reviewNote: 500,
};

/**
 * Strip anything that could break out of HTML/JSON contexts: angle
 * brackets, quotes are kept (JSON-safe), control characters removed.
 * Feed fields are rendered by the extension as text, but we sanitize at
 * intake anyway — defense in depth.
 */
function cleanText(value, maxLen) {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[<>{}]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLen);
}

function isValidEmail(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function isValidHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * Validate a campaign submission. Returns { errors: [...], value: {...} }.
 * `value` is the sanitized campaign (without id/status/timestamps).
 */
function validateCampaign(input) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  const advertiserName = cleanText(src.advertiserName, LIMITS.advertiserName);
  if (advertiserName.length < 2) errors.push('advertiserName is required (min 2 characters).');

  const email = typeof src.email === 'string' ? src.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) errors.push('A valid email is required.');

  const title = cleanText(src.title, LIMITS.title);
  if (title.length < 3) errors.push('title is required (min 3 characters).');

  const body = cleanText(src.body, LIMITS.body);
  if (body.length < 10) errors.push('body is required (min 10 characters).');

  const url = typeof src.url === 'string' ? src.url.trim() : '';
  if (!isValidHttpUrl(url)) errors.push('url must be a valid http(s) URL.');

  const cta = cleanText(src.cta, LIMITS.cta);
  if (cta.length < 1) errors.push('cta is required.');

  const budgetUSD = Number(src.budgetUSD);
  if (!Number.isFinite(budgetUSD) || budgetUSD < MIN_BUDGET_USD) {
    errors.push(`budgetUSD must be at least $${MIN_BUDGET_USD}.`);
  } else if (budgetUSD > MAX_BUDGET_USD) {
    errors.push(`budgetUSD must be at most $${MAX_BUDGET_USD}.`);
  }

  let targetPlatforms = ['all'];
  if (src.targetPlatforms !== undefined) {
    if (!Array.isArray(src.targetPlatforms) || src.targetPlatforms.length === 0) {
      errors.push('targetPlatforms must be a non-empty array.');
    } else if (src.targetPlatforms.includes('all')) {
      targetPlatforms = ['all'];
    } else {
      const known = src.targetPlatforms.filter((p) => PLATFORMS.includes(p));
      if (known.length !== src.targetPlatforms.length) {
        errors.push('targetPlatforms contains an unknown platform.');
      }
      targetPlatforms = [...new Set(known)];
      if (targetPlatforms.length === 0) errors.push('targetPlatforms must name at least one platform.');
    }
  }

  if (errors.length) return { errors, value: null };
  return {
    errors,
    value: {
      advertiserName,
      email,
      title,
      body,
      url,
      cta,
      budgetUSD: Math.round(budgetUSD * 100) / 100,
      targetPlatforms,
    },
  };
}

/**
 * Validate an operator-registered network creative (admin-only intake).
 * Same creative schema as a campaign, plus the network name. These are
 * creatives the operator registers manually after a network (e.g.
 * Adsterra) approves his account/placement — data-only, never remote JS.
 */
function validateNetworkAd(input) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  const network = cleanText(src.network, 40);
  if (network.length < 2) errors.push('network is required (min 2 characters).');

  const title = cleanText(src.title, LIMITS.title);
  if (title.length < 3) errors.push('title is required (min 3 characters).');

  const body = cleanText(src.body, LIMITS.body);
  if (body.length < 10) errors.push('body is required (min 10 characters).');

  const url = typeof src.url === 'string' ? src.url.trim() : '';
  if (!isValidHttpUrl(url)) errors.push('url must be a valid http(s) URL.');

  const cta = cleanText(src.cta, LIMITS.cta);
  if (cta.length < 1) errors.push('cta is required.');

  let imageUrl = null;
  if (src.imageUrl !== undefined && src.imageUrl !== null && src.imageUrl !== '') {
    const candidate = typeof src.imageUrl === 'string' ? src.imageUrl.trim() : '';
    if (!isValidHttpUrl(candidate)) errors.push('imageUrl must be a valid http(s) URL.');
    else imageUrl = candidate;
  }

  if (errors.length) return { errors, value: null };
  return { errors, value: { network, title, body, url, cta, imageUrl } };
}

/**
 * Anonymous install id: a random UUID generated by the extension. No
 * personal data, no content — just an opaque token so a user can see
 * their own accrued balance. Accept the general UUID/token shape.
 */
function isValidInstallId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(value);
}

/** Platform host token sent with tracking calls, e.g. "chatgpt.com". */
function isValidPlatformHost(value) {
  return typeof value === 'string' && /^[a-z0-9.-]{3,80}$/i.test(value) && value.includes('.');
}

module.exports = {
  LIMITS,
  cleanText,
  isValidEmail,
  isValidHttpUrl,
  validateCampaign,
  validateNetworkAd,
  isValidInstallId,
  isValidPlatformHost,
};
