# Design decisions

Short records of the choices that shaped SnapAsk, with the alternative that was rejected and why.

### 1. `activeTab` and on-demand injection instead of `content_scripts` on `<all_urls>`
A declared content script would run on every page and trigger Chrome's "read and change all your data on all websites" warning, the single biggest reason people abandon an extension install. With `activeTab`, the script is injected only when the user presses the shortcut or the toolbar button, and only into that tab. Cost: a `ping` round trip and a 20 ms injection on first use per page.

### 2. No backend, bring your own key
A proxy server would hide keys and allow a free tier, but it means I hold screenshots of strangers' screens, need abuse controls, and pay inference. "There is no SnapAsk server" is a stronger trust story than any privacy policy, and it is literally true. Keys live in `chrome.storage.local`, deliberately not `sync`, so a key never leaves the machine through Google's sync either.

### 3. Raw `fetch` + hand-written SSE parsing instead of provider SDKs
Manifest V3 service workers have no DOM and a 30 s idle kill; the official SDKs are large and some assume Node. Three providers meant three adapters anyway, so a 200-line `providers.js` with one request builder and one event extractor per provider was smaller, fully unit-testable with canned streams, and has zero dependencies to audit.

### 4. Shadow DOM for the overlay and card
Page CSS must not restyle the card and the card must not leak styles into the page. A closed-over shadow root with `all: initial` on the host does both. The host re-parents itself into `document.fullscreenElement` on `fullscreenchange`, because a fixed element outside the full-screen subtree is invisible over a full-screen video.

### 5. Crop scale from bitmap-vs-viewport ratio, not `devicePixelRatio`
`captureVisibleTab` returns an image whose size depends on zoom, DPR and Chrome version. Dividing bitmap width by `window.innerWidth` gives the real scale in every case; trusting DPR alone was wrong on zoomed pages.

### 6. A 60-line markdown renderer instead of a library
Model output is untrusted. The renderer escapes everything first and then applies a handful of patterns, so the only HTML that reaches `innerHTML` is what the renderer itself emits. It also tolerates an unterminated code fence, which is the normal state while streaming. A full library would need the same escaping audit and a build step.

### 7. Timers, not `requestAnimationFrame`, for the pre-capture wait
The overlay must be gone before the capture. The first version waited two animation frames; in a hidden tab rAF never fires and the capture hung forever. Now it races two frames against a 150 ms timer, and streaming repaints use a 40 ms timer for the same reason.

### 8. Hand-off links to ChatGPT and Claude instead of driving their pages
Users asked for "use my logged-in ChatGPT". Automating chatgpt.com from an extension violates OpenAI's consumer terms, breaks with every UI change, and risks the user's account. The hand-off opens the official site with a prefilled prompt (`?q=`) and puts the screenshot on the clipboard. It gives the synced history people wanted without the liability.

### 9. Mode detection as a pure function with explicit precedence
`resolve(settings, signals)`: site override → user default → detection. Keeping it pure made it trivial to unit-test the precedence and the signals (video playing, code host, language mismatch). The one subtlety: signals are read before the video is paused, otherwise "video playing" is always false.

### 10. Interrupt, don't ignore, a question typed during streaming
The first version silently dropped a follow-up typed while an answer was streaming. Now a new question disconnects the port, finalises what was received, and sends. Users type when they have the thought, not when the model is done.

### 11. macOS: Claude Code CLI as the default backend
Most of the target users already have a Claude login but no API key. `claude -p --output-format json` turns that login into a vision backend with zero setup. Two consequences handled explicitly: sessions are keyed by working directory, so every call uses one stable directory to make `--resume` work; and Claude Code stores transcripts (screenshot included), so the previous conversation's transcript is deleted when a new one starts and on quit.

### 12. macOS: check CoreAudio before pressing the media key
A blind play/pause toggle starts Music when nothing is playing. `kAudioDevicePropertyDeviceIsRunningSomewhere` on the default output device says whether any process is playing, needs no permission, and makes the toggle safe. On close the key is pressed again only if still silent, so a user who already resumed is not paused again.

### 13. Liquid Glass with a fallback
`NSGlassEffectView` (macOS 26) gives the real system material; older systems get an `NSVisualEffectView` behind the same content view, so one layout serves both. The glass does not render offscreen, so the demo snapshot draws the content layer over a stand-in gradient; good enough for layout checks, and the limitation is documented rather than hidden.

### 14. "Sign in with ChatGPT": feasible for the Mac app, not the extension
OpenAI's self-serve open-source flow requires a loopback redirect (`http://127.0.0.1:…/auth/callback`), which a desktop app can serve and an extension cannot. The website flow needs a requested client ID and a backend. Recorded as a roadmap item for the Mac app only.
