# SnapAsk · Chrome extension

Part of the [SnapAsk](../README.md) project. **Select anything on screen. Get an answer. Nothing else.**

A Chrome extension that replaces the screenshot → paste-into-ChatGPT → delete-the-image routine with one gesture: press the shortcut, drag over the thing you are unsure about, read the answer in a floating card next to it. Ask follow-ups in the same card.

Works on any page, including paused videos and full-screen players. Uses your own API key (Anthropic, OpenAI, or Gemini). No server, no account, nothing stored.

## Install (unpacked, for now)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension/` folder.
3. The setup page opens. Pick a provider, paste a key, click **Connect**.
4. Pin the SnapAsk icon from the puzzle-piece menu so it is one click away.

Default shortcut: **Alt+Shift+A** (Option+Shift+A on Mac). Change it at `chrome://extensions/shortcuts`.

## Use

| Do this | Result |
|---|---|
| Shortcut with text selected on the page | No screenshot: the selected text is sent as context and the card opens beside it |
| Shortcut | Page dims, cursor becomes a crosshair |
| Click the icon | Popup: a big **Select an area** button plus the everyday settings (provider, key status, model, depth, language) |
| Drag a box | Screenshot of that box only, answer streams in a card beside it |
| Enter instead of dragging | Whole visible screen |
| Esc | Cancel selection, or close the card |
| Type in the card, Enter | Follow-up, with the image still in context |
| Chips: Explain, Translate, Summarize, Fix code, Simplify | One-tap re-ask on the same selection |
| ChatGPT ↗ / Claude ↗ under an answer | Continue in your own ChatGPT or Claude account: the question (and selected text) is prefilled; a screenshot is copied for one ⌘V. The chat then lives in that account's history |
| ⟲ in the card header | Select another area |
| Drag the card header | Move it out of the way |

**Answer modes.** The first question is picked per page: a playing video gets a lecture explanation, code sites (GitHub, Stack Overflow, MDN, …) or a selection inside a code block get *Code*, a page in another language gets *Translate*, everything else *Explain*. Override it for any site from the popup's **This site** row, or set one mode everywhere in All settings. The chips in the card always let you switch.

**Hand-off, not scraping.** The ChatGPT and Claude buttons open the official sites with the prompt prefilled (`chatgpt.com/?q=`, `claude.ai/new?q=`). SnapAsk never automates or reads those sites, which keeps it inside OpenAI's and Anthropic's terms and out of trouble with store review.

**Auto-pause.** A playing `<video>` on the page is paused when you start a selection and resumed when you close the card (or cancel). Turn off in All settings.

The popup covers daily settings; **All settings** (or right-click the icon → Options) opens the full page with API keys, custom model ids, and the shortcut.

## Why people can trust it

- **Permissions:** `activeTab`, `scripting`, `storage` only. SnapAsk runs on a page only after you trigger it, so Chrome never shows the "read and change all your data on all websites" warning.
- **Data path:** the screenshot is cropped in memory inside the extension and sent straight to the provider you chose, over HTTPS. There is no SnapAsk server.
- **Storage:** your API key and preferences, in `chrome.storage.local`. No history, no images, no analytics.
- **Rendering:** model output is HTML-escaped before the lightweight markdown renderer touches it.

## Architecture

```
manifest.json      MV3, on-demand injection (no content_scripts entry)
background.js      service worker: shortcut/icon → inject → captureVisibleTab → crop → stream over a port
content.js         selection overlay + answer card, in a shadow root; re-parents itself into fullscreen elements
lib/providers.js   Anthropic / OpenAI / Gemini request builders + SSE parsers (shared with tests)
lib/modes.js       answer modes, per-site overrides, and page-signal detection (video / code / language)
lib/settings.js    settings schema, merge, system prompt, key-free public view
lib/crop.js        OffscreenCanvas crop; scale derived from bitmap vs viewport (zoom/retina safe)
lib/markdown.js    small safe markdown renderer, tolerant of unterminated code fences while streaming
popup.html/js      toolbar popup: Select-an-area button + quick settings; asks the worker to capture the active tab
options.html/js    onboarding + full settings, auto-saves, "Connect" validates the key with a tiny request
test/unit.test.js  node --test: markdown, provider streams, error mapping, mode detection and resolution
test/*.html        harnesses that run content.js, popup.html and options.html with a fake chrome.* in any browser
```

Model defaults: Claude Opus 5 (Anthropic), GPT-5 (OpenAI), Gemini 2.5 Flash (Google). Any model id can be typed in. For Anthropic, "Depth" maps to the API's `effort` setting; Opus 5 requests also enable the server-side refusal fallback.

## Develop

```bash
node --test test/            # unit tests
python3 -m http.server 8765  # then open http://localhost:8765/test/harness.html
```

After editing, click the reload icon on `chrome://extensions` and reload the page you are testing on.

## Publishing checklist

- Set the repository URL in `options.html` (footer link) and the CI badge in the root README.
- Screenshots and a 1280×800 promo tile for the Web Store listing (the selection overlay and the card make good ones).
- Privacy policy URL: host `../docs/PRIVACY.md`. Listing text and permission justifications: `../docs/STORE_LISTING.md`.
- Bump `version` in `manifest.json`, zip the folder without `test/`, upload to the Chrome Web Store developer dashboard.

## Roadmap

- Voice follow-ups, a re-ask-last-selection shortcut, quiz mode.
- Firefox build (MV3 with `browser.*` polyfill; `captureVisibleTab` and `scripting` are supported).
- Optional local history, off by default.
- Reply voice/language per site, and a "copy as markdown" for code answers.
