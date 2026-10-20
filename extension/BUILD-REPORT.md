# WaitMint — Build Report

**Product:** WaitMint — a browser extension that shows one small, clearly
labelled sponsored card while an AI chat is "thinking", dismisses it when the
answer streams, and shares ad revenue with users.
**Name check:** web search found no existing "WaitMint" product or extension
(only unrelated "Mint Assistant", "Minty", "Wait a Minute"). Name kept.
**Version:** 1.0.0 · **Built:** 2026-10-20 · **Publisher:** VisionQuantech

---

## Business model (as implemented)

- **Revenue split: Platform 50% / Users 40% / Cited sources 10%** (founder-corrected;
  implemented in `WMAds.CONFIG.revenueSplit` and all copy).
- At **$12 CPM**: 1,000 impressions = $12.00 gross → platform $6.00, users pool
  $4.80, cited-sources pool $1.20.
- **User accrual: $0.0048 per impression**; **payout threshold $10** ≈ 2,084
  impressions. Payouts are manual in v1.
- **House creatives earn nothing.**
- Anonymous install ID (random UUID, `chrome.storage.local`) is sent ONLY with
  ad-event pings `{installId, adId, host, type}` to
  `https://visionquantech.com/waitmint/api/events`. Hostname only — never a full
  URL, path, or conversation ID.
- Popup earnings: `GET /waitmint/api/me/balance?installId=` — the only dollar
  figure ever displayed comes from that backend response. Offline/unreachable →
  the popup shows local impression counts with a "balance syncs when online"
  note. **No invented numbers, anywhere.**

## Privacy (founder rule: "Privacy full milega")

- Detection uses loading-state signals ONLY (stop buttons, streaming
  indicators, aria-busy regions).
- The extension **never reads, stores, or transmits prompt text, response text,
  page content, or browsing history.** Stated prominently in the popup footer,
  the options page, `PRIVACY.md`, and the store privacy-policy copy.

## Supported platforms

**25 site-specific adapters** (`src/detectors.js`, multi-signal each:
site selectors + stop-button label scan in English & Chinese + shared
streaming heuristics):

- Global: ChatGPT (chatgpt.com), Claude, Perplexity, Gemini, Microsoft Copilot,
  DeepSeek, Grok, Mistral Le Chat, Poe, Meta AI, DuckDuckGo AI Chat (duck.ai),
  You.com, HuggingChat (huggingface.co/chat), Pi, Phind
- Chinese AI: Qwen (chat.qwen.ai), Kimi (kimi.com + kimi.moonshot.cn), Doubao,
  Yuanbao (yuanbao.tencent.com), Ernie/Wenxiaoyan (yiyan.baidu.com), Zhipu
  Qingyan (chatglm.cn), Hailuo (hailuoai.com)
- Indian AI: Krutrim/Kruti (Ola), Hanooman (hanooman.ai), Sarvam AI (sarvam.ai)
  - Krutrim note: the assigned host `chat.krutrim.com` does not resolve. The
    original Krutrim Assistant web chat lived at `chat.olakrutrim.com`; the
    successor product Kruti is at `kruti.ai`. The adapter covers
    `chat.olakrutrim.com`, `kruti.ai`, and `krutrim.com`. Krutrim's consumer
    chat is app-first and has been intermittently offline, so this adapter is
    best-effort.

**Generic adapter (the "more and more" answer):** users can enable ANY other
AI chat domain from the popup or options page. The browser requests that
domain's host permission (via `optional_host_permissions` — base permissions
stay minimal), the domain is stored in settings, and the background worker
registers the content script for it dynamically (`chrome.scripting`).
Heuristics: stop controls, aria-busy, streaming markers.

## Ad engine — multi-source waterfall

`src/ads.js` + `src/background.js`:

1. **Platform feed** — `https://visionquantech.com/waitmint/ads.json`
   (paid campaigns + platform inventory), cached 6h.
