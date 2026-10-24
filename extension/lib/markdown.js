// Minimal, safe markdown renderer. Everything is HTML-escaped first; only the
// markup produced here reaches innerHTML. Tolerates unterminated fences (streaming).
(function (global) {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }
  function render(md) {
    const lines = String(md || '').split('\n');
    let html = '', i = 0, list = null, para = [];
    const flushPara = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (/^\s*```/.test(line)) {
        flushPara(); closeList();
        const lang = line.replace(/^\s*```/, '').trim();
        const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        if (i >= lines.length && buf.length && buf[buf.length - 1] === '') buf.pop();   // unterminated fence while streaming
        i++;
        html += '<pre><code' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '>' + esc(buf.join('\n')) + '</code></pre>';
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flushPara(); closeList();
        const l = Math.min(m[1].length + 1, 4);
        html += '<h' + l + '>' + inline(m[2]) + '</h' + l + '>'; i++; continue;
      }
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        flushPara(); if (list !== 'ul') { closeList(); list = 'ul'; html += '<ul>'; }
        html += '<li>' + inline(m[1]) + '</li>'; i++; continue;
      }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        flushPara(); if (list !== 'ol') { closeList(); list = 'ol'; html += '<ol>'; }
        html += '<li>' + inline(m[1]) + '</li>'; i++; continue;
      }
      if (/^\s*$/.test(line)) { flushPara(); closeList(); i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; i++; continue; }
      if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); closeList(); html += '<blockquote>' + inline(m[1]) + '</blockquote>'; i++; continue; }
      para.push(line); i++;
    }
    flushPara(); closeList();
    return html;
  }
  global.SnapAskMarkdown = { render, esc };
})(typeof self !== 'undefined' ? self : globalThis);
