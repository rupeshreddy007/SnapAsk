# Changelog

## 1.0.0 — 2026-10-24

First complete release of both apps.

### Chrome extension
- Shortcut or toolbar popup → drag a region → streamed answer in a floating glass card beside the selection; follow-ups keep the image in context.
- Text-selection mode: highlighted text is sent instead of a screenshot.
- Answer modes per site: lecture / code / translate / explain detected from the page, overridable per hostname from the popup.
- Auto-pause of a playing `<video>` while the card is open.
- Hand-off buttons to ChatGPT and Claude (prefilled prompt, screenshot on the clipboard).
- Three BYOK providers (Anthropic, OpenAI, Gemini) over raw `fetch` + SSE; refusal and HTTP errors humanised.
- One-minute onboarding page with a Connect check; popup for everyday settings.
- Permissions limited to `activeTab`, `scripting`, `storage`; content script injected on demand.

### macOS app
- Global hotkey → system region selector → Liquid Glass answer panel (`NSGlassEffectView`, vibrancy fallback) with chips and follow-ups.
- Backend via the Claude Code CLI (no API key) or the Claude API.
- Glass settings window: backend, key with Connect test, models, depth, language, prompt, hotkey (live), media pause, open at login.
- Media pause via a CoreAudio "is anything playing" check before pressing the play/pause key.
- Screenshot and previous transcript deleted as soon as they are no longer needed.
