#!/usr/bin/env node
// Regenerates docs/images/*.png from the test harnesses using headless Chrome (macOS path by default).
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.resolve(__dirname, '..');
const server = spawn('python3', ['-m', 'http.server', '8766', '--directory', path.join(root, 'extension')], { stdio: 'ignore' });
const shots = [
  ['card-light.png', '1280,820', 'test/harness.html?fast=1&demo=card'],
  ['card-text.png', '1280,820', 'test/harness.html?fast=1&demo=text'],
  ['overlay.png', '1280,820', 'test/harness.html?fast=1&demo=overlay'],
  ['popup.png', '900,560', 'test/popup-harness.html'],
  ['options.png', '1000,1500', 'test/options-harness.html'],
];
setTimeout(() => {
  for (const [file, size, url] of shots) {
    const out = path.join(root, 'docs/images', file);
    spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=' + size, '--virtual-time-budget=12000',
      '--screenshot=' + out, 'http://localhost:8766/' + url], { stdio: 'ignore' });
    console.log('wrote', file);
  }
  server.kill();
}, 800);
