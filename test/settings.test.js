const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBackup, defaultSchedule, normalizeSchedule, scheduleWarnings, splitVariants, validateBackup, validateCaptions, validateSchedule, windowsForDate } = require('../lib/settings');
const { renderBackupPage, renderCaptionsPage, renderGroupsPage, renderHomePage, renderSchedulePage } = require('../lib/pages');

const clone = (value) => JSON.parse(JSON.stringify(value));

test('the default schedule is valid and unchanged by validation', () => {
    assert.deepEqual(validateSchedule(defaultSchedule()), defaultSchedule());
    assert.deepEqual(normalizeSchedule(undefined), defaultSchedule());
    assert.deepEqual(normalizeSchedule({ windows: [] }), defaultSchedule());
});

test('new windows get ids; invalid input is refused with a clear message', () => {
    const schedule = clone(defaultSchedule());
    schedule.windows.push({ ...schedule.windows[0], id: '', name: 'Noon', start: '11:00', end: '13:00', posts: 2, gapMinutes: 60 });
    const clean = validateSchedule(schedule);
    assert.equal(clean.windows[3].id, 'w1');

    const bad = (change, pattern) => {
        const copy = clone(defaultSchedule());
        change(copy);
        assert.throws(() => validateSchedule(copy), pattern);
    };
    bad((s) => { s.windows[0].end = '04:00'; }, /end time must be after/);
    bad((s) => { s.windows[0].start = '25:00'; }, /times must look like/);
    bad((s) => { s.windows[0].posts = 0; }, /posts must be/);
    bad((s) => { s.windows[0].posts = 7; }, /posts must be/);
    bad((s) => { s.windows[0].gapMinutes = 10; }, /gap between posts/);
    bad((s) => { s.windows[0].posts = 6; s.windows[0].gapMinutes = 120; }, /do not fit/);
    bad((s) => { s.windows[0].days = []; }, /at least one day/);
    bad((s) => { s.windows[0].style = 'night'; }, /message style/);
    bad((s) => { s.windows[0].image = '../x.png'; }, /plain file name/);
    bad((s) => { s.windows[0].name = ''; }, /name/);
    bad((s) => { s.exceptions[0].date = '2026-02-31'; }, /date must look like/);
    bad((s) => { s.exceptions[0].window = 'nope'; }, /pick one of the windows/);
    bad((s) => { s.exceptions.push({ ...s.exceptions[0] }); }, /already has a special time/);
    bad((s) => { s.exceptions = []; s.windows = Array.from({ length: 9 }, (_, i) => ({ ...s.windows[0], id: `x${i}` })); }, /between 1 and 8/);
    bad((s) => { s.exceptions = []; s.windows = Array.from({ length: 4 }, (_, i) => ({ ...s.windows[0], id: `x${i}`, posts: 6, gapMinutes: 30 })); }, /limit is 20/);
});

test('warnings flag a lot of volume and overlapping windows but do not refuse', () => {
    assert.deepEqual(scheduleWarnings(defaultSchedule()), []);
    const busy = clone(defaultSchedule());
    busy.windows[0].posts = 6;
    busy.windows[0].gapMinutes = 30;
    busy.windows[1].days = busy.windows[0].days;
    busy.windows[1].start = '09:00';
    busy.windows[1].end = '12:00';
    const warnings = scheduleWarnings(validateSchedule(busy));
    assert.ok(warnings.some((w) => /posts per group/.test(w)));
    assert.ok(warnings.some((w) => /overlap/.test(w)));
});

test('windowsForDate applies special dates only to that date and only on days a window runs', () => {
    const schedule = defaultSchedule();
    const special = windowsForDate(schedule, '2026-11-23', 'MONDAY');
    assert.deepEqual(special.map((w) => [w.id, w.start / 3600, w.end / 3600]), [['morning', 5, 7.5], ['evening', 17, 20]]);
    const normal = windowsForDate(schedule, '2026-11-24', 'TUESDAY');
    assert.deepEqual(normal.map((w) => [w.id, w.start / 3600, w.end / 3600]), [['morning', 5, 10], ['evening', 17, 22]]);
    assert.deepEqual(windowsForDate(schedule, '2026-11-29', 'SUNDAY'), []);
    assert.deepEqual(windowsForDate(schedule, '2026-11-28', 'SATURDAY').map((w) => w.id), ['morning', 'afternoon', 'evening']);
});

