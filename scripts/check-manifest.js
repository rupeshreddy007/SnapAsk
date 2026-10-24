#!/usr/bin/env node
// Validates the extension manifest the way a Web Store reviewer would glance at it:
// files referenced exist, permissions stay minimal, version is semver.
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || 'extension');
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const errors = [];
const exists = f => fs.existsSync(path.join(dir, f));

if (m.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!/^\d+\.\d+\.\d+$/.test(m.version)) errors.push('version must be x.y.z');
if (!m.name || m.name.length > 75) errors.push('name missing or longer than 75 chars');
if (!m.description || m.description.length > 132) errors.push('description missing or longer than 132 chars');

const ALLOWED = new Set(['activeTab', 'scripting', 'storage']);
for (const p of m.permissions || []) if (!ALLOWED.has(p)) errors.push('unexpected permission: ' + p);
if ((m.host_permissions || []).some(h => h === '<all_urls>' || h.startsWith('*://'))) errors.push('broad host permission');
if (m.content_scripts) errors.push('content_scripts present: injection must stay on-demand (activeTab)');

const files = [m.background && m.background.service_worker, m.action && m.action.default_popup, m.options_ui && m.options_ui.page]
  .concat(Object.values(m.icons || {}), Object.values((m.action && m.action.default_icon) || {})).filter(Boolean);
for (const f of files) if (!exists(f)) errors.push('missing file: ' + f);

// Every lib the worker imports must exist.
const bg = fs.readFileSync(path.join(dir, m.background.service_worker), 'utf8');
for (const [, list] of bg.matchAll(/importScripts\(([^)]*)\)/g)) {
  for (const f of list.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, ''))) if (!exists(f)) errors.push('importScripts target missing: ' + f);
}
for (const [, f] of bg.matchAll(/files:\s*\[([^\]]*)\]/g)) {
  for (const x of f.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, ''))) if (x && !exists(x)) errors.push('executeScript file missing: ' + x);
}

if (errors.length) { console.error('manifest check failed:\n - ' + errors.join('\n - ')); process.exit(1); }
console.log('manifest ok: ' + m.name + ' v' + m.version + ' (permissions: ' + (m.permissions || []).join(', ') + ')');