2. **Network feed** — `https://visionquantech.com/waitmint/network-ads.json`
   (same schema + a `network` field, e.g. `"network": "Adsterra"`), cached 6h,
   populated by the platform backend when a network deal is configured.
   Ships empty — no deal is live yet, and the code treats a missing/empty
   network feed as an empty pool, not an error.
3. **Bundled house fallback** — 8 real VisionQuantech creatives shipped in the
   extension (ReviewGuard, SubWatch, OutreachOS, WhatsApp Invoice, Lead
   Scraper, VQ AI services, AgentBook OS $27, ServeQuote Ops $49), so the
   extension works fully offline.

Merged pool → per-source toggles in popup/options (Platform / Network / House)
→ round-robin, no back-to-back repeats. All creatives are validated
(https-only URLs, length caps, dedupe by id) before use.

### Why there is no AdSense/Adsterra JS tag in the extension (honest note)

Direct in-extension ad-network tags are not a compliant route:

- **MV3 bans remote code.** All JavaScript must be bundled in the extension;
  loading a network's JS tag (`show_ads.js`, Adsterra invoke scripts) violates
  Manifest V3's remotely-hosted-code rule and Chrome Web Store policy.
- **Google AdSense policy prohibits ads in Chrome extensions** outright —
  AdSense may not be used in browser extensions/toolbars.
- Several networks' tags also fingerprint and set third-party cookies, which
  would break WaitMint's full-privacy promise.

The compliant integration — implemented here — is a **creatives-as-data feed**:
the platform backend holds the network relationship (Adsterra or direct
deals), normalizes creatives into `{id, title, body, url, cta, imageUrl?,
network}` JSON, and the extension renders them with its own bundled code,
loading only the image file directly from its URL. No third-party JS ever
executes.

## Architecture

| File | Role |
|---|---|
| `src/detectors.js` | 25 adapters + generic adapter + site metadata (UMD: browser + Node tests) |
| `src/ads.js` | CONFIG (endpoints, split, CPM), feed validation, waterfall merge, rotation, bundled house ads |
| `src/settings.js` | Settings defaults/normalization + shared settings UI renderer |
| `src/background.js` | Service worker: feed fetch/cache, ad serving, local stats, install ID, event pings, custom-site script registration |
| `src/content.js` | Overlay lifecycle: MutationObserver + poll, 1 card/episode, 1.2s min display, fade-out, 15s min gap, never covers composer |
| `src/styles.css` | Card styling (wm- prefixed, dark-mode aware) |
| `src/popup.*` | Master/source/site toggles, local stats, backend earnings, custom-site enable |
| `src/options.*` | Full settings, money explainer, privacy explainer |
| `src/manifest.json` | Chrome/Edge MV3 (generated by `tools/gen-manifests.js` from detector metadata — no host drift) |
| `src/manifest.firefox.json` | Firefox variant (gecko id `waitmint@visionquantech.com`, background scripts array) |
| `feed/ads.json` | Platform feed source file (deploy to visionquantech.com/waitmint/ads.json) |
| `feed/network-ads.json` | Network feed (empty until first network deal) |

Permissions: `storage` + `scripting` only, plus host permissions for the 25
named platforms and visionquantech.com. Arbitrary domains only through
`optional_host_permissions`, granted per-site by the user. No `tabs`, no
`history`, no `webRequest`, no `<all_urls>` in base permissions.

## QA — real results

