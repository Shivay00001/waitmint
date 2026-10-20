# WaitMint — Privacy Policy

_Last updated: 2026-10-20 · Publisher: VisionQuantech_

## The short version

**Full privacy.** WaitMint never reads, stores, or transmits your prompts, the
AI's responses, page content, or your browsing history. It detects one thing
only: whether an AI chat page is in a "thinking / generating" loading state.
When it is, WaitMint shows a clearly labelled sponsored card; when the answer
starts streaming, the card goes away.

## What WaitMint detects

Detection uses loading-state signals in the page's interface chrome only:
stop/generating buttons, streaming indicators, and busy (aria-busy) regions.
WaitMint does **not** inspect the text you type, the text the AI returns, or
any other page content for any purpose.

## What data leaves your browser

Exactly one kind of event, sent to the WaitMint platform backend
(`visionquantech.com`) when a sponsored card is shown or clicked:

| Field | Example | Why |
|---|---|---|
| `installId` | a random UUID | Anonymous ID generated on first run so the backend can credit your share of ad revenue. Not linked to your name, account, or device identity. |
| `adId` | `house-reviewguard` | Which creative was shown/clicked. |
| `host` | `chatgpt.com` | Hostname only — never a full URL, path, or conversation ID. |
| `type` | `impression` / `click` | Event type. |

Nothing else is transmitted. There is no analytics SDK, no fingerprinting,
no third-party tracker, and no remote JavaScript — creatives are delivered
as data (text, an optional image URL, and a click URL) and rendered by
WaitMint's own bundled code.

## What is stored locally

In your browser's extension storage only:

- Your settings (on/off, per-site and per-source toggles, custom sites).
- Impression/click counters (totals and per-day), so the popup can show your
  activity even while offline.
- Your anonymous install ID.
- A cached copy of the ad feeds (refreshed at most every 6 hours).

Uninstalling WaitMint deletes all of it.

## Earnings

Advertiser revenue is split: **50% to the platform, 40% to users,
10% to cited sources**. Your 40%-share balance is computed by the platform backend
from the anonymous ad events above and shown in the popup. Payouts in v1 are
manual, from a $10 balance. If the backend is unreachable, the popup shows
your local impression count and says the balance syncs when online — it never
invents a dollar figure.

## Contact

VisionQuantech — https://visionquantech.com
