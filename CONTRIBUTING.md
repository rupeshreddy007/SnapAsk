# Contributing

## Setup

```bash
git clone <this repo> && cd SnapAsk
npm test                         # unit tests (no dependencies to install)
npm run check                    # manifest sanity check
npm run harness                  # then open http://localhost:8765/test/harness.html
```

Load the extension unpacked from `extension/` at `chrome://extensions` (Developer mode → Load unpacked). After edits, click the reload icon there and reload the page you are testing on.

The macOS app builds with `cd macos && ./build.sh` (Xcode Command Line Tools). `SnapAsk --demo` shows the panel without a capture.

## Where things live

| Change | File |
|---|---|
| Add a provider | `extension/lib/providers.js` (request builder + SSE extractor) + a test in `extension/test/unit.test.js` |
| Add an answer mode or detection rule | `extension/lib/modes.js` + tests |
| Change a setting | `extension/lib/settings.js` (schema), `options.js` and `popup.js` (UI) |
| Card or overlay UI | `extension/content.js` (CSS is the string at the top) |
| macOS panel / settings | `macos/Sources/main.swift` |

## Rules of the road

- Keep permissions minimal. The manifest check fails on new permissions, broad host permissions, or a `content_scripts` entry.
- Anything the model returns is untrusted: it goes through `lib/markdown.js`, never raw into `innerHTML`.
- No network calls except to the provider the user chose.
- Every behaviour change gets a unit test if it lives in `lib/`, or a harness scenario if it is UI.
- Regenerate screenshots with `npm run screenshots` when the UI changes.
