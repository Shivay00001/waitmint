/*
 * WaitMint — content script: overlay lifecycle engine.
 *
 * - Detects the platform adapter for this host (or the generic adapter on
 *   user-enabled custom domains).
 * - Watches for thinking start/end via MutationObserver + interval poll.
 * - Shows at most ONE sponsored card per generation episode, keeps it up
 *   for a minimum of 1.2s once visible, then fades it out when generation
 *   starts streaming / finishes.
 * - Never reads prompt or response content; only loading-state signals.
 */
(function () {
  'use strict';
  if (window.__waitmintLoaded) return;
  window.__waitmintLoaded = true;
  document.documentElement.setAttribute('data-waitmint', 'active');

  var MIN_DISPLAY_MS = 1200;
  var FADE_MS = 350;
  var MIN_GAP_MS = 15000; // minimum gap between two cards in this tab session

  var adapter = WMDetectors.findAdapter(location.hostname);
  var settings = WMSettings.normalize(null, WMDetectors.SITES);
  var isCustomSite = false;

  var overlay = null;
  var overlayShownAt = 0;
  var overlayAdId = null;
  var lastOverlayAt = 0;
  var thinking = false;
  var episodeShown = false;
  var hideTimer = null;
  var fetchingAd = false;

  function enabledHere() {
    if (!settings.enabled) return false;
    if (adapter) return settings.sites[adapter.id] !== false;
    if (isCustomSite) return true;
    return false;
  }

  function loadSettings() {
    chrome.storage.sync.get(['settings'], function (data) {
      settings = WMSettings.normalize(data.settings, WMDetectors.SITES);
      if (!adapter) {
        isCustomSite = WMSettings.domainMatchesCustom(location.hostname, settings.customSites);
      }
      tick();
    });
  }

  function requestAd(cb) {
    var done = false;
    try {
      chrome.runtime.sendMessage({ type: 'WM_GET_AD' }, function (resp) {
        if (done) return; done = true;
        if (resp && resp.ad) cb(resp.ad);
        else cb(pickBundledFallback());
      });
    } catch (e) {
      if (!done) { done = true; cb(pickBundledFallback()); }
    }
    /* If the worker never answers (e.g. asleep mid-restart), fall back. */
    setTimeout(function () {
      if (!done) { done = true; cb(pickBundledFallback()); }
    }, 1200);
  }

  var fallbackIdx = Math.floor(Math.random() * WMAds.FALLBACK_ADS.length);
  function pickBundledFallback() {
    if (!settings.sources.house) return null;
    var ad = WMAds.FALLBACK_ADS[fallbackIdx % WMAds.FALLBACK_ADS.length];
    fallbackIdx++;
    return ad;
  }

  function sourceLabel(ad) {
    if (ad.source === 'network') return 'Ad · ' + (ad.network || 'Partner network');
    if (ad.source === 'house') return 'Sponsored · VisionQuantech';
    return 'Ad · WaitMint';
  }

  function buildOverlay(ad) {
    var card = document.createElement('div');
    card.className = 'wm-card';
    card.setAttribute('role', 'complementary');
    card.setAttribute('aria-label', 'Sponsored card from WaitMint');

    var tag = document.createElement('span');
    tag.className = 'wm-tag';
    tag.textContent = sourceLabel(ad);
    card.appendChild(tag);

    var close = document.createElement('button');
    close.className = 'wm-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss sponsored card');
    close.textContent = '×';
    close.addEventListener('click', function () { dismiss(true); });
    card.appendChild(close);

    if (ad.imageUrl) {
      var img = document.createElement('img');
      img.className = 'wm-img';
      img.alt = '';
      img.src = ad.imageUrl;
      img.addEventListener('error', function () { img.remove(); });
      card.appendChild(img);
    }

    var title = document.createElement('div');
    title.className = 'wm-title';
    title.textContent = ad.title;
    card.appendChild(title);

    var body = document.createElement('div');
    body.className = 'wm-body';
    body.textContent = ad.body;
    card.appendChild(body);

    var cta = document.createElement('a');
    cta.className = 'wm-cta';
    cta.href = ad.url;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer sponsored';
    cta.textContent = ad.cta || 'Learn more';
    cta.addEventListener('click', function () {
      try { chrome.runtime.sendMessage({ type: 'WM_CLICK', adId: ad.id }); } catch (e) {}
    });
    card.appendChild(cta);

    var credit = document.createElement('div');
    credit.className = 'wm-credit';
    credit.textContent = 'Shown by WaitMint while your AI thinks';
    card.appendChild(credit);

    return card;
  }

  function positionOverlay() {
    if (!overlay) return;
    var bottom = 24;
    var active = adapter || WMDetectors.GENERIC_ADAPTER;
    var anchor = null;
    try { anchor = active.anchor(document); } catch (e) {}
    if (anchor && anchor.getBoundingClientRect) {
      var rect = anchor.getBoundingClientRect();
      if (rect && rect.height) bottom = Math.min(window.innerHeight - rect.top + 12, window.innerHeight - 180);
      if (bottom < 24) bottom = 24;
    }
    overlay.style.bottom = bottom + 'px';
  }

  function showOverlay(ad) {
    if (overlay || !ad) return;
    overlay = buildOverlay(ad);
    overlayAdId = ad.id;
    document.body.appendChild(overlay);
    positionOverlay();
    /* force reflow so the enter transition runs */
    void overlay.offsetWidth;
    overlay.classList.add('wm-visible');
    overlayShownAt = Date.now();
    lastOverlayAt = overlayShownAt;
    try { chrome.runtime.sendMessage({ type: 'WM_IMPRESSION', adId: ad.id }); } catch (e) {}
  }

  function dismiss(userInitiated) {
    if (!overlay) return;
    var el = overlay;
    overlay = null;
    overlayAdId = null;
    if (userInitiated) episodeShown = true;
    el.classList.remove('wm-visible');
    el.classList.add('wm-leaving');
    setTimeout(function () { el.remove(); }, FADE_MS);
  }

  function scheduleHide() {
    if (!overlay || hideTimer) return;
    var wait = Math.max(0, MIN_DISPLAY_MS - (Date.now() - overlayShownAt));
    hideTimer = setTimeout(function () {
      hideTimer = null;
      if (!thinking) dismiss(false);
    }, wait);
  }

  function tick() {
    if (!document.body) return;
    var active = adapter || (isCustomSite ? WMDetectors.GENERIC_ADAPTER : null);
    if (!active) return;
    var nowThinking = false;
    try { nowThinking = !!active.isThinking(document); } catch (e) { nowThinking = false; }

    if (nowThinking && !thinking) {
      thinking = true;
      episodeShown = false;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (enabledHere() && !overlay && !fetchingAd && (Date.now() - lastOverlayAt) >= MIN_GAP_MS) {
        fetchingAd = true;
        requestAd(function (ad) {
          fetchingAd = false;
          /* Only show if this generation episode is still in its
           * pre-stream thinking phase and we haven't shown one yet. */
          if (ad && thinking && !episodeShown && !overlay && enabledHere()) {
            episodeShown = true;
            showOverlay(ad);
          }
        });
      }
    } else if (!nowThinking && thinking) {
      thinking = false;
      scheduleHide();
    }
    if (overlay) positionOverlay();
  }

  var debounce = null;
  function scheduleTick() {
    if (debounce) return;
    debounce = setTimeout(function () { debounce = null; tick(); }, 120);
  }

  function start() {
    loadSettings();
    try {
      var observer = new MutationObserver(scheduleTick);
      observer.observe(document.documentElement, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'aria-label', 'disabled', 'data-testid', 'aria-busy', 'data-state', 'data-status']
      });
    } catch (e) { /* interval below still covers us */ }
    setInterval(tick, 700);
    tick();
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync' && changes.settings) {
      settings = WMSettings.normalize(changes.settings.newValue, WMDetectors.SITES);
      if (!enabledHere() && overlay) dismiss(true);
      tick();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
