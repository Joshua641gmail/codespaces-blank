const { SLOTS, allSlotKeys, defaultChain, getChain, slotKey, stepLabel } = require('./chain');

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function titleFor(key) {
    const [period, slot] = key.split('-');
    const name = period[0].toUpperCase() + period.slice(1);
    return SLOTS[period] > 1 ? `${name} post ${slot}` : `${name} post`;
}

// The page where the order of the images inside each post is set. `today` maps a slot key to
// a short text such as "06:12 - pending" (what is planned or already done today).
function renderOrderPage({ token, chains, today = {} }) {
    const data = {
        token,
        slots: allSlotKeys().map((key) => {
            const [period, slot] = key.split('-');
            return {
                key,
                title: titleFor(key),
                today: today[key] || '',
                labels: Object.fromEntries(['regular', 'odoi', 'broline', 'breiline'].map((step) => [step, stepLabel(step, period)])),
                chain: getChain(chains, period, Number(slot)),
                defaults: defaultChain(period, Number(slot)),
            };
        }),
    };
    const json = JSON.stringify(data).replace(/</g, '\\u003c');

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Post order</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{max-width:640px;margin:1rem auto;padding:0 1rem}
.card{border:1px solid #8886;border-radius:10px;padding:.8rem;margin:.8rem 0}
.card h3{margin:0 0 .2rem}.small{font-size:.85rem;opacity:.75}
.row{display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-top:1px solid #8883}
.row label{flex:1}.row.off label{opacity:.45}
button{font-size:1rem;padding:.35rem .7rem;border-radius:6px;border:1px solid #8886;background:transparent;color:inherit}
button.primary{background:#1a7f4b;color:#fff;border-color:#1a7f4b}
#msg{font-weight:600;min-height:1.5rem}
</style></head><body>
<h2>Order of images in each post</h2>
<p class="small">For every post, set which images go out in each group and in what order (top first). There is about a 30 second pause between one image and the next. Tick = sent, untick = left out. Saved changes apply to every post that has not started yet, today and on following days.</p>
<div id="slots"></div>
<p><button class="primary" id="save">Save</button> <button id="reset">Reset all to default</button></p>
<p id="msg"></p>
<script>
const data = ${json};
const state = Object.fromEntries(data.slots.map((s) => [s.key, s.chain.map((c) => ({ ...c }))]));
function draw() {
  const root = document.getElementById('slots');
  root.innerHTML = '';
  for (const slot of data.slots) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h3></h3><div class="small"></div>';
    card.querySelector('h3').textContent = slot.title;
    card.querySelector('.small').textContent = slot.today;
    state[slot.key].forEach((item, index, list) => {
      const row = document.createElement('div');
      row.className = 'row' + (item.on ? '' : ' off');
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = item.on;
      box.onchange = () => { item.on = box.checked; draw(); };
      const label = document.createElement('label');
      label.textContent = (index + 1) + '. ' + slot.labels[item.key];
      label.onclick = () => box.click();
      const up = document.createElement('button'); up.textContent = '\\u25B2'; up.disabled = index === 0;
      up.onclick = () => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; draw(); };
      const down = document.createElement('button'); down.textContent = '\\u25BC'; down.disabled = index === list.length - 1;
      down.onclick = () => { [list[index + 1], list[index]] = [list[index], list[index + 1]]; draw(); };
      row.append(box, label, up, down);
      card.append(row);
    });
    root.append(card);
  }
}
const msg = document.getElementById('msg');
document.getElementById('reset').onclick = () => {
  for (const slot of data.slots) state[slot.key] = slot.defaults.map((c) => ({ ...c }));
  draw(); msg.textContent = 'Defaults restored. Press Save to keep them.';
};
document.getElementById('save').onclick = async () => {
  msg.textContent = 'Saving...';
  try {
    const res = await fetch('/order?token=' + encodeURIComponent(data.token), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chains: state }),
    });
    msg.textContent = res.ok ? 'Saved. It applies to posts that have not started yet.' : 'Not saved: ' + await res.text();
  } catch (error) { msg.textContent = 'Not saved: ' + error.message; }
};
draw();
</script></body></html>`;
}

module.exports = { renderOrderPage, escapeHtml, slotKey };
