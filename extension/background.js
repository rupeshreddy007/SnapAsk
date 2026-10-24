// SnapAsk service worker: shortcut/icon → inject content script → capture & crop → stream answer.
importScripts('lib/providers.js', 'lib/crop.js', 'lib/modes.js', 'lib/settings.js');

const { PROVIDERS, streamAnswer, ProviderError } = self.SnapAskProviders;
const { cropCapture } = self.SnapAskCrop;

const { merge, effortFor, systemPrompt, publicView } = self.SnapAskSettings;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return merge(settings);
}
function publicSettings(s) { return publicView(s, PROVIDERS); }


// ---------- Triggers ----------

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') });
});
// The toolbar icon opens popup.html; it asks for a capture via 'snapask:captureCurrentTab'.
chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === 'capture') startCapture(tab); });

// Without the "tabs" permission tab.url may be undefined; in that case just try.
function isInjectable(url) {
  if (!url) return true;
  return /^(https?|file):/.test(url) && !/^https:\/\/chromewebstore\.google\.com/.test(url);
}

async function flashBadge(text, title) {
  await chrome.action.setBadgeBackgroundColor({ color: '#d9534f' });
  await chrome.action.setBadgeText({ text });
  if (title) await chrome.action.setTitle({ title });
  setTimeout(async () => {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'SnapAsk — select an area and ask (Alt+Shift+A)' });
  }, 2500);
}

async function ping(tabId) {
  try { const r = await chrome.tabs.sendMessage(tabId, { type: 'snapask:ping' }); return !!(r && r.ok); }
  catch { return false; }
}

async function startCapture(tab) {
  if (!tab || !tab.id) return;
  const settings = await getSettings();
  if (!settings.keys[settings.provider]) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?setup=1') });
    return;
  }
  if (!isInjectable(tab.url)) {
    flashBadge('!', 'SnapAsk cannot run on this page (browser pages, the Web Store and PDFs are off-limits to extensions).');
    return;
  }
  try {
    if (!(await ping(tab.id))) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/markdown.js', 'lib/modes.js', 'content.js'] });
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'snapask:start', settings: publicSettings(settings) });
  } catch (e) {
    console.warn('SnapAsk: could not start on this tab', e);
    flashBadge('!', 'SnapAsk cannot run on this page. Try reloading it.');
  }
}

// ---------- One-shot messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'snapask:capture') {
    (async () => {
      try {
        const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
        const image = await cropCapture(shot, msg.rect, msg.viewport);
        sendResponse({ image });
      } catch (e) {
        sendResponse({ error: 'Could not capture the screen: ' + (e.message || e) });
      }
    })();
    return true;
  }
  if (msg && msg.type === 'snapask:openOptions') { chrome.runtime.openOptionsPage(); return; }
  if (msg && msg.type === 'snapask:captureCurrentTab') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { sendResponse({ error: 'No active tab.' }); return; }
      if (tab.url && !isInjectable(tab.url)) { sendResponse({ error: 'SnapAsk cannot run on this page (browser pages, the Web Store and PDFs are off-limits to extensions).' }); return; }
      sendResponse({ ok: true });
      await startCapture(tab);
    })();
    return true;
  }
  if (msg && msg.type === 'snapask:test') {
    (async () => {
      try {
        const r = await streamAnswer({
          provider: msg.provider, apiKey: msg.apiKey, model: msg.model, effort: 'low',
          system: 'Reply with the single word OK.',
          messages: [{ role: 'user', text: 'Reply with the single word OK.' }],
        });
        sendResponse({ ok: true, text: r.text });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e), code: e.code });
      }
    })();
    return true;
  }
  if (msg && msg.type === 'snapask:getSettings') { getSettings().then(s => sendResponse(s)); return true; }
});

// ---------- Streaming answers over a port ----------

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'snapask:ask') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async msg => {
    if (!msg || msg.type !== 'ask') return;
    const s = await getSettings();
    const post = m => { try { port.postMessage(m); } catch { controller.abort(); } };
    try {
      const r = await streamAnswer({
        provider: s.provider, apiKey: s.keys[s.provider], model: s.models[s.provider],
        system: systemPrompt(s), messages: msg.messages, effort: effortFor(s),
        signal: controller.signal,
        onDelta: text => post({ type: 'delta', text }),
      });
      post({ type: 'done', stop: r.stop });
    } catch (e) {
      if (e.name === 'AbortError') return;
      post({ type: 'error', message: e.message || String(e), code: e.code || 'error' });
    }
  });
});
