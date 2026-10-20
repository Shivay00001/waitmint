'use strict';
/* WaitMint popup: settings, local stats, earnings balance, custom sites. */

var settings = WMSettings.normalize(null, WMDetectors.SITES);

function saveSettings() {
  chrome.storage.sync.set({ settings: settings }, function () {
    chrome.runtime.sendMessage({ type: 'WM_REREGISTER_CUSTOM' });
  });
}

function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderStats() {
  chrome.storage.local.get(['stats'], function (data) {
    var stats = data.stats || { totalImp: 0, totalClicks: 0, byDay: {} };
    var today = stats.byDay[todayKey()] || { imp: 0, clicks: 0 };
    document.getElementById('stat-today').textContent = today.imp;
    document.getElementById('stat-total').textContent = stats.totalImp;
    document.getElementById('stat-clicks').textContent = stats.totalClicks;
  });
}

/* Earnings: the ONLY dollar figure ever shown comes from the platform
 * backend for this anonymous install ID. If the backend can't be reached
 * we show local counts and say so — never an invented number. */
function renderEarnings() {
  var line = document.getElementById('earnings-line');
  chrome.storage.local.get(['installId', 'stats'], function (data) {
    var stats = data.stats || { totalImp: 0 };
    var offline = function () {
      line.textContent = stats.totalImp + ' impressions so far on this device. ' +
        'Balance syncs when you are online — no estimate is shown offline.';
    };
    if (!data.installId) { offline(); return; }
    var url = WMAds.CONFIG.balanceUrl + '?installId=' + encodeURIComponent(data.installId);
    fetch(url, { credentials: 'omit' }).then(function (resp) {
      if (!resp.ok) throw new Error('http ' + resp.status);
      return resp.json();
    }).then(function (doc) {
      if (doc && typeof doc.balance === 'number' && isFinite(doc.balance) && doc.balance >= 0) {
        line.textContent = 'Your earnings: $' + doc.balance.toFixed(2) +
          ' (40% share · payout at $10)';
      } else { offline(); }
    }).catch(offline);
  });
}

/* --------------------------- custom sites --------------------------- */

function renderCustomList() {
  var ul = document.getElementById('custom-list');
  ul.innerHTML = '';
  (settings.customSites || []).forEach(function (domain) {
    var li = document.createElement('li');
    var span = document.createElement('span');
    span.textContent = domain;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Remove';
    btn.addEventListener('click', function () {
      settings.customSites = settings.customSites.filter(function (d) { return d !== domain; });
      saveSettings();
      renderCustomList();
    });
    li.appendChild(span);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function normalizeDomain(raw) {
  var d = (raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
  return d;
}

function addCustomSite() {
  var input = document.getElementById('custom-domain');
  var msg = document.getElementById('custom-msg');
  var domain = normalizeDomain(input.value);
  if (!domain) { msg.textContent = 'Enter a valid domain, e.g. chat.example.com'; return; }
  var origins = ['*://' + domain + '/*', '*://*.' + domain + '/*'];
  chrome.permissions.request({ origins: origins }, function (granted) {
    if (!granted) { msg.textContent = 'Permission was not granted, so the site was not enabled.'; return; }
    if (settings.customSites.indexOf(domain) === -1) settings.customSites.push(domain);
    input.value = '';
    msg.textContent = 'Enabled. The generic detector will run on ' + domain + '.';
    saveSettings();
    renderCustomList();
  });
}

/* ------------------------------ init -------------------------------- */

document.addEventListener('DOMContentLoaded', function () {
  chrome.storage.sync.get(['settings'], function (data) {
    settings = WMSettings.normalize(data.settings, WMDetectors.SITES);
    WMSettings.renderSettingsUI(document.getElementById('settings'), settings, WMDetectors.SITES, saveSettings);
    renderCustomList();
  });
  renderStats();
  renderEarnings();
  document.getElementById('custom-add').addEventListener('click', addCustomSite);
  document.getElementById('open-options').addEventListener('click', function (e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