test('texts: variants split on --- lines, limits enforced, empty means built-in', () => {
    assert.deepEqual(splitVariants('one\n---\ntwo\n\n  ---  \nthree'), ['one', 'two', 'three']);
    assert.deepEqual(splitVariants('  '), []);

    const clean = validateCaptions({ captions: { odoi: ' hello ', window: { morning: 'a\r\n---\r\nb', evening: '   ' } } });
    assert.equal(clean.captions.odoi, 'hello');
    assert.deepEqual(clean.captions.window, { morning: 'a\n---\nb' });
    assert.equal(clean.captions.broline, '');

    assert.throws(() => validateCaptions({ captions: { odoi: 'x'.repeat(1025) } }), /longer than 1024/);
    assert.throws(() => validateCaptions({ captions: { window: { morning: 'x'.repeat(1025) } } }), /at most 1024/);
    assert.throws(() => validateCaptions({ captions: { window: { 'Bad Id': 'x' } } }), /Unknown window/);
});

test('custom images: ids assigned, file names and labels checked, at most 8', () => {
    const clean = validateCaptions({ customImages: [{ label: 'Poster', file: 'poster.png', caption: ' hi ' }, { id: 'c1', label: 'Two', file: 'two.png', caption: '' }] });
    assert.deepEqual(clean.customImages.map((c) => c.id), ['c2', 'c1']);
    assert.equal(clean.customImages[0].caption, 'hi');
    assert.throws(() => validateCaptions({ customImages: [{ label: '', file: 'a.png' }] }), /label/);
    assert.throws(() => validateCaptions({ customImages: [{ label: 'x', file: 'a/b.png' }] }), /exact file name/);
    assert.throws(() => validateCaptions({ customImages: Array.from({ length: 9 }, () => ({ label: 'x', file: 'a.png' })) }), /At most 8/);
});

test('backup round-trips and rejects anything that is not a valid backup', () => {
    const state = {
        schedule: defaultSchedule(),
        captions: { window: { morning: 'hi' }, odoi: '', broline: '', breiline: '' },
        customImages: [{ id: 'c1', label: 'Poster', file: 'p.png', caption: '' }],
        chains: { 'morning-1': [{ key: 'regular', on: true }, { key: 'odoi', on: true }, { key: 'broline', on: false }, { key: 'breiline', on: false }, { key: 'c1', on: true }] },
        addedGroups: ['123-45@g.us'],
        removedGroups: [],
        wording: { morning: {} },
        paused: true,
    };
    const backup = buildBackup(state);
    assert.ok(!('wording' in backup.settings) && !('paused' in backup.settings));
    const patch = validateBackup(JSON.parse(JSON.stringify(backup)));
    assert.deepEqual(patch.schedule, state.schedule);
    assert.deepEqual(patch.chains, state.chains);
    assert.deepEqual(patch.addedGroups, ['123-45@g.us']);

    assert.throws(() => validateBackup({}), /not a settings backup/);
    assert.throws(() => validateBackup({ format: 'alex-settings-1', settings: { addedGroups: ['nope'] } }), /list of group IDs/);
});

test('every page renders and keeps the token safely out of the markup', () => {
    const token = 'tok</script>en';
    const schedule = defaultSchedule();
    const pages = [
        renderHomePage({ token, statusText: 'Posting: ACTIVE', warning: '' }),
        renderSchedulePage({ token, schedule, warnings: ['careful'], todayLines: ['06:00 x - pending'], timezone: 'Africa/Nairobi' }),
        renderCaptionsPage({ token, schedule, captions: { window: {}, odoi: '', broline: '', breiline: '' }, customImages: [], builtIn: { odoi: 'o', broline: 'b', breiline: 'r' } }),
        renderBackupPage({ token }),
        renderGroupsPage({ token, connected: true, groups: [{ id: '1-2@g.us', name: '<b>Class</b>', selected: true, reason: '', lastError: '' }], warning: '', envLine: 'WHATSAPP_GROUP_IDS=1-2@g.us' }),
        renderGroupsPage({ token, connected: false }),
    ];
    for (const html of pages) {
        assert.ok(html.startsWith('<!doctype html>'));
        assert.ok(!html.includes('tok</script>en'));
    }
    assert.ok(pages[1].includes('careful') && pages[1].includes('06:00 x - pending'));
    assert.ok(!pages[4].includes('<b>Class</b>'));
});
