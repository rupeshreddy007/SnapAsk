const { PROVIDERS } = self.SnapAskProviders;
const MODES = self.SnapAskModes;
const $ = s => document.querySelector(s);
let settings = null, saveTimer = 0, siteHost = null;

async function load() {
  settings = await chrome.runtime.sendMessage({ type: 'snapask:getSettings' });
  renderProviders(); renderProviderFields(); renderDepth();
  $('#autoPause').checked = settings.autoPause !== false;
  $('#language').value = settings.language === 'auto' ? '' : settings.language;
  await renderSiteMode();
  try {
    const c = (await chrome.commands.getAll()).find(x => x.name === 'capture');
    $('#shortcutHint').textContent = c && c.shortcut ? 'or press ' + c.shortcut + ' on any page' : 'set a shortcut in All settings';
  } catch { }
}

function save(flash = true) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { await chrome.storage.local.set({ settings }); if (flash) toast('Saved'); }, 120);
}
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 1000);
}

function renderProviders() {
  const seg = $('#providers'); seg.innerHTML = '';
  const short = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
  for (const id of Object.keys(PROVIDERS)) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = short[id] || PROVIDERS[id].name;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(id === settings.provider));
    b.addEventListener('click', () => { settings.provider = id; renderProviders(); renderProviderFields(); save(); });
    seg.appendChild(b);
  }
}

function renderProviderFields() {
  const p = PROVIDERS[settings.provider];
  const hasKey = !!settings.keys[settings.provider];
  const st = $('#keyStatus');
  st.textContent = hasKey ? '✓ Key saved' : 'No key for ' + p.name.split(' · ')[0];
  st.className = 'status ' + (hasKey ? 'ok' : 'err');
  $('#addKey').textContent = hasKey ? 'Change' : 'Add key';
  const sel = $('#model'); sel.innerHTML = '';
  const current = settings.models[settings.provider];
  let known = false;
  for (const m of p.models) {
    const o = document.createElement('option'); o.value = m.id; o.textContent = m.label.split(' · ')[0];
    if (m.id === current) { o.selected = true; known = true; }
    sel.appendChild(o);
  }
  if (!known) { const o = document.createElement('option'); o.value = current; o.textContent = current; o.selected = true; sel.appendChild(o); }
}

// Per-site answer mode for the tab the popup was opened on.
async function renderSiteMode() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab && tab.url ? new URL(tab.url) : null;
    if (!url || !/^https?:$/.test(url.protocol)) return;
    siteHost = MODES.normalizeHost(url.hostname);
  } catch { return; }
  const sel = $('#siteMode'); sel.innerHTML = '';
  const auto = document.createElement('option'); auto.value = 'auto'; auto.textContent = 'Auto (detect)'; sel.appendChild(auto);
  for (const k of MODES.CHOICES) { const o = document.createElement('option'); o.value = k; o.textContent = MODES.ACTIONS[k].label; sel.appendChild(o); }
  sel.value = (settings.siteModes || {})[siteHost] || 'auto';
  $('#siteRow').hidden = false;
  $('#siteRow .label').title = siteHost;
}

function renderDepth() {
  $('#depth').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.depth));
}

function openOptions(e) { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); }
$('#openOptions').addEventListener('click', openOptions);
$('#openOptions2').addEventListener('click', openOptions);
$('#addKey').addEventListener('click', openOptions);
$('#model').addEventListener('change', e => { settings.models[settings.provider] = e.target.value; save(); });
$('#depth').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings.depth = b.dataset.v; renderDepth(); save(); });
$('#language').addEventListener('change', e => { settings.language = e.target.value.trim() || 'auto'; save(); });
$('#autoPause').addEventListener('change', e => { settings.autoPause = e.target.checked; save(); });
$('#siteMode').addEventListener('change', e => {
  if (!siteHost) return;
  settings.siteModes = settings.siteModes || {};
  if (e.target.value === 'auto') delete settings.siteModes[siteHost]; else settings.siteModes[siteHost] = e.target.value;
  save();
});

$('#capture').addEventListener('click', async () => {
  if (!settings.keys[settings.provider]) { openOptions(new Event('click')); return; }
  const r = await chrome.runtime.sendMessage({ type: 'snapask:captureCurrentTab' });
  if (r && r.error) { const n = $('#captureNote'); n.textContent = r.error; n.hidden = false; return; }
  window.close();
});

load();
