// node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
require('../lib/markdown.js');
require('../lib/providers.js');
const MD = globalThis.SnapAskMarkdown;
const P = globalThis.SnapAskProviders;

test('markdown escapes HTML from the model', () => {
  const html = MD.render('hello <img src=x onerror=alert(1)> **bold** `a<b`');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<code>a&lt;b</code>'));
});

test('markdown renders blocks and tolerates an unterminated fence', () => {
  const html = MD.render('# Title\n- one\n- two\n1. a\n2. b\n\n```js\nlet x = 1;\n');
  assert.ok(html.startsWith('<h2>Title</h2>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(html.includes('<ol><li>a</li><li>b</li></ol>'));
  assert.ok(html.includes('<pre><code data-lang="js">let x = 1;</code></pre>'));
});

function sseResponse(chunks) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function runWithFetch(provider, chunks, extra = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return sseResponse(chunks); };
  const deltas = [];
  const r = await P.streamAnswer({
    provider, apiKey: 'k', model: extra.model || 'm', system: 'sys', effort: 'medium',
    messages: [{ role: 'user', text: 'hi', image: { dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' } }],
    onDelta: t => deltas.push(t),
  });
  return { r, deltas, calls };
}

test('anthropic stream assembles text and sends the right shape', async () => {
  const { r, deltas, calls } = await runWithFetch('anthropic', [
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
  ], { model: 'claude-opus-5' });
  assert.equal(r.text, 'Hello'); assert.equal(r.stop, 'end_turn'); assert.deepEqual(deltas, ['Hel', 'lo']);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'claude-opus-5'); assert.equal(body.stream, true);
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.data, 'AAAA');
  assert.deepEqual(body.output_config, { effort: 'medium' });
  assert.equal(body.fallbacks, 'default');
  assert.equal(calls[0].init.headers['anthropic-dangerous-direct-browser-access'], 'true');
});

test('anthropic refusal becomes an error', async () => {
  await assert.rejects(runWithFetch('anthropic', [
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n',
  ]), /declined/);
});

test('openai stream', async () => {
  const { r, calls } = await runWithFetch('openai', [
    'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"B"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  ]);
  assert.equal(r.text, 'AB'); assert.equal(r.stop, 'stop');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].content[0].type, 'image_url');
});

test('gemini stream', async () => {
  const { r, calls } = await runWithFetch('gemini', [
    'data: {"candidates":[{"content":{"parts":[{"text":"Hi "}]}}]}\r\n\r\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"there"}]},"finishReason":"STOP"}]}\r\n\r\n',
  ]);
  assert.equal(r.text, 'Hi there'); assert.equal(r.stop, 'STOP');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/png');
  assert.ok(calls[0].url.includes(':streamGenerateContent?alt=sse'));
});

test('http errors are humanized', async () => {
  globalThis.fetch = async () => new Response('{"error":{"message":"bad key"}}', { status: 401 });
  await assert.rejects(P.streamAnswer({ provider: 'anthropic', apiKey: 'k', model: 'm', system: '', messages: [{ role: 'user', text: 'x' }] }),
    e => e.code === 'auth');
  globalThis.fetch = async () => new Response('{"error":{"message":"slow down"}}', { status: 429 });
  await assert.rejects(P.streamAnswer({ provider: 'openai', apiKey: 'k', model: 'm', system: '', messages: [{ role: 'user', text: 'x' }] }),
    e => e.code === 'rate' && /slow down/.test(e.message));
});

test('missing key is a config error before any network call', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  await assert.rejects(P.streamAnswer({ provider: 'gemini', apiKey: '', model: 'm', system: '', messages: [] }), e => e.code === 'auth');
});

require('../lib/modes.js');
const M = globalThis.SnapAskModes;

test('mode detection: video, code, language, default', () => {
  assert.equal(M.detect({ host: 'www.youtube.com', hasVideo: true }).mode, 'lecture');
  assert.equal(M.detect({ host: 'example.com', hasPlayingVideo: true }).mode, 'lecture');
  assert.equal(M.detect({ host: 'github.com' }).mode, 'code');
  assert.equal(M.detect({ host: 'blog.example', codeHeavy: true }).mode, 'code');
  assert.equal(M.detect({ host: 'blog.example', selectionInCode: true }).mode, 'code');
  assert.equal(M.detect({ host: 'lemonde.fr', docLang: 'fr-FR', uiLang: 'en-US' }).mode, 'translate');
  assert.equal(M.detect({ host: 'lemonde.fr', docLang: 'en', uiLang: 'en-US' }).mode, 'explain');
  assert.equal(M.detect({}).mode, 'explain');
});

test('mode resolution: site override beats default beats detection', () => {
  const s = { siteModes: { 'youtube.com': 'summarize', 'docs.example': 'simplify' }, defaultMode: 'auto' };
  assert.deepEqual(M.resolve(s, { host: 'www.youtube.com', hasVideo: true }).mode, 'summarize');
  assert.equal(M.resolve(s, { host: 'api.docs.example' }).mode, 'simplify');          // parent-domain override
  assert.equal(M.resolve(s, { host: 'github.com' }).mode, 'code');                     // detection
  assert.equal(M.resolve({ defaultMode: 'translate' }, { host: 'github.com' }).mode, 'translate');
  assert.equal(M.resolve({ defaultMode: 'bogus' }, { host: 'github.com' }).mode, 'code');
  assert.equal(M.resolve(s, { host: 'github.com' }).auto, true);
});

require('../lib/settings.js');
const S = globalThis.SnapAskSettings;

test('settings merge fills defaults, keeps user values, sanitizes depth', () => {
  const s = S.merge({ provider: 'gemini', keys: { gemini: 'k' }, depth: 'bogus', siteModes: { 'a.com': 'code' } });
  assert.equal(s.provider, 'gemini');
  assert.equal(s.keys.gemini, 'k'); assert.equal(s.keys.anthropic, '');
  assert.equal(s.models.anthropic, 'claude-opus-5');
  assert.equal(s.depth, 'balanced');
  assert.deepEqual(s.siteModes, { 'a.com': 'code' });
  assert.equal(S.merge(undefined).autoPause, true);
});

test('effort follows depth; system prompt reflects depth and language', () => {
  assert.equal(S.effortFor(S.merge({ depth: 'quick' })), 'low');
  assert.equal(S.effortFor(S.merge({ depth: 'thorough' })), 'high');
  assert.match(S.systemPrompt(S.merge({ depth: 'quick' })), /few sentences/);
  assert.match(S.systemPrompt(S.merge({ language: 'Telugu' })), /Always answer in Telugu/);
  assert.match(S.systemPrompt(S.merge({})), /language the user writes in/);
});

test('public view never exposes keys', () => {
  const v = S.publicView(S.merge({ keys: { anthropic: 'sk-secret' } }), P.PROVIDERS);
  assert.equal(JSON.stringify(v).includes('sk-secret'), false);
  assert.equal(v.modelLabel, 'Claude Opus 5');
  assert.equal(v.providerName, 'Anthropic · Claude');
});
