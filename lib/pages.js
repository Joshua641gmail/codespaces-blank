const { DAYS, LIMITS, STYLES } = require('./settings');
const { escapeHtml, safeJson, shell } = require('./ui');

// ---- home

function renderHomePage({ token, statusText, warning }) {
    const encoded = encodeURIComponent(token);
    const card = (title, text, path) => `<div class="card"><h3><a href="${path}?token=${encoded}">${title}</a></h3><div class="small">${text}</div></div>`;
    const body = `${warning ? `<p class="warn">${escapeHtml(warning)}</p>` : ''}
${card('Groups', 'See every group, which ones you can post in, and choose where to post.', '/manage')}
${card('Schedule', 'Change the windows: times, number of posts, gaps and days.', '/schedule')}
${card('Image order', 'Choose which images each post sends and in what order.', '/order')}
${card('Texts', 'Change the text sent with each image and add your own images.', '/captions')}
${card('Backup', 'Download or restore all of these settings.', '/backup')}
<div class="card"><h3>Status now</h3><pre style="white-space:pre-wrap;margin:0">${escapeHtml(statusText)}</pre>
<p><a class="btn" href="/pause?token=${encoded}">Pause</a> <a class="btn" href="/resume?token=${encoded}">Resume</a></p></div>`;
    return shell({ title: 'Settings', token, active: 'settings', body });
}

// ---- groups

function renderGroupsPage({ token, connected, groups = [], warning, envLine }) {
    if (!connected) {
        return shell({ title: 'Groups', token, active: 'manage', body: '<p>WhatsApp is not connected yet. Refresh in a minute.</p>' });
    }

    const body = `${warning ? `<p class="warn">${escapeHtml(warning)}</p>` : ''}
<p class="small">Tick the groups to post to, then press Save. Groups you cannot post to (only admins may post, or you were removed) are listed with the reason and cannot be ticked. Nothing is sent to any group from this page.</p>
<p><input type="text" id="search" placeholder="Search groups" style="width:100%"></p>
<div id="sections"></div>
<p><button class="primary" id="save">Save</button></p>
<p id="msg"></p>
<p class="small">To keep this list even if the volume is ever lost, set <code>${escapeHtml(envLine)}</code> as a Railway variable.</p>`;

    const script = `
const groups = ${safeJson(groups)};
const ticked = new Set(groups.filter((g) => g.selected).map((g) => g.id));
const search = document.getElementById('search');
function section(title, note, rows) {
  const card = el('div', { class: 'card' }, el('h3', {}, title + ' (' + rows.length + ')'), el('div', { class: 'small' }, note));
  for (const g of rows) {
    const blocked = Boolean(g.reason);
    const box = el('input', { type: 'checkbox', disabled: blocked && !g.selected, onchange: () => { if (box.checked) { ticked.add(g.id); } else { ticked.delete(g.id); } } });
    box.checked = ticked.has(g.id);
    const note = [];
    if (g.reason) { note.push(g.selected ? 'Selected but cannot post now: ' + g.reason : g.reason); }
    if (g.lastError) { note.push('Last send: ' + g.lastError); }
    card.append(el('div', { class: 'row' }, box, el('label', {}, el('b', {}, g.name), el('br'), el('code', {}, g.id), note.length ? el('div', { class: 'warn small' }, note.join(' | ')) : '')));
  }
  return card;
}
function draw() {
  const q = search.value.trim().toLowerCase();
  const shown = groups.filter((g) => !q || g.name.toLowerCase().includes(q) || g.id.includes(q));
  const root = document.getElementById('sections');
  root.innerHTML = '';
  root.append(
    section('Posting now', 'Currently selected.', shown.filter((g) => g.selected)),
    section('Available to add', 'You can post in these. Tick to add.', shown.filter((g) => !g.selected && !g.reason)),
    section('Cannot post in these', 'Shown for transparency; they cannot be ticked.', shown.filter((g) => !g.selected && g.reason)),
  );
}
search.oninput = draw;
document.getElementById('save').onclick = async () => {
  const msg = document.getElementById('msg');
  msg.textContent = 'Saving...';
  try { const result = await post('/groupsave', { ids: [...ticked] }); msg.textContent = result.message + '\\nReload the page to see the updated lists.'; } catch (error) { msg.textContent = 'Not saved: ' + error.message; }
};
draw();`;

    return shell({ title: 'Groups', token, active: 'manage', body, script });
}

