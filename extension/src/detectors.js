/*
 * WaitMint — per-site "thinking / generating" detectors.
 *
 * Design notes:
 * - Every adapter exposes: id, name, hosts[], isThinking(doc), anchor(doc).
 * - Detection is deliberately multi-signal: site-specific selectors first,
 *   then stop-button label scans (English + Chinese labels), then shared
 *   generic streaming heuristics. A single DOM change on a platform should
 *   not silently kill detection.
 * - NOTHING in this file reads prompt or response text content for tracking;
 *   text is only inspected on buttons/indicators to recognise a "Stop"
 *   control or a "Thinking" status label.
 * - UMD-ish wrapper so the same file runs in content scripts, the popup /
 *   options pages, and Node (unit tests).
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Small DOM helpers (jsdom-compatible, no layout-dependent checks).   */
  /* ------------------------------------------------------------------ */

  function q(doc, sel) {
    try { return doc.querySelector(sel); } catch (e) { return null; }
  }
  function qa(doc, sel) {
    try { return Array.prototype.slice.call(doc.querySelectorAll(sel)); }
    catch (e) { return []; }
  }
  function isShown(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    var style = (el.getAttribute && el.getAttribute('style')) || '';
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return false;
    return true;
  }
  function firstShown(doc, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = q(doc, selectors[i]);
      if (isShown(el)) return el;
    }
    return null;
  }
  function anyShown(doc, selectors) { return !!firstShown(doc, selectors); }

  var STOP_LABELS_EN = [
    'stop generating', 'stop response', 'stop answering', 'stop streaming',
    'stop completion', 'cancel generation', 'stop'
  ];
  var STOP_LABELS_ZH = ['停止生成', '停止回答', '停止输出', '停止'];

  /* Scan buttons / role=button elements for a stop control. Exact-ish label
   * matching: the visible label must start with or equal a needle so random
   * buttons containing the word "stop" deep in a sentence don't false-fire. */
  function findStopButton(doc, extraLabels) {
    var needles = STOP_LABELS_EN.concat(STOP_LABELS_ZH).concat(extraLabels || []);
    var btns = qa(doc, 'button, [role="button"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!isShown(b)) continue;
      var label = ((b.getAttribute && b.getAttribute('aria-label')) || '').trim().toLowerCase();
      var text = (b.textContent || '').trim().toLowerCase();
      for (var j = 0; j < needles.length; j++) {
        var n = needles[j].toLowerCase();
        if (label === n || label.indexOf(n) === 0 || text === n) return b;
      }
    }
    return null;
  }

  /* Shared generic heuristics: aria-busy regions, known streaming class
   * fragments, and explicit "thinking" indicator elements. */
  var GENERIC_SELECTORS = [
    '[data-testid="stop-button"]',
    '[data-testid="stop-generating"]',
    '[class*="result-streaming"]',
    '[class*="is-streaming"]',
    '[class*="streaming-cursor"]',
    '[class*="thinking-indicator"]',
    '[data-state="thinking"]',
    '[data-state="streaming"]',
    '[data-status="streaming"]',
    '[aria-busy="true"]'
  ];
  function genericIsThinking(doc) {
    if (anyShown(doc, GENERIC_SELECTORS)) return true;
    if (findStopButton(doc)) return true;
    return false;
  }

  var COMPOSER_SELECTORS = [
    'form [data-testid="composer"]',
    '[data-testid="composer"]',
    'textarea[data-testid="chat-input"]',
    'textarea[placeholder]',
    'form textarea',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea'
  ];
  function genericAnchor(doc) { return firstShown(doc, COMPOSER_SELECTORS); }

  /* ------------------------------------------------------------------ */
  /* Adapter factory                                                     */
  /* ------------------------------------------------------------------ */

  function makeAdapter(cfg) {
    return {
      id: cfg.id,
      name: cfg.name,
      region: cfg.region || 'global',
      hosts: cfg.hosts,
      siteSpecific: cfg.siteSpecific !== false,
      isThinking: function (doc) {
        if (cfg.thinkingSelectors && anyShown(doc, cfg.thinkingSelectors)) return true;
        if (cfg.stopLabels && findStopButton(doc, cfg.stopLabels)) return true;
        if (cfg.useGeneric !== false && genericIsThinking(doc)) return true;
        return false;
      },
      anchor: function (doc) {
        if (cfg.anchorSelectors) {
          var el = firstShown(doc, cfg.anchorSelectors);
          if (el) return el;
        }
        return genericAnchor(doc);
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Site-specific adapters                                              */
  /* ------------------------------------------------------------------ */

  var ADAPTERS = [
    /* ------------------------- Global flagships ---------------------- */
    makeAdapter({
      id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com'],
      thinkingSelectors: [
        'button[data-testid="stop-button"]',
        '.result-streaming',
        '[data-testid="stop-generating"]'
      ],
      stopLabels: ['stop generating'],
      anchorSelectors: ['#prompt-textarea', 'form [data-testid="composer"]', '[data-testid="composer"]']
    }),
    makeAdapter({
      id: 'claude', name: 'Claude', hosts: ['claude.ai'],
      thinkingSelectors: [
        'button[aria-label="Stop response"]',
        '[data-testid="stop-button"]',
        '.claude-response-streaming'
      ],
      stopLabels: ['stop response'],
      anchorSelectors: ['div[contenteditable="true"].ProseMirror', '[data-testid="chat-input"]']
    }),
    makeAdapter({
      id: 'perplexity', name: 'Perplexity', hosts: ['www.perplexity.ai', 'perplexity.ai'],
      thinkingSelectors: ['[data-testid="stop-button"]', '.animate-pulse.prose'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea[placeholder*="Ask"]', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'],
      thinkingSelectors: [
        'button[aria-label="Stop response"]',
        '.model-response-streaming',
        'mat-icon[data-mat-icon-name="stop"]'
      ],
      stopLabels: ['stop response'],
      anchorSelectors: ['rich-textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'copilot', name: 'Microsoft Copilot', hosts: ['copilot.microsoft.com'],
      thinkingSelectors: ['button[aria-label="Stop generating"]', '[data-testid="stop-button"]'],
      stopLabels: ['stop generating'],
      anchorSelectors: ['textarea[data-testid="chat-input"]', '#userInput', 'textarea']
    }),
    makeAdapter({
      id: 'deepseek', name: 'DeepSeek', hosts: ['chat.deepseek.com'],
      thinkingSelectors: [
        '.ds-thinking', '[class*="thinking"] .ds-markdown',
        'button[aria-label="Stop"]', '[data-testid="stop-button"]'
      ],
      stopLabels: ['stop', '停止生成'],
      anchorSelectors: ['#chat-input', 'textarea']
    }),
    makeAdapter({
      id: 'grok', name: 'Grok', hosts: ['grok.com'],
      thinkingSelectors: ['button[aria-label="Stop generating"]', '[data-testid="stop-button"]'],
      stopLabels: ['stop generating', 'stop'],
      anchorSelectors: ['textarea[data-testid="chat-input"]', 'div[contenteditable="true"]', 'textarea']
    }),
    makeAdapter({
      id: 'mistral', name: 'Mistral Le Chat', hosts: ['chat.mistral.ai'],
      thinkingSelectors: ['button[aria-label="Stop generating"]', '[data-testid="stop-button"]'],
      stopLabels: ['stop generating', 'arrêter'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'poe', name: 'Poe', hosts: ['poe.com'],
      thinkingSelectors: ['button[data-testid="stop-button"]', '[class*="Message_row"] [class*="loading"]'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea[data-testid="chat-input"]', 'textarea']
    }),
    makeAdapter({
      id: 'metaai', name: 'Meta AI', hosts: ['www.meta.ai', 'meta.ai'],
      thinkingSelectors: ['button[aria-label="Stop generating"]', '[data-testid="stop-button"]'],
      stopLabels: ['stop generating'],
      anchorSelectors: ['div[contenteditable="true"]', 'textarea']
    }),

    /* --------------------------- Chinese AI -------------------------- */
    makeAdapter({
      id: 'qwen', name: 'Qwen (通义千问)', region: 'china', hosts: ['chat.qwen.ai'],
      thinkingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="Stop"]', '.response-streaming'],
      stopLabels: ['stop', '停止生成'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'kimi', name: 'Kimi (Moonshot)', region: 'china',
      hosts: ['www.kimi.com', 'kimi.com', 'kimi.moonshot.cn', 'www.kimi.moonshot.cn'],
      thinkingSelectors: ['[data-testid="stop-button"]', '.segment-streaming', 'button[aria-label="停止生成"]'],
      stopLabels: ['stop', '停止生成'],
      anchorSelectors: ['div[contenteditable="true"]', 'textarea']
    }),
    makeAdapter({
      id: 'doubao', name: 'Doubao (豆包)', region: 'china', hosts: ['www.doubao.com', 'doubao.com'],
      thinkingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="停止生成"]', '.streaming-message'],
      stopLabels: ['stop', '停止生成'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'yuanbao', name: 'Yuanbao (腾讯元宝)', region: 'china', hosts: ['yuanbao.tencent.com'],
      thinkingSelectors: ['[data-testid="stop-button"]', '.agent-chat__streaming', 'button[aria-label="停止"]'],
      stopLabels: ['stop', '停止', '停止生成'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'ernie', name: 'Ernie / Wenxiaoyan (文小言)', region: 'china', hosts: ['yiyan.baidu.com'],
      thinkingSelectors: ['[data-testid="stop-button"]', '.yc-thinking', 'button[aria-label="停止生成"]'],
      stopLabels: ['stop', '停止生成'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'chatglm', name: 'Zhipu Qingyan (智谱清言)', region: 'china', hosts: ['chatglm.cn', 'www.chatglm.cn'],
      thinkingSelectors: ['[data-testid="stop-button"]', '.answer-streaming', 'button[aria-label="停止生成"]'],
      stopLabels: ['stop', '停止生成'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'hailuo', name: 'Hailuo (MiniMax)', region: 'china', hosts: ['hailuoai.com', 'www.hailuoai.com'],
      thinkingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="Stop"]', '.streaming'],
      stopLabels: ['stop', '停止生成'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),

    /* ---------------------------- Indian AI -------------------------- */
    makeAdapter({
      id: 'krutrim', name: 'Krutrim / Kruti (Ola)', region: 'india',
      hosts: ['chat.olakrutrim.com', 'kruti.ai', 'www.kruti.ai', 'krutrim.com', 'www.krutrim.com'],
      thinkingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="Stop"]'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'hanooman', name: 'Hanooman', region: 'india', hosts: ['hanooman.ai', 'www.hanooman.ai'],
      thinkingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="Stop"]'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'sarvam', name: 'Sarvam AI', region: 'india', hosts: ['sarvam.ai', 'www.sarvam.ai'],
      thinkingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="Stop"]'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),

    /* -------------------------- More global -------------------------- */
    makeAdapter({
      id: 'duckai', name: 'DuckDuckGo AI Chat', region: 'global', hosts: ['duck.ai'],
      thinkingSelectors: ['button[aria-label="Stop"]', '[data-testid="stop-button"]', '.streaming-response'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'youcom', name: 'You.com', region: 'global', hosts: ['you.com', 'www.you.com'],
      thinkingSelectors: ['[data-testid="stop-button"]', 'button[aria-label="Stop"]'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea[data-testid="chat-input"]', 'textarea']
    }),
    makeAdapter({
      id: 'huggingchat', name: 'HuggingChat', region: 'global', hosts: ['huggingface.co'],
      thinkingSelectors: ['button[aria-label="Stop generating"]', '.animate-pulse'],
      stopLabels: ['stop generating', 'stop'],
      anchorSelectors: ['textarea[placeholder*="Ask"]', 'textarea']
    }),
    makeAdapter({
      id: 'pi', name: 'Pi', region: 'global', hosts: ['pi.ai', 'heypi.com'],
      thinkingSelectors: ['button[aria-label="Stop"]', '[data-testid="stop-button"]'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    }),
    makeAdapter({
      id: 'phind', name: 'Phind', region: 'global', hosts: ['www.phind.com', 'phind.com'],
      thinkingSelectors: ['button[aria-label="Stop"]', '[data-testid="stop-button"]', '.animate-pulse'],
      stopLabels: ['stop'],
      anchorSelectors: ['textarea', 'div[contenteditable="true"]']
    })
  ];

  /* ------------------------------------------------------------------ */
  /* Generic adapter — used for user-enabled custom domains.             */
  /* Heuristics only: stop controls, aria-busy, streaming markers.       */
  /* ------------------------------------------------------------------ */

  var GENERIC_ADAPTER = {
    id: 'generic', name: 'Custom site (generic detection)', siteSpecific: false,
    hosts: [],
    isThinking: function (doc) { return genericIsThinking(doc); },
    anchor: function (doc) { return genericAnchor(doc); }
  };

  function findAdapter(hostname) {
    hostname = (hostname || '').toLowerCase();
    for (var i = 0; i < ADAPTERS.length; i++) {
      if (ADAPTERS[i].hosts.indexOf(hostname) !== -1) return ADAPTERS[i];
    }
    return null;
  }

  var SITES = ADAPTERS.map(function (a) {
    return { id: a.id, name: a.name, region: a.region, hosts: a.hosts.slice() };
  });

  var api = {
    ADAPTERS: ADAPTERS,
    SITES: SITES,
    GENERIC_ADAPTER: GENERIC_ADAPTER,
    findAdapter: findAdapter,
    genericIsThinking: genericIsThinking,
    _helpers: { q: q, qa: qa, isShown: isShown, anyShown: anyShown, findStopButton: findStopButton }
  };

  root.WMDetectors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
