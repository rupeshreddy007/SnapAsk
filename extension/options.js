const { PROVIDERS } = self.SnapAskProviders;
const MODES = self.SnapAskModes;
const $ = s => document.querySelector(s);
let settings = null;
let saveTimer = 0;

async function load() {
  settings = await chrome.runtime.sendMessage({ type: 'snapask:getSettings' });
  const params = new URLSearchParams(location.search);
  if (params.has('welcome') || params.has('setup') || !settings.onboarded) $('#welcome').hidden = false;
  $('#ver').textContent = chrome.runtime.getManifest().version;
  renderProviders();
  renderProviderFields();
  renderDepth();
  $('#language').value = settings.language === 'auto' ? '' : settings.language;
  renderModes();
  renderShortcut();
}

function save(flash = true) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ settings });
    if (flash) toast('Saved');
  }, 150);
}

function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 1200);
}

function renderProviders() {
  const seg = $('#providers'); seg.innerHTML = '';
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(id === settings.provider));
    b.addEventListener('click', () => { settings.provider = id; renderProviders(); renderProviderFields(); save(); });
    seg.appendChild(b);
  }
}

function renderProviderFields() {
  const p = PROVIDERS[settings.provider];
  $('#keyUrl').href = p.keyUrl;
  $('#apiKey').placeholder = p.keyHint;
  $('#apiKey').value = settings.keys[settings.provider] || '';
  $('#status').textContent = settings.keys[settings.provider] ? 'Key saved. Click Connect to verify it.' : '';
  $('#status').className = 'status';
  const sel = $('#model'); sel.innerHTML = '';
  const current = settings.models[settings.provider];
  let known = false;
  for (const m of p.models) {
    const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; if (m.id === current) { o.selected = true; known = true; }
    sel.appendChild(o);
  }
  const custom = document.createElement('option'); custom.value = '__custom'; custom.textContent = 'Custom model id…'; sel.appendChild(custom);
  if (!known) { custom.selected = true; $('#customModel').value = current; }
  $('#customModelField').hidden = known;
}

function renderModes() {
  const sel = $('#defaultMode'); sel.innerHTML = '';
  const auto = document.createElement('option'); auto.value = 'auto'; auto.textContent = 'Auto (detect from the page)'; sel.appendChild(auto);
  for (const k of MODES.CHOICES) { const o = document.createElement('option'); o.value = k; o.textContent = MODES.ACTIONS[k].label + ' everywhere'; sel.appendChild(o); }
  sel.value = settings.defaultMode || 'auto';
  $('#autoPause').checked = settings.autoPause !== false;
  const list = $('#siteModes'); list.innerHTML = '';
  const hosts = Object.keys(settings.siteModes || {}).sort();
  $('#noSites').hidden = hosts.length > 0;
  for (const h of hosts) {
    const li = document.createElement('li');
    const host = document.createElement('span'); host.className = 'host'; host.textContent = h;
    const mode = document.createElement('span'); mode.className = 'mode'; mode.textContent = (MODES.ACTIONS[settings.siteModes[h]] || {}).label || settings.siteModes[h];
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '✕'; rm.title = 'Remove';
    rm.addEventListener('click', () => { delete settings.siteModes[h]; renderModes(); save(); });
    li.append(host, mode, rm); list.appendChild(li);
  }
}

function renderDepth() {
  $('#depth').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.depth));
}

async function renderShortcut() {
  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find(x => x.name === 'capture');
    const text = c && c.shortcut ? c.shortcut : 'Not set (another extension may use Alt+Shift+A)';
    $('#shortcut').textContent = text; $('#kbd-shortcut').textContent = c && c.shortcut ? c.shortcut : 'the shortcut';
  } catch { $('#shortcut').textContent = 'Alt+Shift+A'; }
}

$('#apiKey').addEventListener('input', e => { settings.keys[settings.provider] = e.target.value.trim(); save(false); });
$('#toggleKey').addEventListener('click', () => { const i = $('#apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; });
$('#connect').addEventListener('click', async () => {
  const key = $('#apiKey').value.trim();
  const st = $('#status');
  if (!key) { st.textContent = 'Paste an API key first.'; st.className = 'status err'; return; }
  settings.keys[settings.provider] = key; save(false);
  $('#connect').disabled = true; st.textContent = 'Checking…'; st.className = 'status';
  const r = await chrome.runtime.sendMessage({ type: 'snapask:test', provider: settings.provider, apiKey: key, model: settings.models[settings.provider] });
  $('#connect').disabled = false;
  if (r && r.ok) {
    st.textContent = '✓ Connected. You are ready: press the shortcut on any page.'; st.className = 'status ok';
    settings.onboarded = true; save(false);
  } else {
    st.textContent = (r && r.error) || 'Could not connect.'; st.className = 'status err';
  }
});
$('#model').addEventListener('change', e => {
  if (e.target.value === '__custom') { $('#customModelField').hidden = false; $('#customModel').focus(); return; }
  $('#customModelField').hidden = true; settings.models[settings.provider] = e.target.value; save();
});
$('#customModel').addEventListener('input', e => { const v = e.target.value.trim(); if (v) { settings.models[settings.provider] = v; save(false); } });
$('#depth').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; settings.depth = b.dataset.v; renderDepth(); save(); });
$('#language').addEventListener('change', e => { settings.language = e.target.value.trim() || 'auto'; save(); });
$('#defaultMode').addEventListener('change', e => { settings.defaultMode = e.target.value; save(); });
$('#autoPause').addEventListener('change', e => { settings.autoPause = e.target.checked; save(); });
$('#changeShortcut').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

load();
