# WaitMint — Store Listing Pack

## Store title
WaitMint — Earn while AI thinks

## Short description (≤132 chars)
A small sponsored card while your AI thinks — you earn a 40% share of the ad revenue. Privacy-first: never reads chats. (121 chars)

## Category suggestion
Productivity (primary) · Tools (secondary)

## Long description

**WaitMint turns AI waiting time into a fair three-way split.**

Every day, millions of people stare at a "Thinking…" spinner while ChatGPT,
Claude, Gemini and other AI assistants generate answers. WaitMint shows one
small, clearly labelled sponsored card during that wait — and dismisses it
the moment the answer starts streaming. The ad revenue doesn't disappear
into a platform: it's split three ways —

- **50% to the platform** — WaitMint / VisionQuantech
- **40% to users** — you, credited against an anonymous install ID ($0.0048 per impression at $12 CPM), payable from a $10 balance (manual payouts in v1)
- **10% to cited sources** — the websites and creators whose content AI answers draw on

### Supported out of the box (site-specific detectors)
ChatGPT · Claude · Perplexity · Gemini · Microsoft Copilot · DeepSeek · Grok ·
Mistral Le Chat · Poe · Meta AI · Qwen (Alibaba) · Kimi (Moonshot) · Doubao
(ByteDance) · Yuanbao (Tencent) · Ernie / Wenxiaoyan (Baidu) · Zhipu Qingyan ·
Hailuo (MiniMax) · Krutrim / Kruti (Ola) · Hanooman · Sarvam AI · DuckDuckGo AI
Chat · You.com · HuggingChat · Pi · Phind

### Any other AI chat site
Enable the built-in generic detector on any domain from the popup or settings —
it recognises stop buttons, streaming indicators and busy states on chat sites
we haven't named yet.

### You are in control
- Master on/off switch, per-site toggles, per-source toggles
- Sources: WaitMint platform campaigns, partner-network creatives, and house promos — pick any mix
- One card max per answer, dismissible with one click, never covers the message box

### Full privacy — by design
WaitMint **never reads, stores or transmits your prompts, the AI's responses,
page content, or your browsing history**. Detection uses loading-state
interface signals only. The only event that leaves your browser contains an
ad ID, the site's hostname, and your anonymous install ID — nothing else.
Stats shown in the popup are counted locally on your device. Your earnings
balance comes from the WaitMint backend; if you're offline, the popup shows
local counts and says so — it never invents a number.

### Honest note on ads
Cards currently feature VisionQuantech products and partner products while
advertiser and ad-network partnerships roll out. Every card is labelled
"Ad" / "Sponsored", always.

## Single-purpose statement (for Chrome Web Store review)
WaitMint has a single purpose: to display a clearly labelled sponsored card
during the loading ("thinking") state of AI chat websites, and to dismiss it
when generation finishes. All requested host permissions are used solely to
detect that loading state on the listed AI chat sites and to fetch the ad
feed from visionquantech.com. Optional host permissions are requested only
when the user explicitly enables a custom site. The extension does not read
or transmit page content, prompts, or responses.

## Screenshot shot-list (1280×800, PNG)
1. ChatGPT mid-generation with the WaitMint card visible (Ad tag readable).
2. The card on Claude during "thinking", showing the close button.
3. Popup open: settings toggles + local stats + earnings line.
4. Options page: ad-source toggles (Platform / Network / House).
5. Options page privacy card: "Full privacy — by design" section.

(Real captures from the fixture test live in tests/screenshots/ —
thinking-card.png and after-dismiss.png — and can seed #1.)
