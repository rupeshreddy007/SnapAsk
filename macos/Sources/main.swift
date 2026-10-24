// SnapAsk — press a hotkey, drag a box around anything on screen, get an answer
// in a floating panel. The screenshot is deleted the moment it has been sent.
//
// Backends:
//   claude-cli  — uses your existing Claude Code login (no API key needed)
//   api         — calls the Claude API directly with ANTHROPIC_API_KEY
//
// Build: ./build.sh     Run: open build/SnapAsk.app     Test: build/SnapAsk.app/Contents/MacOS/SnapAsk --test image.png

import Cocoa
import Carbon.HIToolbox
import ServiceManagement
import CoreAudio

// MARK: - Logging

let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/SnapAsk.log")

func log(_ s: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
    let data = line.data(using: .utf8)!
    if let h = try? FileHandle(forWritingTo: logURL) {
        h.seekToEndOfFile(); h.write(data); h.closeFile()
    } else {
        try? data.write(to: logURL)
    }
    FileHandle.standardError.write(data)
}

// MARK: - Config

struct Config: Codable {
    var backend = "auto"                 // "auto" | "claude-cli" | "api"
    var hotkey = "cmd+shift+a"
    var apiModel = "claude-opus-5"       // model for the API backend
    var cliModel: String? = nil          // e.g. "opus" / "sonnet"; nil = Claude Code's default
    var apiKey: String? = nil            // optional; ANTHROPIC_API_KEY env is checked first
    var prompt = "I selected this part of my screen because I have a doubt about it. Explain what it shows and answer any question it contains. If it is code or an error, explain it and give the fix. Be concise."
    var depth = "balanced"               // quick | balanced | thorough
    var language = "auto"                // "auto" or a language name
    var pauseMedia = true                // send the media play/pause key while asking
    var system = "You are SnapAsk, a quick on-screen helper. The user pressed a hotkey and selected a region of their screen (a video, a web page, a document, code, an error). Answer directly and concisely. Use markdown sparingly: short bullets and code blocks only when they help."

    enum CodingKeys: String, CodingKey { case backend, hotkey, apiModel, cliModel, apiKey, prompt, system, depth, language, pauseMedia }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Config()
        backend  = try c.decodeIfPresent(String.self, forKey: .backend)  ?? d.backend
        hotkey   = try c.decodeIfPresent(String.self, forKey: .hotkey)   ?? d.hotkey
        apiModel = try c.decodeIfPresent(String.self, forKey: .apiModel) ?? d.apiModel
        cliModel = try c.decodeIfPresent(String.self, forKey: .cliModel)
        apiKey   = try c.decodeIfPresent(String.self, forKey: .apiKey)
        prompt   = try c.decodeIfPresent(String.self, forKey: .prompt)   ?? d.prompt
        system   = try c.decodeIfPresent(String.self, forKey: .system)   ?? d.system
        depth    = try c.decodeIfPresent(String.self, forKey: .depth)    ?? d.depth
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? d.language
        pauseMedia = try c.decodeIfPresent(Bool.self, forKey: .pauseMedia) ?? d.pauseMedia
    }

    static let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/snapask")
    static let file = dir.appendingPathComponent("config.json")

    func save() {
        try? FileManager.default.createDirectory(at: Config.dir, withIntermediateDirectories: true)
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(self) {
            try? data.write(to: Config.file)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Config.file.path)
        }
    }

    static func load() -> Config {
        if let data = try? Data(contentsOf: file) {
            do { return try JSONDecoder().decode(Config.self, from: data) }
            catch { log("config.json invalid, using defaults: \(error)") }
            return Config()
        }
        let c = Config()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(c) {
            try? data.write(to: file)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
        return c
    }
}

// MARK: - Process helper

struct RunResult { let status: Int32; let stdout: String; let stderr: String }

func run(_ exe: String, _ args: [String], cwd: String? = nil, env: [String: String]? = nil) -> RunResult {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = args
    if let cwd = cwd { p.currentDirectoryURL = URL(fileURLWithPath: cwd) }
    if let env = env { p.environment = env }
    let out = Pipe(), err = Pipe()
    p.standardOutput = out; p.standardError = err; p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return RunResult(status: -1, stdout: "", stderr: "\(error)") }
    var errData = Data()
    let group = DispatchGroup(); group.enter()
    DispatchQueue.global().async { errData = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }
    let outData = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit(); group.wait()
    return RunResult(status: p.terminationStatus,
                     stdout: String(data: outData, encoding: .utf8) ?? "",
                     stderr: String(data: errData, encoding: .utf8) ?? "")
}

func cleanEnvironment() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    // Allow running the app from inside a Claude Code session without the nested-session guard tripping.
    env.removeValue(forKey: "CLAUDECODE")
    env.removeValue(forKey: "CLAUDE_CODE_ENTRYPOINT")
    let home = NSHomeDirectory()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:\(home)/.local/bin:\(home)/.claude/local:/usr/bin:/bin:" + (env["PATH"] ?? "")
    return env
}

/// Value of an environment variable as the user's login shell sees it (apps launched from Finder get a bare env).
func loginShellEnv(_ name: String) -> String? {
    let r = run("/bin/zsh", ["-lc", "printf '%s' \"$\(name)\""], env: cleanEnvironment())
    let v = r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    return v.isEmpty ? nil : v
}

// MARK: - Media pause (play/pause key, only when audio is actually playing)

enum MediaControl {
    private static var pausedByUs = false

    /// True when any process is playing through the default output device (CoreAudio, no permissions needed).
    static func isAudioPlaying() -> Bool {
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                              mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &device) == noErr, device != 0 else { return false }
        var running: UInt32 = 0
        var rsize = UInt32(MemoryLayout<UInt32>.size)
        var raddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
                                               mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(device, &raddr, 0, nil, &rsize, &running) == noErr else { return false }
        return running != 0
    }

    /// Posts the hardware play/pause key (NX_KEYTYPE_PLAY). macOS delivers it to the current Now Playing app.
    static func sendPlayPause() {
        let keyPlay: Int = 16
        func post(_ down: Bool) {
            let flags = NSEvent.ModifierFlags(rawValue: down ? 0xa00 : 0xb00)
            let data1 = (keyPlay << 16) | ((down ? 0xa : 0xb) << 8)
            guard let ev = NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags, timestamp: 0,
                                              windowNumber: 0, context: nil, subtype: 8, data1: data1, data2: -1) else { return }
            ev.cgEvent?.post(tap: .cghidEventTap)
        }
        post(true); post(false)
    }

    /// Synthetic key events are dropped unless the app is trusted for Accessibility. Prompt once.
    static func ensureTrusted() -> Bool {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(opts)
    }

    static func pauseIfPlaying() {
        guard isAudioPlaying() else { return }
        guard ensureTrusted() else { log("media: not trusted for Accessibility, cannot send play/pause"); return }
        sendPlayPause()
        pausedByUs = true
        log("media: paused")
    }

    static func resumeIfPaused() {
        guard pausedByUs else { return }
        pausedByUs = false
        // Give the player a moment to settle; only resume if it is still silent (the user did not restart it).
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            if !isAudioPlaying() { sendPlayPause(); log("media: resumed") }
        }
    }
}

// MARK: - Backends

enum BackendError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

protocol Backend: AnyObject {
    var name: String { get }
    /// Pass `image` to start a new conversation; pass nil to ask a follow-up in the current one.
    func ask(image: Data?, question: String, completion: @escaping (Result<String, Error>) -> Void)
    func reset()
}

