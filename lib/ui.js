// Shared look and navigation for the browser pages (all behind the admin token).

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// JSON that is safe to put inside a <script> tag.
function safeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

const NAV = [
    ['settings', 'Home', '/settings'],
    ['manage', 'Groups', '/manage'],
    ['schedule', 'Schedule', '/schedule'],
    ['order', 'Image order', '/order'],
    ['captions', 'Texts', '/captions'],
    ['backup', 'Backup', '/backup'],
];

const STYLE = `
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{max-width:760px;margin:0 auto;padding:0 1rem 3rem}
nav{display:flex;flex-wrap:wrap;gap:.4rem;padding:.8rem 0;position:sticky;top:0;background:Canvas;border-bottom:1px solid #8884}
nav a{padding:.3rem .7rem;border-radius:999px;border:1px solid #8886;text-decoration:none;color:inherit;font-size:.9rem}
nav a.on{background:#1a7f4b;color:#fff;border-color:#1a7f4b}
.card{border:1px solid #8886;border-radius:10px;padding:.8rem;margin:.8rem 0}
.card h3{margin:0 0 .3rem}
.small{font-size:.85rem;opacity:.75}
.warn{color:#b3261e;font-weight:600}
.row{display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-top:1px solid #8883}
.row label{flex:1}
.row.off label{opacity:.45}
button,.btn{font-size:1rem;padding:.35rem .8rem;border-radius:6px;border:1px solid #8886;background:transparent;color:inherit;text-decoration:none;cursor:pointer;display:inline-block}
button.primary,.btn.primary{background:#1a7f4b;color:#fff;border-color:#1a7f4b}
button.danger{color:#b3261e}
button:disabled{opacity:.4}
input[type=text],input[type=number],input[type=time],input[type=date],select,textarea{font:inherit;padding:.3rem;border-radius:6px;border:1px solid #8886;background:transparent;color:inherit;max-width:100%;box-sizing:border-box}
textarea{width:100%;min-height:7rem}
.grid{display:flex;flex-wrap:wrap;gap:.6rem;align-items:end}
.grid label{display:flex;flex-direction:column;font-size:.8rem}
.days label{flex-direction:row;gap:.2rem;align-items:center}
#msg{font-weight:600;min-height:1.5rem;white-space:pre-wrap}
code{font-size:.8rem;word-break:break-all}
`;

function shell({ title, token, active, body, script = '' }) {
    const encoded = encodeURIComponent(token || '');
    const links = NAV.map(([key, label, path]) => (
        `<a class="${key === active ? 'on' : ''}" href="${path}?token=${encoded}">${label}</a>`
    )).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>
<nav>${links}</nav>
<h2>${escapeHtml(title)}</h2>
${body}
<script>const TOKEN = ${safeJson(token || '')};
async function post(path, payload) {
  const res = await fetch(path + '?token=' + encodeURIComponent(TOKEN), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) { throw new Error(text); }
  try { return JSON.parse(text); } catch { return { message: text }; }
}
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') { node.className = value; } else if (key.startsWith('on')) { node[key] = value; } else if (value === true) { node.setAttribute(key, ''); } else if (value !== false && value != null) { node.setAttribute(key, value); }
  }
  for (const child of children.flat()) { node.append(child && child.nodeType ? child : document.createTextNode(child == null ? '' : child)); }
  return node;
}
${script}</script></body></html>`;
}

module.exports = { escapeHtml, safeJson, shell };