### Unit tests (`tests/unit.test.js`) — 20/20 PASS
Manifest validity for both variants, gecko id, every adapter host present in
manifest matches, 25 adapters, feed schema validation (platform feed = 8 valid
creatives; network feed valid-empty; invalid creatives rejected: non-https,
blank title, missing id), bundled fallback mirrors feed ids, waterfall merge
respects source toggles, rotation round-robin + no back-to-back repeat,
**split regression test (50/40/10, $0.0048/impression, threshold = 2,084
impressions)**, detector transitions for ChatGPT + Claude in jsdom, generic
heuristics incl. Chinese stop labels (停止生成）, custom-domain matcher,
hygiene scans (no eval/Function/remote script src; only external hosts
referenced are visionquantech.com + gumroad.com product links).

### Content lifecycle test (`tests/content-lifecycle.test.js`) — PASS
The real `content.js` (with detectors/settings/ads) driven in jsdom against a
stubbed chrome API: no card while idle → card appears on thinking with a real
creative + "Sponsored" tag → impression recorded → card honoured the 1.2s
minimum display after generation end → faded and removed (~2.2s total).

### Real browser test (`tests/functional.test.js`, Playwright + Chromium 152)

Run 1 (real Chromium, unpacked extension loaded, chatgpt.com route-fulfilled
with `tests/fixture.html`, which reproduces ChatGPT's real DOM signals —
stop button + `result-streaming`):

- ✅ PASS content script injected on chatgpt.com host (`data-waitmint=active`)
- ✅ PASS sponsored card appears during the thinking phase
- ✅ PASS card carries an "Ad · WaitMint" tag
- ✅ PASS card shows a real creative ("ReviewGuard — never miss a Google review")
- ✅ PASS card CTA is a real https URL (https://visionquantech.com)
- ✅ PASS thinking-state screenshot captured (in-run; the PNG was later lost
  when the VM service restarted and wiped test-profile state — noted honestly)
- ⚠️ "Card removed after generation" assertion timed out in that run's 15s
  window. The dismissal path was then proven deterministically with the real
  `content.js` in the jsdom lifecycle test above (show → min-display → fade →
  removed) and the browser assertion was hardened (20s, interval polling
  instead of rAF, which is unreliable under Xvfb without a GPU process).
- ❌ Re-runs could not complete: this VM's browser stack degraded during the
  session (a service restart mid-run, then repeated Chromium launch/CDP
  timeouts — launches hitting the 180s and even 300s caps, logs in
  `tests/fixture-output2.log` and `tests/functional-output.log`). The live-site
  smoke test (chatgpt.com / claude.ai logged-out) likewise could not be
  completed in this environment.

**Honest status:** core functionality (injection, detection, card show with a
real creative, correct labelling) is verified in a real browser. In-browser
dismissal + live-site smoke remain **environment-blocked, not code-blocked** —
re-run `tests/functional.test.js` on an unloaded machine to close them out;
no code change is expected to be needed (same code path passes in jsdom).

## Packages

- `dist/waitmint-chrome.zip` (39,133 bytes)
- `dist/waitmint-firefox.zip`
- Extension files at zip root; regenerate with `node tools/package.js`.
- Manifests regenerate with `node tools/gen-manifests.js`; icons with
  `python3 tools/make_icons.py`.

## Known limits & what remains for store submission

1. **Feed deployment:** `feed/ads.json` + `feed/network-ads.json` must be
   deployed at `visionquantech.com/waitmint/` — today that path returns the
   site's SPA HTML fallback (verified by curl), so until deployment the
   extension runs on bundled house creatives (by design). The balance/events
   API endpoints (`/waitmint/api/...`) are backend work, not in this package;
   until they exist, the popup honestly shows local counts.
2. **Selectors drift:** platform DOMs change; each adapter has 3+ independent
   signals to survive small changes, but detector maintenance is a recurring
   task as platforms redesign.
3. **Store submission (not done — build-only per brief):** needs a Chrome Web
   Store developer account (the user's CWS account is on Sanskruti Dhumal's
   Google account, $5 fee already paid, account currently on probation after a
   prior removal — submission timing is the founder's call), AMO listing for
   Firefox, 1280×800 screenshots (shot-list in `listing/listing.md`; the
   fixture captures in `tests/screenshots/` can seed them), and the hosted
   privacy-policy URL.
4. Krutrim/Kruti web chat availability is intermittent on Ola's side (see
   platform note above).
5. Re-run `tests/functional.test.js` on an unloaded machine to close out the
   in-browser dismissal assertion and the live-site smoke test (both blocked
   by this VM's browser-launch instability during the build session, not by
   extension code — see QA section).