/// Uses the Claude Code CLI (`claude -p`). Works with your existing Claude login; no API key.
final class ClaudeCLIBackend: Backend {
    let name = "Claude Code CLI"
    private let exe: String
    private let model: String?
    private let system: String
    private var sessionId: String?
    /// Stable cwd for every `claude` call: Claude Code keys sessions by working directory, so
    /// follow-ups (--resume) only work if the first turn and later turns share it.
    private let workDir: URL

    init?(model: String?, system: String) {
        guard let path = ClaudeCLIBackend.findClaude() else { return nil }
        exe = path; self.model = model; self.system = system
        workDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SnapAsk/work")
        try? FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        log("claude CLI at \(path)")
    }

    /// Claude Code writes every -p session to ~/.claude/projects/<cwd>/<session>.jsonl, screenshot included.
    /// We remove the previous conversation's transcript whenever a new one starts (and on quit).
    private func deleteTranscript(_ sid: String?) {
        guard let sid = sid else { return }
        let projects = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/projects")
        guard let dirs = try? FileManager.default.contentsOfDirectory(at: projects, includingPropertiesForKeys: nil) else { return }
        for d in dirs {
            let f = d.appendingPathComponent("\(sid).jsonl")
            if FileManager.default.fileExists(atPath: f.path) {
                try? FileManager.default.removeItem(at: f)
                log("deleted transcript \(f.lastPathComponent)")
            }
        }
    }

    static func findClaude() -> String? {
        let home = NSHomeDirectory()
        let candidates = ["/opt/homebrew/bin/claude", "/usr/local/bin/claude",
                          "\(home)/.claude/local/claude", "\(home)/.local/bin/claude", "\(home)/.npm-global/bin/claude"]
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) { return c }
        let r = run("/bin/zsh", ["-lc", "command -v claude"], env: cleanEnvironment())
        let found = r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        return found.isEmpty ? nil : found
    }

    func reset() { deleteTranscript(sessionId); sessionId = nil }
    deinit { deleteTranscript(sessionId) }

    func ask(image: Data?, question: String, completion: @escaping (Result<String, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            var args = ["-p", "--output-format", "json"]
            if let m = self.model { args += ["--model", m] }
            var prompt = question
            var shot: URL? = nil

            if let image = image {
                self.reset()
                let file = self.workDir.appendingPathComponent("shot-\(UUID().uuidString).png")
                do { try image.write(to: file) } catch { completion(.failure(error)); return }
                shot = file
                prompt = "First use the Read tool to view the screenshot at \(file.path). Then: \(question)"
                args += ["--allowedTools", "Read", "--append-system-prompt", self.system]
            } else if let sid = self.sessionId {
                args += ["--resume", sid]
            }
            args.append(prompt)

            let r = run(self.exe, args, cwd: self.workDir.path, env: cleanEnvironment())
            if let f = shot { try? FileManager.default.removeItem(at: f) }   // screenshot gone

            guard let data = r.stdout.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                let detail = r.stderr.isEmpty ? r.stdout : r.stderr
                completion(.failure(BackendError.message("claude exited \(r.status): \(detail.prefix(800))")))
                return
            }
            if let sid = obj["session_id"] as? String { self.sessionId = sid }
            let result = obj["result"] as? String ?? ""
            if obj["is_error"] as? Bool == true || r.status != 0 {
                completion(.failure(BackendError.message(result.isEmpty ? "claude exited \(r.status)" : result)))
                return
            }
            completion(.success(result))
        }
    }
}

/// Calls the Claude API directly (raw HTTP; there is no official Swift SDK). Nothing touches disk.
final class APIBackend: Backend {
    let name: String
    private let key: String
    private let model: String
    private let system: String
    private let effort: String
    private var messages: [[String: Any]] = []

    init(key: String, model: String, system: String, effort: String = "medium") {
        self.key = key; self.model = model; self.system = system; self.effort = effort
        name = "Claude API (\(model))"
    }

    func reset() { messages = [] }

    func ask(image: Data?, question: String, completion: @escaping (Result<String, Error>) -> Void) {
        var content: [[String: Any]] = []
        if let image = image {
            messages = []
            content.append(["type": "image",
                            "source": ["type": "base64", "media_type": "image/png",
                                       "data": image.base64EncodedString()]])
        }
        content.append(["type": "text", "text": question])
        messages.append(["role": "user", "content": content])

        var body: [String: Any] = [
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "messages": messages,
            "fallbacks": "default",          // server-side refusal fallback (beta)
        ]
        if !model.contains("haiku") { body["output_config"] = ["effort": effort] }
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 300
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        req.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { completion(.failure(err)); return }
            guard let data = data,
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                completion(.failure(BackendError.message("Unreadable API response"))); return
            }
            if let e = obj["error"] as? [String: Any] {
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                completion(.failure(BackendError.message("API \(status): \(e["message"] as? String ?? "\(e)")")))
                return
            }
            let blocks = obj["content"] as? [[String: Any]] ?? []
            let text = blocks.filter { $0["type"] as? String == "text" }
                             .compactMap { $0["text"] as? String }.joined(separator: "\n")
            if obj["stop_reason"] as? String == "refusal" {
                let why = (obj["stop_details"] as? [String: Any])?["explanation"] as? String ?? "request declined"
                completion(.failure(BackendError.message("Refused: \(why)"))); return
            }
            self.messages.append(["role": "assistant", "content": blocks])   // keep full blocks for the next turn
            completion(.success(text))
        }.resume()
    }
}

func systemPrompt(_ cfg: Config) -> String {
    let depth = ["quick": "Keep it to a few sentences unless the content truly demands more.",
                 "balanced": "Be concise but complete: lead with the answer, then only the context that matters.",
                 "thorough": "Be thorough: cover reasoning, edge cases and alternatives."][cfg.depth] ?? ""
    let lang = cfg.language == "auto" || cfg.language.isEmpty
        ? "Answer in the language the user writes in; for the default request, use the main language of the image."
        : "Always answer in \(cfg.language)."
    return [cfg.system, depth, lang].joined(separator: " ")
}

func effortFor(_ cfg: Config) -> String { ["quick": "low", "thorough": "high"][cfg.depth] ?? "medium" }

func makeBackend(_ cfg: Config) -> Backend? {
    let key = ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"]
        ?? cfg.apiKey
        ?? (cfg.backend == "api" || cfg.backend == "auto" ? loginShellEnv("ANTHROPIC_API_KEY") : nil)
    switch cfg.backend {
    case "api":
        guard let k = key, !k.isEmpty else { log("backend=api but no ANTHROPIC_API_KEY"); return nil }
        return APIBackend(key: k, model: cfg.apiModel, system: systemPrompt(cfg), effort: effortFor(cfg))
    case "claude-cli":
        return ClaudeCLIBackend(model: cfg.cliModel, system: systemPrompt(cfg))
    default:
        if let cli = ClaudeCLIBackend(model: cfg.cliModel, system: systemPrompt(cfg)) { return cli }
        if let k = key, !k.isEmpty { return APIBackend(key: k, model: cfg.apiModel, system: systemPrompt(cfg), effort: effortFor(cfg)) }
        return nil
    }
}

// MARK: - Lightweight markdown rendering

