// Provider adapters. Neutral message format in: [{role:'user'|'assistant', text, image?:{dataUrl, mediaType}}].
// Streams text deltas out. Anthropic is the default; OpenAI and Gemini are supported for users who already hold those keys.
(function (global) {
  const PROVIDERS = {
    anthropic: {
      name: 'Anthropic · Claude',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      keyHint: 'sk-ant-…',
      models: [
        { id: 'claude-opus-5', label: 'Claude Opus 5 · most capable' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · fast and smart' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fastest' },
      ],
    },
    openai: {
      name: 'OpenAI',
      keyUrl: 'https://platform.openai.com/api-keys',
      keyHint: 'sk-…',
      models: [
        { id: 'gpt-5', label: 'GPT-5' },
        { id: 'gpt-5-mini', label: 'GPT-5 mini' },
        { id: 'gpt-4.1', label: 'GPT-4.1' },
      ],
    },
    gemini: {
      name: 'Google · Gemini',
      keyUrl: 'https://aistudio.google.com/apikey',
      keyHint: 'AIza…',
      models: [
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
    },
  };

  class ProviderError extends Error {
    constructor(message, code) { super(message); this.code = code || 'error'; }
  }

  function b64(image) { return image.dataUrl.slice(image.dataUrl.indexOf(',') + 1); }

  const build = {
    anthropic({ apiKey, model, system, messages, effort }) {
      const headers = {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      const body = {
        model, max_tokens: 16000, stream: true, system,
        messages: messages.map(m => ({
          role: m.role,
          content: m.image
            ? [{ type: 'image', source: { type: 'base64', media_type: m.image.mediaType, data: b64(m.image) } }, { type: 'text', text: m.text }]
            : m.text,
        })),
      };
      if (!/haiku/.test(model)) body.output_config = { effort };
      if (/claude-(opus-5|fable)/.test(model)) {          // server-side refusal fallback
        body.fallbacks = 'default';
        headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      }
      return { url: 'https://api.anthropic.com/v1/messages', headers, body };
    },
    openai({ apiKey, model, system, messages }) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: {
          model, stream: true,
          messages: [{ role: 'system', content: system }].concat(messages.map(m => ({
            role: m.role,
            content: m.image
              ? [{ type: 'image_url', image_url: { url: m.image.dataUrl } }, { type: 'text', text: m.text }]
              : m.text,
          }))),
        },
      };
    },
    gemini({ apiKey, model, system, messages }) {
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: (m.image ? [{ inlineData: { mimeType: m.image.mediaType, data: b64(m.image) } }] : []).concat([{ text: m.text }]),
          })),
        },
      };
    },
  };

  // Returns {text?, stop?, error?, done?} for one SSE event.
  const extract = {
    anthropic(ev) {
      if (ev.data === '[DONE]') return { done: true };
      let d; try { d = JSON.parse(ev.data); } catch { return {}; }
      switch (d.type || ev.event) {
        case 'content_block_delta': return d.delta && d.delta.type === 'text_delta' ? { text: d.delta.text } : {};
        case 'message_delta':
          if (d.delta && d.delta.stop_reason === 'refusal') return { error: new ProviderError('The model declined to answer this request.', 'refusal') };
          return { stop: d.delta && d.delta.stop_reason };
        case 'message_stop': return { done: true };
        case 'error': return { error: new ProviderError((d.error && d.error.message) || 'Stream error', 'stream') };
        default: return {};
      }
    },
    openai(ev) {
      if (ev.data === '[DONE]') return { done: true };
      let d; try { d = JSON.parse(ev.data); } catch { return {}; }
      if (d.error) return { error: new ProviderError(d.error.message || 'Stream error', 'stream') };
      const c = d.choices && d.choices[0];
      if (!c) return {};
      return { text: (c.delta && c.delta.content) || '', stop: c.finish_reason || undefined };
    },
    gemini(ev) {
      let d; try { d = JSON.parse(ev.data); } catch { return {}; }
      if (d.error) return { error: new ProviderError(d.error.message || 'Stream error', 'stream') };
      if (d.promptFeedback && d.promptFeedback.blockReason) return { error: new ProviderError('Blocked: ' + d.promptFeedback.blockReason, 'refusal') };
      const c = d.candidates && d.candidates[0];
      if (!c) return {};
      const text = ((c.content && c.content.parts) || []).map(p => p.text || '').join('');
      return { text, stop: c.finishReason || undefined };
    },
  };

  // Parses a text/event-stream body into {event, data} objects.
  async function* sseEvents(response) {
    const reader = response.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const ev = { event: null, data: [] };
        for (const line of raw.split(/\r?\n/)) {
          if (line.startsWith('event:')) ev.event = line.slice(6).trim();
          else if (line.startsWith('data:')) ev.data.push(line.slice(5).replace(/^ /, ''));
        }
        if (ev.data.length) yield { event: ev.event, data: ev.data.join('\n') };
      }
    }
  }

  async function describeError(provider, res) {
    let msg = '';
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.type)) || j.message || ''; } catch { }
    const s = res.status;
    if (s === 401 || s === 403) return new ProviderError('Your API key was rejected. Check it in SnapAsk settings.', 'auth');
    if (s === 429) return new ProviderError('Rate limited or out of credits. Try again in a moment.' + (msg ? ' (' + msg + ')' : ''), 'rate');
    if (s === 404) return new ProviderError('Model not found: ' + msg, 'model');
    if (s >= 500) return new ProviderError('The provider is having trouble (' + s + '). Try again.', 'server');
    return new ProviderError((msg || 'Request failed') + ' (' + s + ')', 'request');
  }

  // Streams one answer. onDelta(text) is called for each chunk. Resolves {text, stop}.
  async function streamAnswer({ provider, apiKey, model, system, messages, effort = 'medium', onDelta, signal }) {
    if (!build[provider]) throw new ProviderError('Unknown provider: ' + provider, 'config');
    if (!apiKey) throw new ProviderError('No API key set. Open SnapAsk settings to add one.', 'auth');
    const req = build[provider]({ apiKey, model, system, messages, effort });
    let res;
    try {
      res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ProviderError('Could not reach ' + PROVIDERS[provider].name + '. Check your connection.', 'network');
    }
    if (!res.ok) throw await describeError(provider, res);
    let text = '', stop = null;
    for await (const ev of sseEvents(res)) {
      const piece = extract[provider](ev);
      if (piece.error) throw piece.error;
      if (piece.text) { text += piece.text; onDelta && onDelta(piece.text); }
      if (piece.stop) stop = piece.stop;
      if (piece.done) break;
    }
    return { text, stop };
  }

  global.SnapAskProviders = { PROVIDERS, ProviderError, streamAnswer, sseEvents, extract, build };
})(typeof self !== 'undefined' ? self : globalThis);
