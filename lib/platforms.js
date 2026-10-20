'use strict';

/**
 * AI chat platforms WaitMint supports (site-specific detectors in the
 * extension). Advertisers may target any subset; "all" means every
 * platform including the generic custom-site mode.
 */
const PLATFORMS = [
  // Global
  'ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'Copilot',
  'DeepSeek', 'Grok', 'Mistral Le Chat', 'Poe', 'Meta AI',
  'Duck.ai', 'You.com', 'HuggingChat', 'Pi', 'Phind',
  // Chinese AI
  'Qwen', 'Kimi', 'Doubao', 'Yuanbao', 'Ernie', 'Zhipu Qingyan', 'Hailuo',
  // Indian AI
  'Krutrim', 'Hanooman', 'Sarvam',
];

module.exports = { PLATFORMS };
