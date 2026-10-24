# SnapAsk · macOS app

Part of the [SnapAsk](../README.md) project.

Press a hotkey, drag a box around anything on your screen (a paused video, a web page, an error, code), and the answer appears in a floating panel. Ask follow-ups in the same panel. The screenshot is deleted the moment it has been sent.

**Before:** screenshot → find the file → copy → switch to the ChatGPT tab → paste → type the question → wait → go back → delete the image. Seven steps and two app switches.

**After:** `⌘⇧A` → drag → read. The panel floats over full-screen video, so you never leave what you were watching.

## How it works

1. A menu-bar app registers a global hotkey (no Accessibility permission needed).
2. The hotkey runs macOS's own region selector (`screencapture -i`). Press **Space** to switch to window mode, **Esc** to cancel.
3. The PNG is loaded into memory and removed from disk.
4. It is sent to Claude with your default question (configurable). Two backends:
   - **Claude Code CLI** (default): uses the `claude` login you already have. No API key.
   - **Claude API**: direct HTTPS call with `ANTHROPIC_API_KEY`; the image never touches disk at all.
5. The answer shows in a floating Liquid Glass panel (macOS 26 `NSGlassEffectView`, vibrancy on older systems) with the crop thumbnail, one-tap chips (Explain, Translate, Summarize, Fix code, Simplify), and a follow-up box. **⏎** asks, **Esc** closes, the copy icon copies the last answer, ⟲ selects another area. Drag anywhere on the panel to move it.

## Build and run

Requires the Xcode Command Line Tools (`xcode-select --install`).

```bash
./build.sh
open build/SnapAsk.app
```

A camera icon appears in the menu bar. Press `⌘⇧A`.

**First run:** macOS asks for **Screen Recording** permission for SnapAsk. Grant it in System Settings → Privacy & Security → Screen Recording, then press the hotkey again. Without it the capture comes back blank.

**Start at login:** copy `build/SnapAsk.app` to `/Applications` and add it under System Settings → General → Login Items.

## Settings

Menu bar icon → **Settings…** (or ⌘, while SnapAsk is frontmost). Everything saves as you change it and applies immediately.

| Setting | Default | Meaning |
|---|---|---|
| Backend | Automatic | Claude Code CLI if installed (uses your Claude login), else the Claude API |
| API key | — | For the API backend. **Connect** runs a one-word round trip to verify |
| API model | Claude Opus 5 | Sonnet 5, Haiku 4.5, or any custom model id |
| Claude Code model | Claude Code default | `opus`, `sonnet`, or `haiku` for the CLI backend |
| Depth | Balanced | Quick / Balanced / Thorough (maps to the API's `effort`) |
| Language | Auto | Answer language, or the language of the content |
| First question | see window | The prompt sent with every new selection |
| Hotkey | `cmd+shift+a` | Modifiers plus a letter, digit, or `f1`–`f12`; re-registered live |
| Pause media | on | If audio is playing when you press the hotkey, SnapAsk presses the system play/pause key, and presses it again when the panel closes. Needs Accessibility access once |
| Open at login | off | Adds SnapAsk to Login Items |

The same values live in `~/.config/snapask/config.json` if you prefer a text editor.

## Privacy notes

- The screenshot file lives for the duration of one request, inside `~/Library/Application Support/SnapAsk/work/` (CLI backend) and is deleted right after. The API backend keeps it in memory only.
- Claude Code saves every conversation transcript (screenshot included) under `~/.claude/projects/`. SnapAsk deletes the previous conversation's transcript whenever you start a new one and when it quits, so at most one is on disk at a time.
- Nothing is sent anywhere except Anthropic's API (directly, or via Claude Code).

## Troubleshooting

- Log: `~/Library/Logs/SnapAsk.log` (menu → *Show log*).
- Design check without a capture: `build/SnapAsk.app/Contents/MacOS/SnapAsk --demo` for the panel, `--demo settings` for the settings window (add `dark` for dark mode; `--snapshot out.png` renders the layout to a file).
- Media pause does nothing: allow SnapAsk under System Settings → Privacy & Security → Accessibility (synthetic key presses are dropped otherwise). `SnapAsk --audio` prints whether anything is playing right now.
- Headless backend test with any PNG:

```bash
build/SnapAsk.app/Contents/MacOS/SnapAsk --test some-image.png
```

- "Hotkey is taken": another app owns that combination. Pick another in Settings.
- Rebuilding the app can make macOS ask for Screen Recording permission again (the ad-hoc signature changes). Re-grant it once.

## Layout

```
snapask/
├── Sources/main.swift   # the whole app: config, backends, markdown rendering, panel, hotkey
├── Info.plist           # LSUIElement = menu-bar only, no Dock icon
├── build.sh             # swiftc → build/SnapAsk.app
└── README.md
```

## Ideas for later

- Streaming answers token by token (`--output-format stream-json` / API SSE).
- Pin the panel, or a history of recent answers.
- A second hotkey that reuses the last screenshot with a typed question instead of the default prompt.
- OCR-only mode (Vision framework) for pasting selected text somewhere without an LLM round trip.