func renderMarkdown(_ md: String) -> NSAttributedString {
    let out = NSMutableAttributedString()
    let body = NSFont.systemFont(ofSize: 14)
    let mono = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    let color = NSColor.textColor
    let codeBG = NSColor.textColor.withAlphaComponent(0.07)
    var inCode = false
    let inline = try! NSRegularExpression(pattern: "\\*\\*(.+?)\\*\\*|`([^`]+)`|(?<![\\w*])\\*([^*\\n]+?)\\*(?![\\w*])")

    func appendInline(_ line: String, font: NSFont) {
        let ns = line as NSString
        var pos = 0
        for m in inline.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > pos {
                out.append(NSAttributedString(string: ns.substring(with: NSRange(location: pos, length: m.range.location - pos)),
                                              attributes: [.font: font, .foregroundColor: color]))
            }
            if m.range(at: 1).location != NSNotFound {
                let bold = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask)
                out.append(NSAttributedString(string: ns.substring(with: m.range(at: 1)), attributes: [.font: bold, .foregroundColor: color]))
            } else if m.range(at: 3).location != NSNotFound {
                let italic = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask)
                out.append(NSAttributedString(string: ns.substring(with: m.range(at: 3)), attributes: [.font: italic, .foregroundColor: color]))
            } else {
                out.append(NSAttributedString(string: ns.substring(with: m.range(at: 2)),
                                              attributes: [.font: mono, .foregroundColor: color, .backgroundColor: codeBG]))
            }
            pos = m.range.location + m.range.length
        }
        if pos < ns.length {
            out.append(NSAttributedString(string: ns.substring(from: pos), attributes: [.font: font, .foregroundColor: color]))
        }
    }

    for raw in md.components(separatedBy: "\n") {
        if raw.hasPrefix("```") { inCode.toggle(); continue }
        if inCode {
            out.append(NSAttributedString(string: raw + "\n", attributes: [.font: mono, .foregroundColor: color, .backgroundColor: codeBG]))
            continue
        }
        var line = raw
        var font = body
        if let r = line.range(of: "^#{1,6} ", options: .regularExpression) {
            line.removeSubrange(r); font = NSFont.boldSystemFont(ofSize: 15)
        } else if let r = line.range(of: "^(\\s*)[-*] ", options: .regularExpression) {
            let indent = String(line[r]).filter { $0 == " " }.count / 2
            line.replaceSubrange(r, with: String(repeating: "    ", count: indent) + "•  ")
        } else if let r = line.range(of: "^(\\s*)\\d+\\. ", options: .regularExpression) {
            let num = String(line[r]).trimmingCharacters(in: .whitespaces)
            line.replaceSubrange(r, with: num + " ")
        }
        appendInline(line, font: font)
        out.append(NSAttributedString(string: "\n", attributes: [.font: font]))
    }
    return out
}

// MARK: - Answer panel (Liquid Glass on macOS 26, vibrancy fallback below)

let quickActions: [(label: String, prompt: String)] = [
    ("Explain",   "Explain what is shown here. If it contains a question, answer it. If it is code or an error, explain it and give the fix."),
    ("Translate", "Translate all the text in this image, then briefly explain anything that needs context."),
    ("Summarize", "Summarize the key points shown here in a few short bullets."),
    ("Fix code",  "Find the bug or error shown here and give the corrected code."),
    ("Simplify",  "Explain this simply, step by step, as if to a beginner."),
]

/// Dynamic colour that follows light/dark appearance.
func dyn(_ light: NSColor, _ dark: NSColor) -> NSColor {
    NSColor(name: nil) { app in app.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light }
}
let glassFill   = dyn(NSColor.white.withAlphaComponent(0.42), NSColor.white.withAlphaComponent(0.08))
let glassStroke = dyn(NSColor.white.withAlphaComponent(0.75), NSColor.white.withAlphaComponent(0.16))
let accent  = NSColor(red: 0.36, green: 0.36, blue: 0.84, alpha: 1)
let accent2 = NSColor(red: 0.66, green: 0.33, blue: 0.97, alpha: 1)

/// A pill-shaped translucent container (used for the input field and chips).
final class Pill: NSBox {
    init(radius: CGFloat) {
        super.init(frame: .zero)
        boxType = .custom; titlePosition = .noTitle; contentViewMargins = .zero
        cornerRadius = radius; borderWidth = 1
        fillColor = glassFill; borderColor = glassStroke
        translatesAutoresizingMaskIntoConstraints = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

final class ChipButton: NSButton {
    init(title: String, target: AnyObject?, action: Selector) {
        super.init(frame: .zero)
        self.title = title; self.target = target; self.action = action
        isBordered = false
        font = NSFont.systemFont(ofSize: 12, weight: .medium)
        contentTintColor = .labelColor
        wantsLayer = true
        layer?.cornerRadius = 13
        layer?.borderWidth = 1
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 26).isActive = true
        widthAnchor.constraint(equalToConstant: attributedTitle.size().width + 24).isActive = true
        updateColors()
    }
    required init?(coder: NSCoder) { fatalError() }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); updateColors() }
    private func updateColors() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = glassFill.cgColor
            layer?.borderColor = glassStroke.cgColor
        }
    }
}

final class AnswerPanel: NSPanel {
    private let textView = NSTextView()
    private let scroll = NSScrollView()
    private let thumb = NSImageView()
    private let modelLabel = NSTextField(labelWithString: "")
    private let input = NSTextField()
    private let sendButton = NSButton()
    private let spinner = NSProgressIndicator()
    private let status = NSTextField(labelWithString: "")
    private var lastAnswer = ""
    private(set) var inner: NSView!
    var onAsk: ((String) -> Void)?
    var onNewSelection: (() -> Void)?
    var onClose: (() -> Void)?

