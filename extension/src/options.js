'use strict';
/* WaitMint options page: full settings + custom sites (shared logic with popup). */

var settings = WMSettings.normalize(null, WMDetectors.SITES);

function saveSettings() {
  chrome.storage.sync.set({ settings: settings }, function () {
    chrome.runtime.sendMessage({ type: 'WM_REREGISTER_CUSTOM' });
  });
}

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

document.addEventListener('DOMContentLoaded', function () {
  chrome.storage.sync.get(['settings'], function (data) {
    settings = WMSettings.normalize(data.settings, WMDetectors.SITES);
    WMSettings.renderSettingsUI(document.getElementById('settings'), settings, WMDetectors.SITES, saveSettings);
    renderCustomList();
  });
  document.getElementById('custom-add').addEventListener('click', function () {
    var input = document.getElementById('custom-domain');
    var msg = document.getElementById('custom-msg');
    var domain = normalizeDomain(input.value);
    if (!domain) { msg.textContent = 'Enter a valid domain, e.g. chat.example.com'; return; }
    chrome.permissions.request({ origins: ['*://' + domain + '/*', '*://*.' + domain + '/*'] }, function (granted) {
      if (!granted) { msg.textContent = 'Permission was not granted, so the site was not enabled.'; return; }
      if (settings.customSites.indexOf(domain) === -1) settings.customSites.push(domain);
      input.value = '';
      msg.textContent = 'Enabled on ' + domain + '.';
      saveSettings();
      renderCustomList();
    });
  });
});
