/*
 * WaitMint — shared settings: defaults + UI renderer for popup/options.
 * Settings live in chrome.storage.sync under the key "settings".
 */
(function (root) {
  'use strict';

  var DEFAULT_SETTINGS = {
    enabled: true,
    sites: {}, // id -> bool (missing = enabled)
    sources: { platform: true, network: true, house: true },
    customSites: [] // list of registrable domains the user enabled generic detection on
  };

  function normalize(raw, sitesMeta) {
    var s = {
      enabled: !raw || raw.enabled !== false,
      sites: (raw && raw.sites) || {},
      sources: Object.assign({}, DEFAULT_SETTINGS.sources, (raw && raw.sources) || {}),
      customSites: (raw && Array.isArray(raw.customSites)) ? raw.customSites.slice() : []
    };
    if (sitesMeta) {
      sitesMeta.forEach(function (m) {
        if (typeof s.sites[m.id] !== 'boolean') s.sites[m.id] = true;
      });
    }
    return s;
  }

  function siteEnabled(settings, id) {
    return settings.enabled !== false && settings.sites[id] !== false;
  }

  function domainMatchesCustom(hostname, customSites) {
    hostname = (hostname || '').toLowerCase();
    for (var i = 0; i < (customSites || []).length; i++) {
      var d = customSites[i].toLowerCase();
      if (hostname === d || hostname.slice(-(d.length + 1)) === '.' + d) return true;
    }
    return false;
  }

  /* Renders master toggle, source toggles and per-site toggles into a
   * container element. onChange(settings) is called after every change. */
  function renderSettingsUI(container, settings, sitesMeta, onChange) {
    container.innerHTML = '';

    function row(labelText, checked, onToggle, cls) {
      var label = document.createElement('label');
      label.className = 'wm-set-row' + (cls ? ' ' + cls : '');
      var span = document.createElement('span');
      span.textContent = labelText;
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!checked;
      input.addEventListener('change', function () { onToggle(input.checked); });
      label.appendChild(span);
      label.appendChild(input);
      return label;
    }

    var h1 = document.createElement('h3');
    h1.textContent = 'WaitMint';
    container.appendChild(h1);
    container.appendChild(row('Enable WaitMint', settings.enabled, function (v) {
      settings.enabled = v; onChange(settings);
    }, 'wm-set-master'));

    var h2 = document.createElement('h4');
    h2.textContent = 'Ad sources';
    container.appendChild(h2);
    container.appendChild(row('Platform ads (WaitMint campaigns)', settings.sources.platform, function (v) {
      settings.sources.platform = v; onChange(settings);
    }));
    container.appendChild(row('Network ads (partner networks)', settings.sources.network, function (v) {
      settings.sources.network = v; onChange(settings);
    }));
    container.appendChild(row('House promos (VisionQuantech)', settings.sources.house, function (v) {
      settings.sources.house = v; onChange(settings);
    }));

    var h3 = document.createElement('h4');
    h3.textContent = 'Supported AI sites';
    container.appendChild(h3);
    sitesMeta.forEach(function (m) {
      container.appendChild(row(m.name, settings.sites[m.id] !== false, function (v) {
        settings.sites[m.id] = v; onChange(settings);
      }));
    });
  }

  var api = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    normalize: normalize,
    siteEnabled: siteEnabled,
    domainMatchesCustom: domainMatchesCustom,
    renderSettingsUI: renderSettingsUI
  };
  root.WMSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