    override func close() { super.close(); onClose?() }

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 420, height: 480),
                   styleMask: [.borderless, .nonactivatingPanel, .resizable],
                   backing: .buffered, defer: false)
        level = .floating
        isFloatingPanel = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]   // floats over full-screen video too
        minSize = NSSize(width: 340, height: 260)
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        isMovableByWindowBackground = true

        // Glass surface
        let content = NSView()
        content.wantsLayer = true
        content.translatesAutoresizingMaskIntoConstraints = false
        inner = content
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.cornerRadius = 22
            glass.style = .regular
            glass.contentView = content
            contentView = glass
        } else {
            let fx = NSVisualEffectView()
            fx.material = .popover
            fx.blendingMode = .behindWindow
            fx.state = .active
            fx.wantsLayer = true
            fx.layer?.cornerRadius = 22
            fx.layer?.masksToBounds = true
            fx.addSubview(content)
            contentView = fx
        }
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: contentView!.topAnchor),
            content.bottomAnchor.constraint(equalTo: contentView!.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: contentView!.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: contentView!.trailingAnchor),
        ])

        // Header: thumbnail · title/model · new-selection · copy · close
        thumb.imageScaling = .scaleProportionallyUpOrDown
        thumb.wantsLayer = true
        thumb.layer?.cornerRadius = 8
        thumb.layer?.masksToBounds = true
        thumb.layer?.borderWidth = 1
        thumb.layer?.borderColor = NSColor.white.withAlphaComponent(0.5).cgColor
        thumb.translatesAutoresizingMaskIntoConstraints = false

        let dot = NSView(); dot.wantsLayer = true; dot.translatesAutoresizingMaskIntoConstraints = false
        dot.widthAnchor.constraint(equalToConstant: 9).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 9).isActive = true
        dot.layer?.cornerRadius = 4.5
        dot.layer?.backgroundColor = accent.cgColor
        dot.layer?.shadowColor = accent2.cgColor; dot.layer?.shadowOpacity = 0.8; dot.layer?.shadowRadius = 5; dot.layer?.shadowOffset = .zero
        let title = NSTextField(labelWithString: "SnapAsk")
        title.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        let titleRow = NSStackView(views: [dot, title]); titleRow.spacing = 6; titleRow.alignment = .centerY
        modelLabel.font = NSFont.systemFont(ofSize: 11)
        modelLabel.textColor = .secondaryLabelColor
        modelLabel.lineBreakMode = .byTruncatingTail
        let titleStack = NSStackView(views: [titleRow, modelLabel])
        titleStack.orientation = .vertical; titleStack.alignment = .leading; titleStack.spacing = 1

        let again = iconButton("arrow.counterclockwise", tip: "Select another area", action: #selector(newSelection))
        let copy  = iconButton("doc.on.doc", tip: "Copy answer", action: #selector(copyAnswer))
        let close = iconButton("xmark", tip: "Close (Esc)", action: #selector(closePanel))
        let header = NSStackView(views: [thumb, titleStack, NSView(), again, copy, close])
        header.spacing = 8; header.alignment = .centerY
        header.translatesAutoresizingMaskIntoConstraints = false
        header.setHuggingPriority(.defaultLow, for: .horizontal)

        let divider = NSBox(); divider.boxType = .separator; divider.translatesAutoresizingMaskIntoConstraints = false

        // Answer area
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 10, height: 8)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false

        // Quick actions
        let chips = NSStackView(views: quickActions.map { ChipButton(title: $0.label, target: self, action: #selector(chipTapped(_:))) })
        chips.spacing = 6
        chips.translatesAutoresizingMaskIntoConstraints = false

        // Follow-up input
        let inputPill = Pill(radius: 13)
        input.isBordered = false
        input.drawsBackground = false
        input.focusRingType = .none
        input.placeholderString = "Ask a follow-up…"
        input.font = NSFont.systemFont(ofSize: 13.5)
        input.target = self
        input.action = #selector(submit)
        input.translatesAutoresizingMaskIntoConstraints = false
        inputPill.addSubview(input)

        sendButton.image = NSImage(systemSymbolName: "arrow.up", accessibilityDescription: "Send")
        sendButton.imagePosition = .imageOnly
        sendButton.isBordered = false
        sendButton.contentTintColor = .white
        sendButton.wantsLayer = true
        sendButton.layer?.cornerRadius = 11
        sendButton.target = self
        sendButton.action = #selector(submit)
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        let grad = CAGradientLayer()
        grad.colors = [accent.cgColor, accent2.cgColor]
        grad.startPoint = CGPoint(x: 0, y: 1); grad.endPoint = CGPoint(x: 1, y: 0)
        grad.cornerRadius = 11
        grad.frame = CGRect(x: 0, y: 0, width: 34, height: 34)
        sendButton.layer?.insertSublayer(grad, at: 0)
        sendButton.layer?.shadowColor = accent.cgColor; sendButton.layer?.shadowOpacity = 0.35
        sendButton.layer?.shadowRadius = 8; sendButton.layer?.shadowOffset = CGSize(width: 0, height: -3)

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.translatesAutoresizingMaskIntoConstraints = false
        status.font = NSFont.systemFont(ofSize: 11)
        status.textColor = .secondaryLabelColor
        status.lineBreakMode = .byTruncatingTail
        status.translatesAutoresizingMaskIntoConstraints = false

        [header, divider, scroll, chips, inputPill, sendButton, spinner, status].forEach { content.addSubview($0) }
        NSLayoutConstraint.activate([
            thumb.widthAnchor.constraint(equalToConstant: 46), thumb.heightAnchor.constraint(equalToConstant: 34),
            header.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 14),
            header.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -10),
            divider.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 10),
            divider.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 14),
            divider.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -14),

            scroll.topAnchor.constraint(equalTo: divider.bottomAnchor, constant: 2),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 6),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -6),
            scroll.bottomAnchor.constraint(equalTo: chips.topAnchor, constant: -6),

            chips.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 14),
            chips.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -14),
            chips.bottomAnchor.constraint(equalTo: inputPill.topAnchor, constant: -10),

            inputPill.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 14),
            inputPill.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -8),
            inputPill.heightAnchor.constraint(equalToConstant: 34),
            inputPill.bottomAnchor.constraint(equalTo: status.topAnchor, constant: -8),
            input.leadingAnchor.constraint(equalTo: inputPill.leadingAnchor, constant: 12),
            input.trailingAnchor.constraint(equalTo: inputPill.trailingAnchor, constant: -10),
            input.centerYAnchor.constraint(equalTo: inputPill.centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 34), sendButton.heightAnchor.constraint(equalToConstant: 34),
            sendButton.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -14),
            sendButton.centerYAnchor.constraint(equalTo: inputPill.centerYAnchor),

            spinner.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            spinner.centerYAnchor.constraint(equalTo: status.centerYAnchor),
            status.leadingAnchor.constraint(equalTo: spinner.trailingAnchor, constant: 6),
            status.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -14),
            status.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -10),
        ])
    }

    private func iconButton(_ symbol: String, tip: String, action: Selector) -> NSButton {
        let b = NSButton()
        b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: tip)
        b.imagePosition = .imageOnly
        b.isBordered = false
        b.contentTintColor = .secondaryLabelColor
        b.toolTip = tip
        b.target = self; b.action = action
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: 26).isActive = true
        b.heightAnchor.constraint(equalToConstant: 26).isActive = true
        return b
    }

    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { close() }

    func startNew(backendName: String, image: Data?) {
        textView.string = ""
        lastAnswer = ""
        input.stringValue = ""
        modelLabel.stringValue = backendName
        thumb.image = image.flatMap { NSImage(data: $0) }
        thumb.isHidden = thumb.image == nil
        placeNearMouse()
        setLoading(true, "Looking…")
        NSApp.activate(ignoringOtherApps: true)
        makeKeyAndOrderFront(nil)
    }

    func showQuestion(_ q: String) {
        let s = NSMutableAttributedString(string: "\n▸ \(q)\n\n",
            attributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: .semibold), .foregroundColor: NSColor.secondaryLabelColor])
        textView.textStorage?.append(s)
        scrollToBottom()
    }

    func showAnswer(_ text: String) {
        lastAnswer = text
        textView.textStorage?.append(renderMarkdown(text))
        setLoading(false, "")
        scrollToBottom()
        makeFirstResponder(input)
    }

    func showError(_ text: String) {
        let s = NSAttributedString(string: "⚠︎ \(text)\n",
            attributes: [.font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.systemRed])
        textView.textStorage?.append(s)
        setLoading(false, "")
        scrollToBottom()
    }

    func setLoading(_ on: Bool, _ msg: String) {
        status.stringValue = msg
        input.isEnabled = !on
        sendButton.isEnabled = !on
        sendButton.alphaValue = on ? 0.5 : 1
        if on { spinner.startAnimation(nil) } else { spinner.stopAnimation(nil) }
    }

    private func scrollToBottom() { textView.scrollToEndOfDocument(nil) }

    private func placeNearMouse() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        guard let vis = screen?.visibleFrame else { return }
        let size = frame.size
        setFrameOrigin(NSPoint(x: vis.maxX - size.width - 24, y: vis.maxY - size.height - 24))
    }

    @objc private func submit() {
        let q = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, input.isEnabled else { return }
        input.stringValue = ""
        showQuestion(q)
        onAsk?(q)
    }

    @objc private func chipTapped(_ sender: NSButton) {
        guard input.isEnabled, let action = quickActions.first(where: { $0.label == sender.title }) else { return }
        showQuestion(action.label)
        onAsk?(action.prompt)
    }

    @objc private func newSelection() { close(); onNewSelection?() }
    @objc private func closePanel() { close() }

    @objc private func copyAnswer() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lastAnswer, forType: .string)
        status.stringValue = "Copied"
    }
}

