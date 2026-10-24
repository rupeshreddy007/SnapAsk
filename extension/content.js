// SnapAsk content script: region selector + floating answer card. Injected on demand
// (activeTab), lives in a shadow root so page CSS cannot touch it and vice-versa.
(() => {
  if (window.__snapask) return;
  window.__snapask = true;

  const MD = self.SnapAskMarkdown;
  const Z = 2147483647;
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .root {
      --fg:#0f1222; --muted:rgba(15,18,34,.62); --accent:#5b5bd6; --accent2:#a855f7; --err:#c81e1e;
      --glass:rgba(255,255,255,.55); --glass-top:rgba(255,255,255,.42); --stroke:rgba(255,255,255,.75); --edge:rgba(20,20,40,.10);
      --soft:rgba(255,255,255,.42); --soft-hover:rgba(255,255,255,.7); --code:rgba(255,255,255,.5); --divider:rgba(20,20,40,.08);
      --shadow:0 28px 80px rgba(20,20,60,.28), 0 2px 10px rgba(20,20,60,.08);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .root {
        --fg:#f4f4f9; --muted:rgba(244,244,249,.6); --err:#ff6b6b;
        --glass:rgba(22,22,32,.58); --glass-top:rgba(255,255,255,.07); --stroke:rgba(255,255,255,.16); --edge:rgba(0,0,0,.5);
        --soft:rgba(255,255,255,.07); --soft-hover:rgba(255,255,255,.14); --code:rgba(0,0,0,.32); --divider:rgba(255,255,255,.08);
        --shadow:0 28px 80px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.3);
      }
    }
    .glass { background: linear-gradient(160deg, var(--glass-top), transparent 45%), var(--glass);
             -webkit-backdrop-filter: blur(28px) saturate(190%); backdrop-filter: blur(28px) saturate(190%);
             border: 1px solid var(--stroke); box-shadow: var(--shadow), 0 0 0 1px var(--edge), inset 0 1px 0 rgba(255,255,255,.55); }
    @media (prefers-color-scheme: dark) { .glass { box-shadow: var(--shadow), 0 0 0 1px var(--edge), inset 0 1px 0 rgba(255,255,255,.12); } }

    /* ---- selection overlay ---- */
    .ovl { position: fixed; inset: 0; z-index: ${Z}; cursor: crosshair; pointer-events: auto; user-select: none; -webkit-user-select: none; touch-action: none; }
    .ovl .dim { position: absolute; inset: 0; background: rgba(8,10,24,.38); -webkit-backdrop-filter: blur(1.5px); backdrop-filter: blur(1.5px); transition: background .15s; }
    .ovl.active .dim { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
    .sel { position: absolute; display: none; border: 1.5px solid rgba(255,255,255,.95); border-radius: 6px;
           box-shadow: 0 0 0 1px rgba(91,91,214,.9), 0 0 0 100000px rgba(8,10,24,.45), inset 0 0 0 1px rgba(255,255,255,.35), 0 0 24px rgba(120,100,255,.35); }
    .sel .sz { position: absolute; right: 0; bottom: -30px; color: #fff; font: 11px/1 ui-monospace, Menlo, monospace; padding: 6px 9px; border-radius: 8px; white-space: nowrap;
               background: rgba(20,20,34,.6); -webkit-backdrop-filter: blur(16px) saturate(160%); backdrop-filter: blur(16px) saturate(160%);
               border: 1px solid rgba(255,255,255,.22); box-shadow: 0 6px 20px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.2); }
    .sel .sz.top { bottom: auto; top: -30px; }
    .hint { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px;
            display: flex; gap: 12px; align-items: center; pointer-events: none; animation: drop .25s cubic-bezier(.2,.8,.2,1);
            background: linear-gradient(160deg, rgba(255,255,255,.16), transparent 50%), rgba(20,20,34,.55);
            -webkit-backdrop-filter: blur(22px) saturate(170%); backdrop-filter: blur(22px) saturate(170%);
            border: 1px solid rgba(255,255,255,.22); box-shadow: 0 10px 40px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.25); }
    .hint b { font-weight: 650; }
    .hint kbd { background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.2); border-radius: 6px; padding: 2px 6px; font: 11px/1.2 ui-monospace, Menlo, monospace; }
    .hint .sep { opacity: .35; }
    @keyframes drop { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }

    /* ---- answer card ---- */
    .card { position: fixed; z-index: ${Z}; width: 400px; max-width: calc(100vw - 24px); max-height: min(72vh, 640px);
            display: flex; flex-direction: column; border-radius: 22px; pointer-events: auto; overflow: hidden;
            animation: pop .22s cubic-bezier(.2,.8,.2,1); }
    @keyframes pop { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
    .hd { display: flex; align-items: center; gap: 10px; padding: 11px 10px 11px 13px; border-bottom: 1px solid var(--divider); cursor: grab; }
    .hd:active { cursor: grabbing; }
    .thumb { width: 46px; height: 34px; object-fit: cover; border-radius: 9px; border: 1px solid var(--stroke); background: var(--soft); flex: none; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .quote { max-width: 150px; font-size: 11px; line-height: 1.3; color: var(--muted); font-style: italic; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; padding: 4px 8px; border-radius: 8px; background: var(--soft); border: 1px solid var(--stroke); flex: none; }
    .ttl { flex: 1; min-width: 0; }
    .ttl .n { font-weight: 650; font-size: 13px; letter-spacing: .1px; display: flex; align-items: center; gap: 6px; }
    .ttl .n i { width: 9px; height: 9px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 0 10px rgba(130,90,255,.6); display: inline-block; }
    .ttl .m { color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ic { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; color: var(--muted); font-size: 15px; transition: .12s; }
    .ic:hover { background: var(--soft-hover); color: var(--fg); }
    .ic:focus-visible { outline: 2px solid var(--accent); }
    .body { overflow-y: auto; padding: 4px 14px 6px; flex: 1; min-height: 60px; overscroll-behavior: contain; }
    .body::-webkit-scrollbar { width: 8px; } .body::-webkit-scrollbar-thumb { background: rgba(127,127,150,.35); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
    .q { display: inline-block; margin: 10px 0 2px; padding: 4px 11px; border-radius: 999px; background: var(--soft); border: 1px solid var(--stroke); color: var(--muted); font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .a { padding: 4px 0 8px; font-size: 14px; line-height: 1.55; word-wrap: break-word; }
    .a p { margin: 6px 0; } .a ul, .a ol { margin: 6px 0; padding-left: 20px; } .a li { margin: 2px 0; }
    .a h2, .a h3, .a h4 { margin: 10px 0 4px; font-size: 14px; font-weight: 650; }
    .a code { font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); border: 1px solid var(--stroke); border-radius: 6px; padding: 1px 5px; }
    .a pre { background: var(--code); border: 1px solid var(--stroke); border-radius: 12px; padding: 10px 12px; overflow-x: auto; margin: 8px 0; box-shadow: inset 0 1px 0 rgba(255,255,255,.35); }
    .a pre code { border: 0; padding: 0; background: none; white-space: pre; }
    .a blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--stroke); color: var(--muted); }
    .a a { color: var(--accent); }
    .a hr { border: 0; border-top: 1px solid var(--divider); margin: 10px 0; }
    .a.stream > :last-child::after { content: ""; display: inline-block; width: 8px; height: 14px; margin-left: 2px; vertical-align: -2px; border-radius: 2px;
                       background: linear-gradient(135deg, var(--accent), var(--accent2)); animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .think { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; padding: 10px 0 12px; }
    .think .dots i { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent2)); animation: bounce 1.1s infinite; }
    .think .dots i:nth-child(2) { animation-delay: .15s; } .think .dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
    .err { margin: 6px 0 10px; padding: 10px 12px; border-radius: 12px; background: rgba(220,38,38,.10); border: 1px solid rgba(220,38,38,.25); color: var(--err); font-size: 13px; display: flex; gap: 10px; align-items: center; }
    .err button { all: unset; cursor: pointer; font-weight: 600; text-decoration: underline; }
    .tools { display: flex; gap: 4px; align-items: center; margin: -4px 0 6px; }
    .tools button { all: unset; cursor: pointer; font-size: 11.5px; color: var(--muted); padding: 3px 9px; border-radius: 7px; }
    .tools button:hover { background: var(--soft-hover); color: var(--fg); }
    .chips { display: flex; gap: 6px; padding: 4px 12px 8px; overflow-x: auto; scrollbar-width: none; }
    .chips::-webkit-scrollbar { display: none; }
    .chip { all: unset; cursor: pointer; flex: none; font-size: 12px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--stroke); color: var(--fg); background: var(--soft);
            box-shadow: inset 0 1px 0 rgba(255,255,255,.45); transition: .12s; }
    .chip:hover { background: var(--soft-hover); border-color: rgba(91,91,214,.5); color: var(--accent); transform: translateY(-1px); }
    .tools .spacer { flex: 1; }
    .tools button.out { border: 1px dashed var(--stroke); }
    .tools button.out:hover { border-style: solid; color: var(--accent); }
    .ask { display: flex; align-items: center; gap: 8px; padding: 8px 10px 10px 12px; border-top: 1px solid var(--divider); }
    .ask input { all: unset; flex: 1; min-width: 0; font: inherit; color: var(--fg); padding: 8px 12px; border-radius: 12px; background: var(--soft); border: 1px solid var(--stroke); box-shadow: inset 0 1px 0 rgba(255,255,255,.4); transition: .12s; }
    .ask input::placeholder { color: var(--muted); }
    .ask input:focus { background: var(--soft-hover); border-color: rgba(91,91,214,.6); box-shadow: 0 0 0 3px rgba(91,91,214,.18); }
    .send { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; color: #fff; font-size: 16px; font-weight: 700;
            background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 6px 16px rgba(110,80,230,.35), inset 0 1px 0 rgba(255,255,255,.45); transition: .12s; }
    .send:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(110,80,230,.45), inset 0 1px 0 rgba(255,255,255,.45); }
    .toast { position: fixed; z-index: ${Z}; left: 50%; bottom: 28px; transform: translateX(-50%); color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 13px; animation: drop .2s; pointer-events: none;
             background: rgba(20,20,34,.6); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,.2); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `;

  let host = null, shadow = null, rootEl = null;
  const MODES = self.SnapAskModes;
  const state = { settings: null, image: null, selText: null, mode: null, messages: [], streaming: false, port: null, card: null, overlay: null, rect: null, pausedVideos: [] };

  // ---------- mounting (handles fullscreen video: the host must live inside the fullscreen element) ----------
  function mount() {
    const parent = document.fullscreenElement || document.documentElement;
    if (!host) {
      host = document.createElement('snapask-root');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:' + Z + ';pointer-events:none;';
      shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = CSS;
      rootEl = document.createElement('div'); rootEl.className = 'root';
      shadow.append(style, rootEl);
    }
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener('fullscreenchange', () => { if (host && host.isConnected) mount(); });

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function toast(msg) {
    const t = el('div', 'toast', msg); rootEl.appendChild(t); setTimeout(() => t.remove(), 1400);
  }

  // ---------- messages from the service worker ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'snapask:ping') { sendResponse({ ok: true }); return; }
    if (msg.type === 'snapask:start') {
      state.settings = msg.settings;
      const sel = msg.forceOverlay ? null : getTextSelection();
      if (sel) startFromSelection(sel); else startSelection();
      sendResponse({ ok: true });
    }
  });

  // ---------- page signals, modes, video pause ----------
  function getTextSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString().replace(/[ \t]+\n/g, '\n').trim();
    if (text.length < 4) return null;
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    if (host && host.contains(el)) return null;                       // selection inside our own card
    return { text: text.slice(0, 8000), rect: range.getBoundingClientRect(), inCode: !!(el && el.closest('pre, code, .highlight, .CodeMirror, .monaco-editor')) };
  }

  function pageSignals(sel) {
    const videos = [...document.querySelectorAll('video')];
    const big = v => { const r = v.getBoundingClientRect(); return r.width >= 200 && r.height >= 120; };
    return {
      host: location.hostname,
      docLang: document.documentElement.lang || (document.querySelector('meta[http-equiv="content-language"]') || {}).content || '',
      uiLang: navigator.language,
      hasVideo: videos.some(big),
      hasPlayingVideo: videos.some(v => big(v) && !v.paused && !v.ended),
      codeHeavy: document.querySelectorAll('pre, code').length >= 8,
      selectionInCode: !!(sel && sel.inCode),
    };
  }

  function resolveMode(sel) {
    const r = MODES.resolve(state.settings || {}, state.signals || pageSignals(sel));
    const a = MODES.ACTIONS[r.mode] || MODES.ACTIONS.explain;
    return { key: r.mode, label: a.label, prompt: a.prompt, auto: r.auto, reason: r.reason };
  }

  function pauseVideos() {
    if (state.settings && state.settings.autoPause === false) return;
    state.pausedVideos = [...document.querySelectorAll('video')].filter(v => !v.paused && !v.ended);
    for (const v of state.pausedVideos) { try { v.pause(); } catch { } }
  }
  function resumeVideos() {
    for (const v of state.pausedVideos) { if (v.isConnected && v.paused) { try { v.play().catch(() => { }); } catch { } } }
    state.pausedVideos = [];
  }

  // Context sent with the first question of a conversation.
  function firstPrompt(actionPrompt) {
    const lines = ['[Page: ' + (document.title || '').slice(0, 120) + ' — ' + location.hostname + ']', '[My language: ' + navigator.language + ']'];
    if (state.selText) lines.push('[Selected text]\n"""\n' + state.selText + '\n"""');
    return lines.join('\n') + '\n\n' + actionPrompt;
  }

  // Text selected on the page: no screenshot, no overlay.
  function startFromSelection(sel) {
    mount();
    removeCard();
    state.signals = pageSignals(sel);
    pauseVideos();
    state.image = null;
    state.selText = sel.text;
    state.messages = [];
    const m = resolveMode(sel); state.mode = m;
    const r = sel.rect;
    openCard({ x: r.left, y: r.top, w: r.width, h: r.height }, null, sel.text);
    ask(m.prompt, m.label + (m.auto ? '' : ' · site'));
  }

  // ---------- selection overlay ----------
  function startSelection() {
    mount();
    if (state.overlay) return;
    removeCard();
    state.signals = pageSignals(null);
    pauseVideos();
    const ovl = el('div', 'ovl');
    const dim = el('div', 'dim');
    const sel = el('div', 'sel');
    const sz = el('div', 'sz'); sel.appendChild(sz);
    const hint = el('div', 'hint');
    hint.innerHTML = '<span><b>Drag</b> over what you want to ask about</span><span class="sep">·</span><span><kbd>⏎</kbd> whole screen</span><span class="sep">·</span><span><kbd>Esc</kbd> cancel</span>';
    ovl.append(dim, sel, hint);
    rootEl.appendChild(ovl);
    state.overlay = ovl;

    let start = null, cur = null;
    const rectFrom = () => {
      const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
      return { x, y, w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
    };
    const paint = () => {
      const r = rectFrom();
      sel.style.display = 'block';
      sel.style.left = r.x + 'px'; sel.style.top = r.y + 'px'; sel.style.width = r.w + 'px'; sel.style.height = r.h + 'px';
      sz.textContent = Math.round(r.w) + ' × ' + Math.round(r.h);
      sz.classList.toggle('top', r.y + r.h + 30 > window.innerHeight);
    };
    const onDown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      start = cur = { x: e.clientX, y: e.clientY };
      ovl.classList.add('active'); hint.style.display = 'none';
      try { ovl.setPointerCapture(e.pointerId); } catch { }
      paint();
    };
    const onMove = e => { if (!start) return; cur = { x: e.clientX, y: e.clientY }; paint(); };
    const onUp = e => {
      if (!start) return;
      cur = { x: e.clientX, y: e.clientY };
      const r = rectFrom();
      start = null;
      if (r.w < 8 || r.h < 8) { cancel(); return; }        // a click, not a drag
      finish(clampRect(r));
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }); }
    };
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      ovl.remove(); state.overlay = null;
    };
    const cancel = () => { cleanup(); resumeVideos(); };
    const finish = async rect => {
      cleanup();
      // Let the page repaint without the overlay before the capture. rAF is the accurate signal,
      // but it never fires in a hidden tab, so a timer caps the wait.
      await Promise.race([
        new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))),
        new Promise(r => setTimeout(r, 150)),
      ]);
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'snapask:capture', rect, viewport: { w: window.innerWidth, h: window.innerHeight } });
      } catch (e) { res = { error: 'Could not reach SnapAsk. Try reloading the page.' }; }
      if (!res || res.error) { openCard(rect, null); showError(res ? res.error : 'Capture failed'); return; }
      state.image = res.image;
      state.selText = null;
      state.messages = [];
      const m = resolveMode(null); state.mode = m;
      openCard(rect, res.image);
      ask(m.prompt, m.label + (m.auto ? '' : ' · site'));
    };
    ovl.addEventListener('pointerdown', onDown);
    ovl.addEventListener('pointermove', onMove);
    ovl.addEventListener('pointerup', onUp);
    ovl.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey, true);
  }
  function clampRect(r) {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, w: Math.min(window.innerWidth - x, r.w), h: Math.min(window.innerHeight - y, r.h) };
  }

  // ---------- answer card ----------
  function openCard(rect, image, quote) {
    removeCard();
    state.rect = rect;
    const card = el('div', 'card glass');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'SnapAsk answer');
    const s = state.settings || { providerName: '', modelLabel: '' };
    card.innerHTML = `
      <div class="hd">
        <img class="thumb" alt="Selected area"><div class="quote" hidden></div>
        <div class="ttl"><div class="n"><i></i>SnapAsk</div><div class="m"></div></div>
        <button class="ic again" title="Select another area">⟲</button>
        <button class="ic close" title="Close (Esc)">✕</button>
      </div>
      <div class="body"><div class="msgs"></div></div>
      <div class="chips"></div>
      <form class="ask"><input type="text" placeholder="Ask a follow-up…" autocomplete="off" aria-label="Follow-up question"><button class="send" type="submit" title="Send">↑</button></form>
      <div class="sr" aria-live="polite"></div>`;
    const thumb = card.querySelector('.thumb');
    if (image) { thumb.src = image.dataUrl; thumb.title = image.width + ' × ' + image.height; } else thumb.style.display = 'none';
    if (quote) { const q = card.querySelector('.quote'); q.textContent = '“' + quote.replace(/\s+/g, ' ').slice(0, 70) + (quote.length > 70 ? '…' : '') + '”'; q.title = quote.slice(0, 500); q.hidden = false; }
    card.querySelector('.m').textContent = s.modelLabel ? s.providerName.split(' · ')[0] + ' · ' + s.modelLabel : '';
    const chips = card.querySelector('.chips');
    for (const k of MODES.CHIPS) {
      const a = MODES.ACTIONS[k];
      const b = el('button', 'chip', a.label); b.type = 'button';
      b.addEventListener('click', () => ask(a.prompt, a.label));
      chips.appendChild(b);
    }

    card.querySelector('.close').addEventListener('click', closeCard);
    card.querySelector('.again').title = 'Select an area of the screen';
    card.querySelector('.again').addEventListener('click', () => { closeCard(); startSelection(); });
    const form = card.querySelector('form'), input = card.querySelector('input');
    form.addEventListener('submit', e => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ''; ask(q, null); });
    card.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeCard(); } e.stopPropagation(); });
    card.addEventListener('keyup', e => e.stopPropagation());
    card.addEventListener('keypress', e => e.stopPropagation());
    makeDraggable(card, card.querySelector('.hd'));
    rootEl.appendChild(card);
    state.card = card;
    positionCard(card, rect);
    input.focus({ preventScroll: true });
  }

  function positionCard(card, rect) {
    const vw = window.innerWidth, vh = window.innerHeight, m = 12;
    const cw = Math.min(400, vw - 2 * m);
    const ch = Math.min(card.offsetHeight || 320, vh - 2 * m);
    let x, y;
    if (!rect) { x = vw - cw - 20; y = vh - ch - 20; }
    else if (rect.y + rect.h + m + ch <= vh) { x = rect.x; y = rect.y + rect.h + m; }        // below
    else if (rect.y - m - ch >= 0) { x = rect.x; y = rect.y - m - ch; }                        // above
    else if (rect.x + rect.w + m + cw <= vw) { x = rect.x + rect.w + m; y = rect.y; }           // right
    else if (rect.x - m - cw >= 0) { x = rect.x - m - cw; y = rect.y; }                         // left
    else { x = vw - cw - 20; y = vh - ch - 20; }
    x = Math.max(m, Math.min(x, vw - cw - m)); y = Math.max(m, Math.min(y, vh - ch - m));
    card.style.left = x + 'px'; card.style.top = y + 'px';
  }

  // The card grows while streaming; keep it inside the viewport as it does.
  function clampCard() {
    const card = state.card; if (!card) return;
    const m = 12, vh = window.innerHeight, vw = window.innerWidth;
    const top = Math.max(m, Math.min(card.offsetTop, vh - card.offsetHeight - m));
    const left = Math.max(m, Math.min(card.offsetLeft, vw - card.offsetWidth - m));
    if (top !== card.offsetTop) card.style.top = top + 'px';
    if (left !== card.offsetLeft) card.style.left = left + 'px';
  }
  window.addEventListener('resize', () => clampCard());

  function makeDraggable(card, handle) {
    let drag = null;
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      drag = { dx: e.clientX - card.offsetLeft, dy: e.clientY - card.offsetTop };
      handle.setPointerCapture(e.pointerId); e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if (!drag) return;
      const x = Math.max(0, Math.min(e.clientX - drag.dx, window.innerWidth - card.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - drag.dy, window.innerHeight - 40));
      card.style.left = x + 'px'; card.style.top = y + 'px';
    });
    handle.addEventListener('pointerup', () => { drag = null; });
  }

  function removeCard() {
    stopStream();
    if (state.card) { state.card.remove(); state.card = null; }
  }
  function closeCard() {
    removeCard();
    resumeVideos();
  }

  function setBusy(on) {
    if (!state.card) return;
    state.card.querySelector('.send').textContent = on ? '…' : '↑';
  }

  function showError(message, code) {
    if (!state.card) return;
    const box = el('div', 'err');
    box.append(el('span', null, message));
    if (code === 'auth' || code === 'config' || code === 'model') {
      const b = el('button', null, 'Open settings'); b.type = 'button';
      b.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'snapask:openOptions' }));
      box.appendChild(b);
    }
    state.card.querySelector('.msgs').appendChild(box);
    scrollBottom();
  }

  function scrollBottom(force) {
    const body = state.card && state.card.querySelector('.body');
    if (!body) return;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    if (force || nearBottom) body.scrollTop = body.scrollHeight;
  }

  // ---------- hand off to ChatGPT / Claude (user's own login, conversation lives there) ----------
  async function pngBlob(image) {
    const blob = await (await fetch(image.dataUrl)).blob();
    if (blob.type === 'image/png') return blob;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  function handoffText() {
    const q = state.lastQuestion || MODES.ACTIONS.explain.prompt;
    let t = '';
    if (state.selText) t += 'From ' + location.hostname + ' (' + (document.title || '').slice(0, 80) + '):\n"""\n' + state.selText + '\n"""\n\n';
    else if (state.image) t += 'About the screenshot I am pasting (from ' + location.hostname + '): ';
    return t + q;
  }

  async function handoff(target) {
    const text = handoffText();
    const hasImage = !!state.image;
    let copied = false;
    if (hasImage) {
      try {
        const blob = await pngBlob(state.image);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copied = true;
      } catch (e) { console.warn('SnapAsk: clipboard write failed', e); }
    }
    const url = target === 'chatgpt'
      ? 'https://chatgpt.com/?q=' + encodeURIComponent(text)
      : 'https://claude.ai/new?q=' + encodeURIComponent(text);
    // Opened from the page (cross-site navigation) so chatgpt.com prefills instead of auto-sending.
    window.open(url, '_blank', 'noopener');
    const pasteKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';
    if (hasImage) toast(copied ? 'Screenshot copied. Press ' + pasteKey + ' there, then Enter.' : 'Could not copy the screenshot; the question was sent.');
  }

  // ---------- asking ----------
  function stopStream() {
    if (state.port) { try { state.port.disconnect(); } catch { } state.port = null; }
    if (state.finishCurrent) { const f = state.finishCurrent; state.finishCurrent = null; f(); }
    state.streaming = false;
  }

  function ask(text, label) {
    if (!state.card) return;
    if (state.streaming) stopStream();           // a new question interrupts the current answer
    const msgs = state.card.querySelector('.msgs');
    const first = state.messages.length === 0;
    state.lastQuestion = text;
    const userMsg = { role: 'user', text: first ? firstPrompt(text) : text, image: first ? state.image : null };
    state.messages.push(userMsg);
    const q = el('div', 'q', label || text); q.title = text; msgs.appendChild(q);
    const think = el('div', 'think'); think.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span>Looking…</span>'; msgs.appendChild(think);
    const a = el('div', 'a stream'); a.style.display = 'none'; msgs.appendChild(a);
    const asst = { role: 'assistant', text: '' };
    state.streaming = true; setBusy(true); scrollBottom(true);

    let port;
    try { port = chrome.runtime.connect({ name: 'snapask:ask' }); }
    catch (e) { think.remove(); showError('SnapAsk was updated or reloaded. Please reload this page.'); state.streaming = false; setBusy(false); return; }
    state.port = port;
    state.finishCurrent = () => finish();
    let timer = 0;
    const paint = () => { timer = 0; a.innerHTML = MD.render(asst.text); clampCard(); scrollBottom(); };
    const finish = () => {
      if (state.finishCurrent === finish) state.finishCurrent = null;
      if (timer) clearTimeout(timer);
      if (think.isConnected) think.remove();
      a.innerHTML = MD.render(asst.text); a.classList.remove('stream'); a.style.display = '';
      if (!asst.text) a.remove();
      state.streaming = false; state.port = null; setBusy(false);
      if (asst.text) {
        state.messages.push(asst);
        const tools = el('div', 'tools');
        for (const [key, label, tip] of [['chatgpt', 'ChatGPT ↗', 'Continue in ChatGPT with your own login; the chat is saved there'],
                                         ['claude', 'Claude ↗', 'Continue in Claude with your own login; the chat is saved there']]) {
          const b = el('button', 'out', label); b.type = 'button'; b.title = tip;
          b.addEventListener('click', () => handoff(key));
          tools.appendChild(b);
        }
        tools.appendChild(el('span', 'spacer'));
        const copy = el('button', null, 'Copy'); copy.type = 'button';
        copy.addEventListener('click', () => navigator.clipboard.writeText(asst.text).then(() => toast('Copied')));
        tools.appendChild(copy); msgs.appendChild(tools);
        state.card.querySelector('.sr').textContent = asst.text.slice(0, 500);
      }
      const input = state.card.querySelector('input'); if (input) input.focus({ preventScroll: true });
      clampCard();
      scrollBottom();
    };
    port.onMessage.addListener(m => {
      if (m.type === 'delta') {
        if (think.isConnected) { think.remove(); a.style.display = ''; }
        asst.text += m.text;
        if (!timer) timer = setTimeout(paint, 40);
      } else if (m.type === 'done') {
        think.remove(); a.style.display = ''; finish();
      } else if (m.type === 'error') {
        think.remove(); if (!asst.text) a.remove(); finish();
        if (!asst.text) state.messages.pop();          // keep the thread consistent
        showError(m.message, m.code);
      }
    });
    port.onDisconnect.addListener(() => {
      if (state.streaming && state.port === port) { think.remove(); finish(); if (!asst.text) { state.messages.pop(); showError('Connection to SnapAsk was lost. Try again.'); } }
    });
    port.postMessage({ type: 'ask', messages: state.messages.map(({ role, text, image }) => ({ role, text, image })) });
  }
})();