// ---- schedule

function renderSchedulePage({ token, schedule, warnings = [], todayLines = [], timezone }) {
    const body = `<p class="small">Times are in ${escapeHtml(timezone)}. Each window posts the number of times you set, at random times inside it, never closer together than the gap. Saved changes start with the next day's plan; use "Save and re-plan today" to also apply them to today's posts that have not started yet (posts already sent are never repeated).</p>
<div id="warnings" class="warn small">${warnings.map((w) => escapeHtml(w)).join('<br>')}</div>
<h3>Windows</h3><div id="windows"></div>
<p><button id="addWindow">Add a window</button></p>
<h3>Special dates</h3>
<p class="small">Use a different time range for one window on one date.</p>
<div id="exceptions"></div>
<p><button id="addException">Add a special date</button></p>
<p><button class="primary" id="save">Save</button> <button id="saveReplan">Save and re-plan today</button> <button id="replan">Only re-plan today</button></p>
<p id="msg"></p>
<h3>Today</h3><pre class="small" id="today" style="white-space:pre-wrap">${escapeHtml(todayLines.join('\n') || 'No posts planned for the rest of today.')}</pre>`;

    const script = `
const DAYS = ${safeJson(DAYS)};
const STYLES = ${safeJson(STYLES)};
const LIMITS = ${safeJson(LIMITS)};
const data = ${safeJson(schedule)};
const windows = data.windows.map((w) => ({ ...w, days: [...w.days] }));
const exceptions = data.exceptions.map((e) => ({ ...e }));
function field(label, node) { return el('label', {}, label, node); }
function drawWindows() {
  const root = document.getElementById('windows');
  root.innerHTML = '';
  windows.forEach((w, index) => {
    const bind = (key, type, attrs) => { const input = el('input', { type, value: w[key], ...attrs, oninput: () => { w[key] = type === 'number' ? Number(input.value) : input.value; } }); return input; };
    const style = el('select', { onchange: () => { w.style = style.value; } }, STYLES.map((s) => el('option', { value: s, selected: s === w.style }, s)));
    const missing = el('input', { type: 'checkbox', onchange: () => { w.textIfMissing = missing.checked; } });
    missing.checked = w.textIfMissing;
    const days = el('div', { class: 'grid days' }, DAYS.map((day) => {
      const box = el('input', { type: 'checkbox', onchange: () => { w.days = box.checked ? [...w.days, day] : w.days.filter((d) => d !== day); } });
      box.checked = w.days.includes(day);
      return el('label', {}, box, day.slice(0, 3));
    }));
    root.append(el('div', { class: 'card' },
      el('div', { class: 'grid' },
        field('Name', bind('name', 'text', { style: 'width:9rem' })),
        field('Start', bind('start', 'time')), field('End', bind('end', 'time')),
        field('Posts', bind('posts', 'number', { min: 1, max: LIMITS.postsPerWindow, style: 'width:4rem' })),
        field('Min gap (minutes)', bind('gapMinutes', 'number', { min: LIMITS.minGapMinutes, max: LIMITS.maxGapMinutes, style: 'width:5rem' }))),
      days,
      el('div', { class: 'grid' },
        field('Image file (Drive)', bind('image', 'text', { list: 'driveFiles', style: 'width:12rem' })),
        field('Message style', style),
        el('label', { style: 'flex-direction:row;gap:.3rem;align-items:center' }, missing, 'Text only if image is missing'),
        el('button', { class: 'danger', onclick: () => { windows.splice(index, 1); drawWindows(); drawExceptions(); } }, 'Remove window'))));
  });
}
function drawExceptions() {
  const root = document.getElementById('exceptions');
  root.innerHTML = '';
  exceptions.forEach((e, index) => {
    const date = el('input', { type: 'date', value: e.date, oninput: () => { e.date = date.value; } });
    const win = el('select', { onchange: () => { e.window = win.value; } }, windows.map((w) => el('option', { value: w.id, selected: w.id === e.window }, w.name)));
    const start = el('input', { type: 'time', value: e.start, oninput: () => { e.start = start.value; } });
    const end = el('input', { type: 'time', value: e.end, oninput: () => { e.end = end.value; } });
    root.append(el('div', { class: 'card grid' }, field('Date', date), field('Window', win), field('Start', start), field('End', end), el('button', { class: 'danger', onclick: () => { exceptions.splice(index, 1); drawExceptions(); } }, 'Remove')));
  });
}
document.getElementById('addWindow').onclick = () => {
  if (windows.length >= LIMITS.windows) { return; }
  windows.push({ id: '', name: 'New window', start: '10:00', end: '12:00', posts: 1, gapMinutes: 60, days: DAYS.slice(0, 6), style: 'morning', image: '', textIfMissing: true });
  drawWindows(); drawExceptions();
};
document.getElementById('addException').onclick = () => {
  if (!windows.length) { return; }
  exceptions.push({ date: '', window: windows[0].id || '', start: windows[0].start, end: windows[0].end });
  drawExceptions();
};
const msg = document.getElementById('msg');
async function save(replan) {
  msg.textContent = 'Saving...';
  try {
    const result = await post('/schedule', { schedule: { windows, exceptions }, replan });
    msg.textContent = result.message;
    document.getElementById('warnings').innerHTML = '';
    (result.warnings || []).forEach((w) => { document.getElementById('warnings').append(w, el('br')); });
    if (result.today) { document.getElementById('today').textContent = result.today; }
  } catch (error) { msg.textContent = 'Not saved: ' + error.message; }
}
document.getElementById('save').onclick = () => save(false);
document.getElementById('saveReplan').onclick = () => save(true);
document.getElementById('replan').onclick = async () => {
  msg.textContent = 'Re-planning...';
  try { const result = await post('/replan', {}); msg.textContent = result.message; if (result.today) { document.getElementById('today').textContent = result.today; } } catch (error) { msg.textContent = error.message; }
};
fetch('/drivefiles?token=' + encodeURIComponent(TOKEN)).then((r) => r.json()).then((names) => {
  const list = el('datalist', { id: 'driveFiles' }, names.map((n) => el('option', { value: n })));
  document.body.append(list);
}).catch(() => {});
drawWindows(); drawExceptions();`;

    return shell({ title: 'Schedule', token, active: 'schedule', body, script });
}

