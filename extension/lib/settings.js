// Settings schema, merging, and the system prompt. Pure functions so they can be unit-tested
// outside the service worker.
(function (global) {
  const DEFAULTS = {
    provider: 'anthropic',
    keys: { anthropic: '', openai: '', gemini: '' },
    models: { anthropic: 'claude-opus-5', openai: 'gpt-5', gemini: 'gemini-2.5-flash' },
    depth: 'balanced',          // quick | balanced | thorough
    language: 'auto',
    onboarded: false,
    autoPause: true,            // pause playing <video> while the card is open
    defaultMode: 'auto',        // auto | explain | translate | summarize | code | simplify
    siteModes: {},              // hostname → mode
  };

  // Deep-merge stored settings over the defaults; unknown keys are kept, nested maps are filled in.
  function merge(stored) {
    const s = Object.assign({}, DEFAULTS, stored || {});
    s.keys = Object.assign({}, DEFAULTS.keys, (stored && stored.keys) || {});
    s.models = Object.assign({}, DEFAULTS.models, (stored && stored.models) || {});
    s.siteModes = Object.assign({}, (stored && stored.siteModes) || {});
    if (!['quick', 'balanced', 'thorough'].includes(s.depth)) s.depth = DEFAULTS.depth;
    return s;
  }

  const EFFORT = { quick: 'low', balanced: 'medium', thorough: 'high' };
  function effortFor(s) { return EFFORT[s.depth] || 'medium'; }

  function systemPrompt(s) {
    const depth = {
      quick: 'Keep it to a few sentences unless the content truly demands more.',
      balanced: 'Be concise but complete: lead with the answer, then only the context that matters.',
      thorough: 'Be thorough: cover reasoning, edge cases and alternatives.',
    }[s.depth] || '';
    const lang = s.language && s.language !== 'auto'
      ? 'Always answer in ' + s.language + '.'
      : 'Answer in the language the user writes in; if the user only sent the default request, use the main language of the image.';
    return [
      'You are SnapAsk, an assistant that answers questions about a region of the screen the user just selected: a paused video frame, a web page, a document, code, a chat, an error dialog.',
      'The first message may start with bracketed context: the page title and host, the user\'s language, and any text they selected instead of a screenshot. Use it; do not repeat it.',
      'Answer directly. Do not describe the image unless asked; focus on what the user needs to know.',
      'Use markdown lightly: short bullets, code blocks for code, bold for the key term. No headings unless the answer is long.',
      depth, lang,
    ].join(' ');
  }

  // What the content script is allowed to see: never the API keys.
  function publicView(s, providers) {
    const model = s.models[s.provider];
    const p = (providers && providers[s.provider]) || {};
    const label = (p.models || []).find(m => m.id === model);
    return {
      provider: s.provider,
      providerName: p.name || s.provider,
      model,
      modelLabel: label ? label.label.split(' · ')[0] : model,
      autoPause: s.autoPause !== false,
      defaultMode: s.defaultMode,
      siteModes: s.siteModes,
    };
  }

  global.SnapAskSettings = { DEFAULTS, merge, effortFor, systemPrompt, publicView };
})(typeof self !== 'undefined' ? self : globalThis);
