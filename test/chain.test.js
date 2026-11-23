const test = require('node:test');
const assert = require('node:assert/strict');
const { BASE_STEPS, defaultChain, enabledSteps, getChain, normalizeChain, stepKeys, stepLabel, validateChains } = require('../lib/chain');
const { renderOrderPage } = require('../lib/order-page');
const { defaultSchedule } = require('../lib/settings');

test('default: each window has BROLINE once and BREILINE once, after the window image and ODOI', () => {
    for (const id of ['morning', 'evening', 'w3']) {
        assert.deepEqual(enabledSteps(defaultChain(id, 1)), ['regular', 'odoi', 'broline']);
        assert.deepEqual(enabledSteps(defaultChain(id, 2)), ['regular', 'odoi', 'breiline']);
    }
    assert.deepEqual(enabledSteps(defaultChain('afternoon', 1)), ['regular', 'odoi']);
});

test('a saved order is used as saved, and a missing/broken one falls back to the default', () => {
    const saved = [
        { key: 'breiline', on: true },
        { key: 'regular', on: true },
        { key: 'broline', on: true },
        { key: 'odoi', on: false },
    ];
    assert.deepEqual(enabledSteps(getChain({ 'morning-1': saved }, 'morning', 1)), ['breiline', 'regular', 'broline']);
    assert.deepEqual(getChain({}, 'morning', 1), defaultChain('morning', 1));
    assert.deepEqual(normalizeChain('junk', 'morning', 1), defaultChain('morning', 1));
});

test('normalizing repairs duplicates, unknown steps and missing steps, including custom images', () => {
    const keys = stepKeys([{ id: 'c1' }]);
    assert.deepEqual(keys, [...BASE_STEPS, 'c1']);
    const chain = normalizeChain([{ key: 'odoi', on: true }, { key: 'odoi', on: true }, { key: 'nope', on: true }], 'morning', 1, keys);
    assert.deepEqual(chain.map((item) => item.key), ['odoi', 'regular', 'broline', 'breiline', 'c1']);
    assert.deepEqual(enabledSteps(chain), ['odoi']);
});

test('validateChains accepts a full order for any window and rejects anything else', () => {
    const good = defaultChain('morning', 1);
    assert.deepEqual(validateChains({ chains: { 'morning-1': good, 'w3-2': good } }), { 'morning-1': good, 'w3-2': good });
    assert.throws(() => validateChains({}), /Expected/);
    assert.throws(() => validateChains({ chains: { 'Not Valid': good } }), /Unknown post slot/);
    assert.throws(() => validateChains({ chains: { 'morning-1': good.slice(1) } }), /each of/);
    assert.throws(() => validateChains({ chains: { 'morning-1': [...good.slice(1), good[1]] } }), /each of/);
    assert.throws(() => validateChains({ chains: { 'morning-1': good.map((item) => ({ ...item, on: 'yes' })) } }), /on: true or false/);
    const withCustom = defaultChain('morning', 1, stepKeys([{ id: 'c1' }]));
    assert.equal(validateChains({ chains: { 'morning-1': withCustom } }, stepKeys([{ id: 'c1' }]))['morning-1'].length, 5);
    assert.throws(() => validateChains({ chains: { 'morning-1': good } }, stepKeys([{ id: 'c1' }])), /each of/);
});

test('step labels name the window and custom images', () => {
    assert.equal(stepLabel('regular', 'Noon'), 'Noon image + message');
    assert.equal(stepLabel('c1', 'Noon', [{ id: 'c1', label: 'Poster' }]), 'Custom: Poster');
});

test('the order page follows the schedule: one card per post, custom images included, token cannot break out', () => {
    const schedule = defaultSchedule();
    schedule.windows.push({ id: 'w4', name: 'Late', start: '22:00', end: '23:00', posts: 1, gapMinutes: 60, days: ['MONDAY'], style: 'evening', image: '', textIfMissing: true });
    const html = renderOrderPage({
        token: 'abc</script><b>',
        chains: {},
        schedule,
        customImages: [{ id: 'c1', label: 'Poster', file: 'p.png', caption: '' }],
        today: { 'morning-1': 'Today: 06:12 - pending' },
    });
    for (const title of ['Morning post 1', 'Morning post 2', 'Evening post 1', 'Evening post 2', 'Afternoon post', 'Late post']) {
        assert.ok(html.includes(title), title);
    }
    assert.ok(html.includes('Today: 06:12 - pending') && html.includes('Custom: Poster'));
    assert.ok(!html.includes('abc</script>'));
});