// MARK: - Hotkey

struct Hotkey {
    let keyCode: UInt32
    let modifiers: UInt32
    let label: String

    static let keyCodes: [String: Int] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
        "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
        "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "space": 49, "`": 50,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101,
        "f10": 109, "f11": 103, "f12": 111,
    ]

    static func parse(_ s: String) -> Hotkey? {
        var mods: UInt32 = 0
        var key: UInt32? = nil
        var label = ""
        for part in s.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            switch part {
            case "cmd", "command", "⌘": mods |= UInt32(cmdKey); label += "⌘"
            case "shift", "⇧":           mods |= UInt32(shiftKey); label += "⇧"
            case "alt", "option", "⌥":   mods |= UInt32(optionKey); label += "⌥"
            case "ctrl", "control", "⌃": mods |= UInt32(controlKey); label += "⌃"
            default:
                guard let code = keyCodes[part] else { return nil }
                key = UInt32(code); label += part.uppercased()
            }
        }
        guard let k = key else { return nil }
        return Hotkey(keyCode: k, modifiers: mods, label: label)
    }
}

// MARK: - Settings window

/// Renders a view's layer tree over a stand-in backdrop (glass itself only composites on screen).
func renderSnapshot(of v: NSView, to path: String) {
    guard let layer = v.layer else { return }
    let scale: CGFloat = 2
    let w = Int(v.bounds.width * scale), h = Int(v.bounds.height * scale)
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    ctx.scaleBy(x: scale, y: scale)
    let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    let g = NSGradient(colors: dark ? [NSColor(red: 0.16, green: 0.16, blue: 0.24, alpha: 1), NSColor(red: 0.08, green: 0.1, blue: 0.14, alpha: 1)]
                                    : [NSColor(red: 0.86, green: 0.88, blue: 0.98, alpha: 1), NSColor(red: 0.95, green: 0.9, blue: 0.98, alpha: 1)])!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
    g.draw(in: v.bounds, angle: 135)
    NSGraphicsContext.restoreGraphicsState()
    v.displayIfNeeded()
    layer.render(in: ctx)
    if let img = ctx.makeImage() {
        try? NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
    }
}

final class SettingsWindow: NSWindow, NSTextFieldDelegate, NSTextViewDelegate {
    private var cfg: Config
    private let onChange: (Config) -> Void
    private let onTest: (Config, @escaping (Result<String, Error>) -> Void) -> Void
    private(set) var inner: NSView!
    private var saveTimer: Timer?

    private let backendPop = NSPopUpButton(frame: .zero, pullsDown: false)
    private let apiKeyField = NSSecureTextField()
    private let testButton = NSButton(title: "Connect", target: nil, action: nil)
    private let testStatus = NSTextField(wrappingLabelWithString: "")
    private let apiModelPop = NSPopUpButton(frame: .zero, pullsDown: false)
    private let customModelField = NSTextField()
    private let cliModelPop = NSPopUpButton(frame: .zero, pullsDown: false)
    private let hotkeyField = NSTextField()
    private let hotkeyStatus = NSTextField(labelWithString: "")
    private let depthSeg = NSSegmentedControl(labels: ["Quick", "Balanced", "Thorough"], trackingMode: .selectOne, target: nil, action: nil)
    private let languageField = NSTextField()
    private let promptView = NSTextView()
    private let promptScroll = NSScrollView()
    private let loginSwitch = NSSwitch()
    private let loginStatus = NSTextField(labelWithString: "")
    private let mediaSwitch = NSSwitch()
    private let mediaStatus = NSTextField(wrappingLabelWithString: "")
    private var customModelRow: NSGridRow?

    static let backends: [(String, String)] = [
        ("auto", "Automatic (Claude Code, else API)"),
        ("claude-cli", "Claude Code CLI (no key needed)"),
        ("api", "Claude API (key required)"),
    ]
    static let apiModels: [(String, String)] = [
        ("claude-opus-5", "Claude Opus 5 · most capable"),
        ("claude-sonnet-5", "Claude Sonnet 5 · fast and smart"),
        ("claude-haiku-4-5", "Claude Haiku 4.5 · fastest"),
    ]
    static let cliModels: [(String?, String)] = [(nil, "Claude Code default"), ("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")]

    init(config: Config, onChange: @escaping (Config) -> Void,
         onTest: @escaping (Config, @escaping (Result<String, Error>) -> Void) -> Void) {
        cfg = config; self.onChange = onChange; self.onTest = onTest
        super.init(contentRect: NSRect(x: 0, y: 0, width: 520, height: 640),
                   styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        title = "SnapAsk Settings"
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isReleasedWhenClosed = false
        backgroundColor = .clear
        isOpaque = false
        isMovableByWindowBackground = true
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true

        let content = NSView()
        content.wantsLayer = true
        content.translatesAutoresizingMaskIntoConstraints = false
        inner = content
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.style = .regular
            glass.contentView = content
            contentView = glass
        } else {
            let fx = NSVisualEffectView()
            fx.material = .popover; fx.blendingMode = .behindWindow; fx.state = .active
            fx.addSubview(content)
            contentView = fx
        }
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: contentView!.topAnchor),
            content.bottomAnchor.constraint(equalTo: contentView!.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: contentView!.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: contentView!.trailingAnchor),
        ])
        buildUI(in: content)
        load()
        content.layoutSubtreeIfNeeded()
        setContentSize(content.fittingSize)
    }

    // MARK: layout

    private func label(_ text: String) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.font = NSFont.systemFont(ofSize: 12.5)
        l.textColor = .secondaryLabelColor
        l.alignment = .right
        return l
    }

    private func section(_ title: String, rows: [(String, NSView)]) -> (NSView, NSGridView) {
        let box = Pill(radius: 16)
        let t = NSTextField(labelWithString: title)
        t.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        let grid = NSGridView(views: rows.map { [label($0.0), $0.1] })
        grid.rowSpacing = 9
        grid.columnSpacing = 12
        grid.column(at: 0).width = 118
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).xPlacement = .fill
        grid.rowAlignment = .none
        for i in 0..<grid.numberOfRows { grid.row(at: i).yPlacement = .center }
        grid.translatesAutoresizingMaskIntoConstraints = false
        let stack = NSStackView(views: [t, grid])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -14),
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -16),
            grid.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        return (box, grid)
    }

    private func buildUI(in content: NSView) {
        // Header
        let icon = NSImageView(image: NSImage(systemSymbolName: "camera.viewfinder", accessibilityDescription: nil) ?? NSImage())
        icon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
        icon.contentTintColor = accent
        let name = NSTextField(labelWithString: "SnapAsk"); name.font = NSFont.systemFont(ofSize: 20, weight: .bold)
        let tag = NSTextField(labelWithString: "Select anything on screen. Get an answer. Nothing else.")
        tag.font = NSFont.systemFont(ofSize: 12.5); tag.textColor = .secondaryLabelColor
        let titles = NSStackView(views: [name, tag]); titles.orientation = .vertical; titles.alignment = .leading; titles.spacing = 1
        let header = NSStackView(views: [icon, titles]); header.spacing = 10; header.alignment = .centerY

        // Provider
        backendPop.addItems(withTitles: Self.backends.map { $0.1 })
        backendPop.target = self; backendPop.action = #selector(changed)
        apiKeyField.placeholderString = "sk-ant-…"; apiKeyField.delegate = self
        testButton.bezelStyle = .rounded; testButton.target = self; testButton.action = #selector(testTapped)
        let keyRow = NSStackView(views: [apiKeyField, testButton]); keyRow.spacing = 8
        testStatus.font = NSFont.systemFont(ofSize: 11.5); testStatus.textColor = .secondaryLabelColor
        apiModelPop.addItems(withTitles: Self.apiModels.map { $0.1 } + ["Custom model id…"])
        apiModelPop.target = self; apiModelPop.action = #selector(changed)
        customModelField.placeholderString = "model-id"; customModelField.delegate = self
        cliModelPop.addItems(withTitles: Self.cliModels.map { $0.1 })
        cliModelPop.target = self; cliModelPop.action = #selector(changed)
        let (provider, providerGrid) = section("Provider", rows: [
            ("Backend", backendPop), ("API key", keyRow), ("", testStatus), ("API model", apiModelPop),
            ("", customModelField), ("Claude Code model", cliModelPop),
        ])
        customModelRow = providerGrid.cell(for: customModelField)?.row

        // Answers
        depthSeg.target = self; depthSeg.action = #selector(changed)
        depthSeg.segmentStyle = .rounded
        languageField.placeholderString = "Auto (same as the content)"; languageField.delegate = self
        promptView.delegate = self
        promptView.isRichText = false
        promptView.font = NSFont.systemFont(ofSize: 12.5)
        promptView.textContainerInset = NSSize(width: 6, height: 6)
        promptView.isVerticallyResizable = true
        promptView.isHorizontallyResizable = false
        promptView.autoresizingMask = [.width]
        promptView.textContainer?.widthTracksTextView = true
        promptView.drawsBackground = false
        promptScroll.documentView = promptView
        promptScroll.hasVerticalScroller = true
        promptScroll.autohidesScrollers = true
        promptScroll.borderType = .noBorder
        promptScroll.drawsBackground = true
        promptScroll.backgroundColor = .textBackgroundColor
        promptScroll.wantsLayer = true
        promptScroll.layer?.cornerRadius = 6
        promptScroll.layer?.borderWidth = 1
        promptScroll.layer?.borderColor = NSColor.separatorColor.cgColor
        promptScroll.translatesAutoresizingMaskIntoConstraints = false
        promptScroll.heightAnchor.constraint(equalToConstant: 66).isActive = true
        let (answers, _) = section("Answers", rows: [("Depth", depthSeg), ("Language", languageField), ("First question", promptScroll)])

        // Shortcut & startup
        hotkeyField.placeholderString = "cmd+shift+a"; hotkeyField.delegate = self
        hotkeyField.font = NSFont.monospacedSystemFont(ofSize: 12.5, weight: .regular)
        hotkeyStatus.font = NSFont.systemFont(ofSize: 12.5)
        let hkRow = NSStackView(views: [hotkeyField, hotkeyStatus]); hkRow.spacing = 10
        hotkeyField.widthAnchor.constraint(equalToConstant: 160).isActive = true
        loginSwitch.target = self; loginSwitch.action = #selector(loginToggled)
        loginStatus.font = NSFont.systemFont(ofSize: 11.5); loginStatus.textColor = .secondaryLabelColor
        let loginRow = NSStackView(views: [loginSwitch, loginStatus]); loginRow.spacing = 10
        mediaSwitch.target = self; mediaSwitch.action = #selector(mediaToggled)
        mediaStatus.font = NSFont.systemFont(ofSize: 11.5); mediaStatus.textColor = .secondaryLabelColor
        let mediaRow = NSStackView(views: [mediaSwitch, mediaStatus]); mediaRow.spacing = 10; mediaRow.alignment = .top
        let (shortcut, _) = section("Shortcut, media & startup", rows: [("Hotkey", hkRow), ("Pause media", mediaRow), ("Open at login", loginRow)])

        let privacy = NSTextField(wrappingLabelWithString: "Screenshots are deleted as soon as they are sent. No history, no analytics, no SnapAsk server. Changes save automatically.")
        privacy.font = NSFont.systemFont(ofSize: 11.5); privacy.textColor = .secondaryLabelColor

        let stack = NSStackView(views: [header, provider, answers, shortcut, privacy])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 40),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -22),
            stack.widthAnchor.constraint(equalToConstant: 476),
            provider.widthAnchor.constraint(equalTo: stack.widthAnchor),
            answers.widthAnchor.constraint(equalTo: stack.widthAnchor),
            shortcut.widthAnchor.constraint(equalTo: stack.widthAnchor),
            privacy.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    // MARK: state

    private func load() {
        backendPop.selectItem(at: Self.backends.firstIndex { $0.0 == cfg.backend } ?? 0)
        apiKeyField.stringValue = cfg.apiKey ?? ""
        if let i = Self.apiModels.firstIndex(where: { $0.0 == cfg.apiModel }) {
            apiModelPop.selectItem(at: i); customModelRow?.isHidden = true
        } else {
            apiModelPop.selectItem(at: Self.apiModels.count); customModelField.stringValue = cfg.apiModel; customModelRow?.isHidden = false
        }
        cliModelPop.selectItem(at: Self.cliModels.firstIndex { $0.0 == cfg.cliModel } ?? 0)
        depthSeg.selectedSegment = ["quick", "balanced", "thorough"].firstIndex(of: cfg.depth) ?? 1
        languageField.stringValue = cfg.language == "auto" ? "" : cfg.language
        promptView.string = cfg.prompt
        hotkeyField.stringValue = cfg.hotkey
        hotkeyStatus.stringValue = Hotkey.parse(cfg.hotkey)?.label ?? ""
        hotkeyStatus.textColor = .secondaryLabelColor
        testStatus.stringValue = cfg.backend == "api" || !(cfg.apiKey ?? "").isEmpty ? "Click Connect to verify." : "Connect checks that answers work with the current backend."
        mediaSwitch.state = cfg.pauseMedia ? .on : .off
        mediaStatus.stringValue = "Presses the play/pause key when something is playing, and again when the card closes. Needs Accessibility access the first time."
        if #available(macOS 13.0, *) {
            loginSwitch.state = SMAppService.mainApp.status == .enabled ? .on : .off
            loginStatus.stringValue = "Adds SnapAsk to your Login Items."
        } else {
            loginSwitch.isEnabled = false; loginStatus.stringValue = "Needs macOS 13 or later."
        }
    }

    func controlTextDidChange(_ obj: Notification) { changed() }
    func textDidChange(_ notification: Notification) { changed() }

    @objc private func changed() {
        cfg.backend = Self.backends[backendPop.indexOfSelectedItem].0
        let key = apiKeyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        cfg.apiKey = key.isEmpty ? nil : key
        let mi = apiModelPop.indexOfSelectedItem
        if mi < Self.apiModels.count {
            cfg.apiModel = Self.apiModels[mi].0; customModelRow?.isHidden = true
        } else {
            customModelRow?.isHidden = false
            let custom = customModelField.stringValue.trimmingCharacters(in: .whitespaces)
            if !custom.isEmpty { cfg.apiModel = custom }
        }
        cfg.cliModel = Self.cliModels[cliModelPop.indexOfSelectedItem].0
        cfg.depth = ["quick", "balanced", "thorough"][max(0, depthSeg.selectedSegment)]
        let lang = languageField.stringValue.trimmingCharacters(in: .whitespaces)
        cfg.language = lang.isEmpty ? "auto" : lang
        let prompt = promptView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if !prompt.isEmpty { cfg.prompt = prompt }
        let hkText = hotkeyField.stringValue.trimmingCharacters(in: .whitespaces).lowercased()
        if let hk = Hotkey.parse(hkText) {
            cfg.hotkey = hkText
            hotkeyStatus.stringValue = hk.label; hotkeyStatus.textColor = .secondaryLabelColor
        } else {
            hotkeyStatus.stringValue = "Use modifiers + key, e.g. cmd+shift+a"; hotkeyStatus.textColor = .systemRed
        }
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            self.onChange(self.cfg)
        }
    }

    @objc private func testTapped() {
        saveTimer?.invalidate()
        onChange(cfg)
        testButton.isEnabled = false
        testStatus.stringValue = "Checking…"; testStatus.textColor = .secondaryLabelColor
        onTest(cfg) { [weak self] r in
            guard let self = self else { return }
            self.testButton.isEnabled = true
            switch r {
            case .success(let name): self.testStatus.stringValue = "✓ Connected · \(name). Press the hotkey on anything."; self.testStatus.textColor = .systemGreen
            case .failure(let e): self.testStatus.stringValue = e.localizedDescription; self.testStatus.textColor = .systemRed
            }
        }
    }

    @objc private func mediaToggled() {
        cfg.pauseMedia = mediaSwitch.state == .on
        if cfg.pauseMedia, !MediaControl.ensureTrusted() {
            mediaStatus.stringValue = "Allow SnapAsk under System Settings → Privacy & Security → Accessibility, then it can press the key."
        }
        saveTimer?.invalidate(); onChange(cfg)
    }

    @objc private func loginToggled() {
        guard #available(macOS 13.0, *) else { return }
        do {
            if loginSwitch.state == .on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginStatus.stringValue = loginSwitch.state == .on ? "SnapAsk will open when you log in." : "Adds SnapAsk to your Login Items."
            loginStatus.textColor = .secondaryLabelColor
        } catch {
            loginStatus.stringValue = error.localizedDescription; loginStatus.textColor = .systemRed
            loginSwitch.state = loginSwitch.state == .on ? .off : .on
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shared: AppDelegate!
    private var statusItem: NSStatusItem!
    private let panel = AnswerPanel()
    private var backend: Backend?
    private var config = Config.load()
    private var busy = false
    private var hotKeyRef: EventHotKeyRef?
    private var hotkeyHandlerInstalled = false
    private var settings: SettingsWindow?
    private var askItem: NSMenuItem?
    private var backendItem: NSMenuItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        AppDelegate.shared = self
        NSApp.setActivationPolicy(.accessory)
        if CommandLine.arguments.contains("--demo") { runDemo(); return }
        backend = makeBackend(config)
        log("backend: \(backend?.name ?? "none")")
        let hk = Hotkey.parse(config.hotkey) ?? Hotkey.parse("cmd+shift+a")!
        registerHotkey(hk)
        buildStatusItem(hotkeyLabel: hk.label)
        panel.onAsk = { [weak self] q in self?.ask(image: nil, question: q) }
        panel.onNewSelection = { [weak self] in self?.capture() }
        panel.onClose = { MediaControl.resumeIfPaused() }
        if backend == nil { openSettings() }
    }

    /// Called by the settings window on every change: persist, rebuild the backend, re-register the hotkey.
    func applyConfig(_ new: Config) {
        let hotkeyChanged = new.hotkey != config.hotkey
        config = new
        config.save()
        backend?.reset()
        backend = makeBackend(config)
        backendItem?.title = "Backend: \(backend?.name ?? "none")"
        if hotkeyChanged, let hk = Hotkey.parse(config.hotkey) {
            if registerHotkey(hk) { askItem?.title = "Ask about screen   \(hk.label)" }
        }
        log("settings applied: backend=\(config.backend) hotkey=\(config.hotkey) depth=\(config.depth)")
    }

    /// Text-only round trip used by the settings window's Connect button.
    func testBackend(_ cfg: Config, _ done: @escaping (Result<String, Error>) -> Void) {
        guard let b = makeBackend(cfg) else {
            done(.failure(BackendError.message(cfg.backend == "api" ? "Enter an API key first." : "Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code) and run `claude` once to log in, or switch to the API.")))
            return
        }
        b.ask(image: nil, question: "Reply with the single word OK.") { r in
            b.reset()
            DispatchQueue.main.async { done(r.map { _ in b.name }) }
        }
    }

    @objc func openSettings() {
        if settings == nil {
            settings = SettingsWindow(config: config,
                                      onChange: { [weak self] c in self?.applyConfig(c) },
                                      onTest: { [weak self] c, done in self?.testBackend(c, done) })
            settings?.center()
        }
        NSApp.activate(ignoringOtherApps: true)
        settings?.makeKeyAndOrderFront(nil)
    }

    private func buildStatusItem(hotkeyLabel: String) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let img = NSImage(systemSymbolName: "camera.viewfinder", accessibilityDescription: "SnapAsk") {
            img.isTemplate = true
            statusItem.button?.image = img
        } else {
            statusItem.button?.title = "SA"
        }
        let menu = NSMenu()
        let ask = NSMenuItem(title: "Ask about screen   \(hotkeyLabel)", action: #selector(captureFromMenu), keyEquivalent: "")
        ask.target = self
        menu.addItem(ask)
        askItem = ask
        let reopen = NSMenuItem(title: "Show last answer", action: #selector(showPanel), keyEquivalent: "")
        reopen.target = self
        menu.addItem(reopen)
        menu.addItem(.separator())
        let be = NSMenuItem(title: "Backend: \(backend?.name ?? "none")", action: nil, keyEquivalent: "")
        be.isEnabled = false
        menu.addItem(be)
        backendItem = be
        let cfg = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        cfg.target = self
        menu.addItem(cfg)
        let lg = NSMenuItem(title: "Show log", action: #selector(openLog), keyEquivalent: "")
        lg.target = self
        menu.addItem(lg)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit SnapAsk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    @discardableResult
    private func registerHotkey(_ hk: Hotkey) -> Bool {
        if let old = hotKeyRef { UnregisterEventHotKey(old); hotKeyRef = nil }
        if !hotkeyHandlerInstalled {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, _, _ -> OSStatus in
                DispatchQueue.main.async { AppDelegate.shared.capture() }
                return noErr
            }, 1, &spec, nil, nil)
            hotkeyHandlerInstalled = true
        }
        let id = EventHotKeyID(signature: OSType(0x534E4150), id: 1)   // "SNAP"
        let status = RegisterEventHotKey(hk.keyCode, hk.modifiers, id, GetApplicationEventTarget(), 0, &hotKeyRef)
        if status != noErr {
            log("hotkey registration failed (\(status)) for \(hk.label)")
            showAlert("Hotkey \(hk.label) is taken", "Pick another one in SnapAsk → Settings.")
            return false
        }
        log("hotkey \(hk.label) registered")
        return true
    }

    func applicationWillTerminate(_ notification: Notification) { backend?.reset() }

    @objc private func captureFromMenu() { capture() }
    @objc private func showPanel() { NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil) }
    @objc private func openLog() { NSWorkspace.shared.open(logURL) }

    /// Hotkey entry point: interactive region selection → image in memory → file deleted → ask.
    func capture() {
        guard !busy else { return }
        guard backend != nil else { openSettings(); return }
        if config.pauseMedia { MediaControl.pauseIfPlaying() }
        DispatchQueue.global(qos: .userInitiated).async {
            let path = FileManager.default.temporaryDirectory.appendingPathComponent("snapask-\(UUID().uuidString).png").path
            let r = run("/usr/sbin/screencapture", ["-i", "-x", "-t", "png", path])
            defer { try? FileManager.default.removeItem(atPath: path) }
            guard let data = FileManager.default.contents(atPath: path), !data.isEmpty else {
                log("capture cancelled (status \(r.status)) \(r.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
                DispatchQueue.main.async { if self.panel.isVisible == false { MediaControl.resumeIfPaused() } }
                return
            }
            log("captured \(data.count) bytes")
            DispatchQueue.main.async { self.startConversation(image: data) }
        }
    }

    private func startConversation(image: Data) {
        backend?.reset()
        panel.startNew(backendName: backend?.name ?? "", image: image)
        ask(image: image, question: config.prompt)
    }

    private func ask(image: Data?, question: String) {
        guard let backend = backend else { return }
        busy = true
        if image == nil { panel.setLoading(true, "Thinking…") }
        let started = Date()
        backend.ask(image: image, question: question) { result in
            DispatchQueue.main.async {
                self.busy = false
                let secs = String(format: "%.1fs", Date().timeIntervalSince(started))
                switch result {
                case .success(let text):
                    log("answered in \(secs)")
                    self.panel.showAnswer(text)
                    self.panel.setLoading(false, "\(backend.name) · \(secs)")
                case .failure(let err):
                    log("error: \(err.localizedDescription)")
                    self.panel.showError(err.localizedDescription)
                }
            }
        }
    }

    /// `SnapAsk --demo [dark]`: shows the panel with a canned answer so the design can be checked without a capture.
    private func runDemo() {
        NSApp.appearance = NSAppearance(named: CommandLine.arguments.contains("dark") ? .darkAqua : .aqua)
        if CommandLine.arguments.contains("settings") {
            let w = SettingsWindow(config: Config(), onChange: { _ in }, onTest: { _, done in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { done(.success("Demo backend")) }
            })
            w.center(); NSApp.activate(ignoringOtherApps: true); w.makeKeyAndOrderFront(nil)
            settings = w
            if let i = CommandLine.arguments.firstIndex(of: "--snapshot"), i + 1 < CommandLine.arguments.count {
                let path = CommandLine.arguments[i + 1]
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { renderSnapshot(of: w.inner, to: path); exit(0) }
            }
            return
        }
        let img = NSImage(size: NSSize(width: 300, height: 160), flipped: false) { r in
            NSGradient(colors: [NSColor(red: 0.12, green: 0.16, blue: 0.22, alpha: 1), NSColor(red: 0.07, green: 0.09, blue: 0.15, alpha: 1)])!.draw(in: r, angle: 135)
            ("▶ paused video" as NSString).draw(at: NSPoint(x: 90, y: 70), withAttributes: [.foregroundColor: NSColor.white, .font: NSFont.systemFont(ofSize: 16)])
            return true
        }
        panel.onAsk = { [weak self] q in
            self?.panel.setLoading(true, "Looking…")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self?.panel.showAnswer("Follow-up received: *\(q)*\n\nShort answer: yes.") }
        }
        panel.startNew(backendName: "Demo · Claude Opus 5", image: img.tiffRepresentation)
        panel.showAnswer("""
        **Chain rule** applies because `e^(2x)` is a *composition*: outer `e^u`, inner `u = 2x`.

        1. Differentiate the outer: `d/du e^u = e^u`
        2. Multiply by the inner's derivative: `d/dx (2x) = 2`

        ```
        d/dx e^(2x) = 2·e^(2x)
        ```

        - The "2" is the inner derivative you'd miss without the rule.
        - For plain `x²` there is no inner function, so no extra factor.
        """)
        panel.setLoading(false, "Demo · 1.2s")
        if let i = CommandLine.arguments.firstIndex(of: "--snapshot"), i + 1 < CommandLine.arguments.count {
            let path = CommandLine.arguments[i + 1]
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                if let v = self?.panel.inner { renderSnapshot(of: v, to: path) }
                exit(0)
            }
        }
        // Frame in screencapture coordinates (origin top-left of the main screen).
        let f = panel.frame, top = NSScreen.screens[0].frame.height
        if let i = CommandLine.arguments.firstIndex(of: "--snapshot"), i + 1 < CommandLine.arguments.count {
            let path = CommandLine.arguments[i + 1]
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                // Glass is composited by the window server and does not render offscreen; draw the content
                // layer over a stand-in backdrop so the layout can be checked.
                guard let v = self?.panel.inner, let layer = v.layer else { exit(2) }
                let scale: CGFloat = 2
                let w = Int(v.bounds.width * scale), h = Int(v.bounds.height * scale)
                guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(2) }
                ctx.scaleBy(x: scale, y: scale)
                let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                let g = NSGradient(colors: dark ? [NSColor(red: 0.16, green: 0.16, blue: 0.24, alpha: 1), NSColor(red: 0.08, green: 0.1, blue: 0.14, alpha: 1)]
                                                : [NSColor(red: 0.86, green: 0.88, blue: 0.98, alpha: 1), NSColor(red: 0.95, green: 0.9, blue: 0.98, alpha: 1)])!
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
                g.draw(in: v.bounds, angle: 135)
                NSGraphicsContext.restoreGraphicsState()
                v.displayIfNeeded()
                layer.render(in: ctx)
                if let img = ctx.makeImage() {
                    let rep = NSBitmapImageRep(cgImage: img)
                    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
                }
                exit(0)
            }
        }
        print("WINDOW \(panel.windowNumber) RECT \(Int(f.minX)),\(Int(top - f.maxY)),\(Int(f.width)),\(Int(f.height))"); fflush(stdout)
    }

    private func showAlert(_ title: String, _ text: String) {
        let a = NSAlert(); a.messageText = title; a.informativeText = text
        NSApp.activate(ignoringOtherApps: true); a.runModal()
    }
}

// MARK: - Entry point

// `SnapAsk --audio` prints whether audio is currently playing (CoreAudio check used by media pause).
if CommandLine.arguments.contains("--audio") {
    print(MediaControl.isAudioPlaying() ? "playing" : "silent"); exit(0)
}

// `SnapAsk --test image.png [question]` exercises the backend without the UI.
if CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "--test" {
    let cfg = Config.load()
    guard let backend = makeBackend(cfg) else { print("no backend available"); exit(1) }
    guard let img = FileManager.default.contents(atPath: CommandLine.arguments[2]) else { print("cannot read image"); exit(1) }
    let q = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : cfg.prompt
    print("backend: \(backend.name)")
    let sem = DispatchSemaphore(value: 0)
    backend.ask(image: img, question: q) { r in
        switch r {
        case .success(let t): print("--- answer ---\n\(t)")
        case .failure(let e): print("--- error ---\n\(e.localizedDescription)")
        }
        // follow-up round trip
        backend.ask(image: nil, question: "Reply with one word: what colour was the background of that screenshot?") { r2 in
            switch r2 {
            case .success(let t): print("--- follow-up ---\n\(t)")
            case .failure(let e): print("--- follow-up error ---\n\(e.localizedDescription)")
            }
            sem.signal()
        }
    }
    sem.wait()
    backend.reset()   // drop the test conversation's transcript
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