// ---- texts and custom images

function renderCaptionsPage({ token, schedule, captions, customImages, builtIn }) {
    const body = `<p class="small">Your text replaces the built-in one for that image and is sent exactly as written (a window's text does not get the built-in greeting and signature). Leave a window's box empty to keep using the built-in messages. For a window you can enter several texts separated by a line containing only <code>---</code>; they rotate. WhatsApp allows up to ${LIMITS.captionLength} characters per caption.</p>
<h3>Window images</h3><div id="windows"></div>
<h3>Fixed images</h3><div id="fixed"></div>
<h3>Your own images</h3>
<p class="small">Add any image from the Drive folder with its own text (up to ${LIMITS.customImages}). Then add it to a post's order on the Image order page.</p>
<div id="custom"></div>
<p><button id="addCustom">Add an image</button></p>
<p><button class="primary" id="save">Save</button></p><p id="msg"></p>`;

    const script = `
const schedule = ${safeJson(schedule)};
const builtIn = ${safeJson(builtIn)};
const LIMITS = ${safeJson(LIMITS)};
const captions = ${safeJson(captions)};
const custom = ${safeJson(customImages)};
const windowsRoot = document.getElementById('windows');
const windowBoxes = schedule.windows.map((w) => {
  const box = el('textarea', { placeholder: 'Built-in messages are used (' + w.style + ' style, with greeting and signature).' });
  box.value = (captions.window && captions.window[w.id]) || '';
  windowsRoot.append(el('div', { class: 'card' }, el('h3', {}, w.name + ' image (' + (w.image || 'no image') + ')'), box));
  return [w.id, box];
});
const fixedRoot = document.getElementById('fixed');
const fixedBoxes = ['odoi', 'broline', 'breiline'].map((key) => {
  const box = el('textarea', {});
  box.value = captions[key] || builtIn[key];
  const restore = el('button', { onclick: () => { box.value = builtIn[key]; } }, 'Restore built-in text');
  fixedRoot.append(el('div', { class: 'card' }, el('h3', {}, key.toUpperCase() + ' image'), box, restore));
  return [key, box];
});
function drawCustom() {
  const root = document.getElementById('custom');
  root.innerHTML = '';
  custom.forEach((c, index) => {
    const label = el('input', { type: 'text', value: c.label, oninput: () => { c.label = label.value; } });
    const file = el('input', { type: 'text', value: c.file, list: 'driveFiles', style: 'width:14rem', oninput: () => { c.file = file.value; } });
    const text = el('textarea', { oninput: () => { c.caption = text.value; } });
    text.value = c.caption || '';
    root.append(el('div', { class: 'card' }, el('div', { class: 'grid' }, el('label', {}, 'Label', label), el('label', {}, 'Image file name (Drive)', file), el('button', { class: 'danger', onclick: () => { custom.splice(index, 1); drawCustom(); } }, 'Remove')), text));
  });
}
document.getElementById('addCustom').onclick = () => { if (custom.length < LIMITS.customImages) { custom.push({ id: '', label: '', file: '', caption: '' }); drawCustom(); } };
document.getElementById('save').onclick = async () => {
  const msg = document.getElementById('msg');
  msg.textContent = 'Saving...';
  const payload = { captions: { window: {} }, customImages: custom };
  for (const [id, box] of windowBoxes) { payload.captions.window[id] = box.value; }
  for (const [key, box] of fixedBoxes) { payload.captions[key] = box.value.trim() === builtIn[key].trim() ? '' : box.value; }
  try { await post('/captions', payload); msg.textContent = 'Saved. It applies to posts that have not started yet.'; } catch (error) { msg.textContent = 'Not saved: ' + error.message; }
};
fetch('/drivefiles?token=' + encodeURIComponent(TOKEN)).then((r) => r.json()).then((names) => {
  document.body.append(el('datalist', { id: 'driveFiles' }, names.map((n) => el('option', { value: n }))));
}).catch(() => {});
drawCustom();`;

    return shell({ title: 'Texts and images', token, active: 'captions', body, script });
}

