# Chrome Web Store listing

**Name:** SnapAsk — Ask AI about anything on screen

**Summary (132 chars max):** Press a shortcut, drag over any part of a page or video, get an instant answer. Your API key, your data, nothing stored.

**Category:** Productivity

**Description**

Stuck on a step in a lecture video? A line of code? A paragraph in another language? SnapAsk answers it where you are.

• Press Alt+Shift+A, drag a box, read the answer in a card right beside it.
• Highlight text first and SnapAsk sends the text instead of a screenshot.
• Follow up in the same card. One-tap Explain, Translate, Summarize, Code, Simplify.
• Knows the page: lecture mode on videos, code mode on GitHub, translate on foreign pages. Override per site.
• Pauses the video while you read, resumes when you close.
• Uses your own Anthropic, OpenAI or Gemini key. No account, no server, no history, no analytics.
• Prefer your ChatGPT or Claude subscription? One click hands the question off, prefilled.

Only three permissions. SnapAsk runs on a page only when you trigger it, so it never asks to read all your sites.

**Permission justifications (for review)**

- activeTab: capture the visible tab and inject the selection UI only after the user presses the shortcut or clicks the icon.
- scripting: inject the overlay/card script into the active tab on demand; no declared content scripts.
- storage: persist the user's API key and preferences locally.
- Host permissions (api.anthropic.com, api.openai.com, generativelanguage.googleapis.com): send the user's request to the provider they selected.
- Remote code: none. All code is in the package.
- Data use: screenshots/text are sent only to the chosen provider; nothing is collected by the developer.

**Screenshots (1280×800):** `docs/images/card-text.png`, `docs/images/overlay.png`, `docs/images/card-light.png`, `docs/images/popup.png`, `docs/images/options.png`.

**Privacy policy URL:** host `docs/PRIVACY.md` (GitHub Pages or the repo file).

**Single purpose statement:** Lets the user ask an AI about a selected region or text of the current page.
