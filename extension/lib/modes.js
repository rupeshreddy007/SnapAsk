// Answer modes: what SnapAsk asks by default, and how it picks a mode for the current site.
(function (global) {
  const ACTIONS = {
    explain:   { label: 'Explain',   prompt: 'Explain what is shown here. If it contains a question, answer it. If it is code or an error, explain it and give the fix.' },
    lecture:   { label: 'Explain',   prompt: 'This is a moment from a video lecture. Explain what is being shown at this point, answer any question on screen, and fill in the step a viewer might have missed.' },
    translate: { label: 'Translate', prompt: 'Translate all the text here into my language, then briefly explain anything that needs context.' },
    summarize: { label: 'Summarize', prompt: 'Summarize the key points here in a few short bullets.' },
    code:      { label: 'Code',      prompt: 'Explain this code. If there is a bug, an error or a bad practice, point it out and give the corrected code.' },
    simplify:  { label: 'Simplify',  prompt: 'Explain this simply, step by step, as if to a beginner.' },
  };
  const CHIPS = ['explain', 'translate', 'summarize', 'code', 'simplify'];   // shown in the card
  const CHOICES = ['explain', 'translate', 'summarize', 'code', 'simplify'];  // selectable as a site/default mode

  const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|udemy\.com|coursera\.org|vimeo\.com|twitch\.tv|edx\.org|khanacademy\.org|pluralsight\.com|skillshare\.com|netflix\.com)$/;
  const CODE_HOSTS = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com|stackexchange\.com|codesandbox\.io|codepen\.io|replit\.com|leetcode\.com|npmjs\.com|developer\.mozilla\.org|docs\.python\.org)$/;

  function normalizeHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }

  // Signals come from the page: {host, docLang, uiLang, hasPlayingVideo, hasVideo, codeHeavy, selectionInCode}
  function detect(sig) {
    sig = sig || {};
    if (sig.selectionInCode) return { mode: 'code', reason: 'code selected' };
    const host = normalizeHost(sig.host);
    if (sig.hasPlayingVideo || (sig.hasVideo && VIDEO_HOSTS.test(host))) return { mode: 'lecture', reason: 'video' };
    if (CODE_HOSTS.test(host) || sig.codeHeavy) return { mode: 'code', reason: 'code page' };
    const doc = String(sig.docLang || '').slice(0, 2).toLowerCase();
    const ui = String(sig.uiLang || '').slice(0, 2).toLowerCase();
    if (doc && ui && doc !== ui) return { mode: 'translate', reason: 'page is in ' + doc };
    return { mode: 'explain', reason: 'default' };
  }

  // Site override → default-mode setting → detection.
  function siteOverride(siteModes, host) {
    host = normalizeHost(host);
    if (!siteModes || !host) return null;
    if (siteModes[host]) return siteModes[host];
    const parent = Object.keys(siteModes).find(h => host.endsWith('.' + normalizeHost(h)));
    return parent ? siteModes[parent] : null;
  }
  function resolve(settings, sig) {
    settings = settings || {};
    const site = siteOverride(settings.siteModes, sig && sig.host);
    if (site && ACTIONS[site]) return { mode: site, reason: 'set for this site', auto: false };
    if (settings.defaultMode && settings.defaultMode !== 'auto' && ACTIONS[settings.defaultMode]) {
      return { mode: settings.defaultMode, reason: 'default mode', auto: false };
    }
    return Object.assign({ auto: true }, detect(sig));
  }

  global.SnapAskModes = { ACTIONS, CHIPS, CHOICES, detect, resolve, normalizeHost };
})(typeof self !== 'undefined' ? self : globalThis);