// ---- backup

function renderBackupPage({ token }) {
    const encoded = encodeURIComponent(token);
    const body = `<p class="small">Everything you change on the Groups, Schedule, Image order and Texts pages is saved on the Railway volume. Download a copy now and then; if the volume is ever lost, restore it here in one click.</p>
<p><a class="btn primary" href="/backup.json?token=${encoded}">Download settings backup</a></p>
<h3>Restore</h3>
<p class="small">Choose a backup file (or paste its contents) and press Restore. This replaces the current schedule, texts, image order and group list.</p>
<p><input type="file" id="file" accept=".json,application/json"></p>
<textarea id="text" placeholder="Backup contents"></textarea>
<p><button class="primary" id="restore">Restore</button></p><p id="msg"></p>`;
    const script = `
document.getElementById('file').onchange = async (event) => { const f = event.target.files[0]; if (f) { document.getElementById('text').value = await f.text(); } };
document.getElementById('restore').onclick = async () => {
  const msg = document.getElementById('msg');
  let parsed;
  try { parsed = JSON.parse(document.getElementById('text').value); } catch { msg.textContent = 'That is not a valid backup file.'; return; }
  if (!confirm('Replace the current settings with this backup?')) { return; }
  try { const result = await post('/restore', parsed); msg.textContent = result.message; } catch (error) { msg.textContent = 'Not restored: ' + error.message; }
};`;
    return shell({ title: 'Backup and restore', token, active: 'backup', body, script });
}

module.exports = { renderBackupPage, renderCaptionsPage, renderGroupsPage, renderHomePage, renderSchedulePage };
