# SnapAsk privacy policy

Last updated: 2026-10-24

SnapAsk is a browser extension and a macOS app that send a region of your screen, or text you selected, to an AI provider you choose, and show the answer.

## What SnapAsk collects

Nothing. SnapAsk has no server, no account system, no analytics, and no crash reporting.

## What SnapAsk sends, and where

When you trigger it, SnapAsk sends the selected screenshot or text, the page title and hostname, your browser language, and your question to **one** of these, according to your settings: Anthropic (api.anthropic.com), OpenAI (api.openai.com), or Google (generativelanguage.googleapis.com). Nothing is sent anywhere else, and nothing is sent until you trigger it.

The macOS app can alternatively use the Claude Code command-line tool installed on your Mac, which uses your own Claude login.

Each provider's handling of that data is governed by that provider's policy and your agreement with them.

## What SnapAsk stores on your device

- Your API keys and preferences, in the browser's local extension storage (not synced) or in `~/.config/snapask/config.json` on macOS.
- Nothing else. Screenshots are kept in memory for the duration of one conversation and discarded. The macOS app writes the screenshot to a private folder only while the request is in flight and deletes it immediately after; it also deletes the previous conversation transcript created by the Claude Code tool when a new conversation starts.

## Permissions (extension)

- `activeTab`: capture and interact with the tab you triggered SnapAsk on, only after you trigger it.
- `scripting`: inject the selection overlay into that tab at that moment.
- `storage`: save your settings locally.
- Host access to the three provider API domains above, to send your request.

## Your choices

Remove the extension or app to delete all stored settings. Keys can be removed at any time from the settings page.

## Contact

Open an issue in the project repository.
