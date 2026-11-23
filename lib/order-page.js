const { defaultChain, getChain, slotKey, stepKeys, stepLabel } = require('./chain');
const { safeJson, shell } = require('./ui');

// The page where the order of the images inside each post is set. `today` maps a slot key to a
// short text such as "Today: 06:12 - pending" (what is planned or already done today).
function renderOrderPage({ token, chains, schedule, customImages = [], today = {} }) {
    const keys = stepKeys(customImages);
    const slots = schedule.windows.flatMap((window) => (
        Array.from({ length: window.posts }, (_, index) => {
            const slot = index + 1;
            return {
                key: slotKey(window.id, slot),
                title: window.posts > 1 ? `${window.name} post ${slot}` : `${window.name} post`,
                today: today[slotKey(window.id, slot)] || '',
                labels: Object.fromEntries(keys.map((key) => [key, stepLabel(key, window.name, customImages)])),
                chain: getChain(chains, window.id, slot, keys),
                defaults: defaultChain(window.id, slot, keys),
            };
        })
    ));

    const body = `<p class="small">For every post, set which images go out in each group and in what order (top first). There is about a 30 second pause between one image and the next. Tick = sent, untick = left out. Saved changes apply to every post that has not started yet, today and on following days. Custom images are added on the Texts page.</p>
<div id="slots"></div>
<p><button class="primary" id="save">Save</button> <button id="reset">Reset all to default</button></p>
<p id="msg"></p>`;

    const script = `
const slots = ${safeJson(slots)};
const state = Object.fromEntries(slots.map((s) => [s.key, s.chain.map((c) => ({ ...c }))]));
function draw() {
  const root = document.getElementById('slots');
  root.innerHTML = '';
  for (const slot of slots) {
    const card = el('div', { class: 'card' }, el('h3', {}, slot.title), el('div', { class: 'small' }, slot.today));
    state[slot.key].forEach((item, index, list) => {
      const box = el('input', { type: 'checkbox', checked: item.on, onchange: () => { item.on = box.checked; draw(); } });
      box.checked = item.on;
      const up = el('button', { disabled: index === 0, onclick: () => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; draw(); } }, '\\u25B2');
      const down = el('button', { disabled: index === list.length - 1, onclick: () => { [list[index + 1], list[index]] = [list[index], list[index + 1]]; draw(); } }, '\\u25BC');
      card.append(el('div', { class: 'row' + (item.on ? '' : ' off') }, box, el('label', { onclick: () => box.click() }, (index + 1) + '. ' + slot.labels[item.key]), up, down));
    });
    root.append(card);
  }
}
const msg = document.getElementById('msg');
document.getElementById('reset').onclick = () => { for (const s of slots) { state[s.key] = s.defaults.map((c) => ({ ...c })); } draw(); msg.textContent = 'Defaults restored. Press Save to keep them.'; };
document.getElementById('save').onclick = async () => {
  msg.textContent = 'Saving...';
  try { await post('/order', { chains: state }); msg.textContent = 'Saved. It applies to posts that have not started yet.'; } catch (error) { msg.textContent = 'Not saved: ' + error.message; }
};
draw();`;

    return shell({ title: 'Order of images in each post', token, active: 'order', body, script });
}

module.exports = { renderOrderPage };
