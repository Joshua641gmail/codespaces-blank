const test = require('node:test');
const assert = require('node:assert/strict');
const { allSlotKeys, defaultChain, enabledSteps, getChain, normalizeChain, validateChains } = require('../lib/chain');
const { renderOrderPage } = require('../lib/order-page');

test('default: each window has BROLINE once and BREILINE once, after the window image and ODOI', () => {
    for (const period of ['morning', 'evening']) {
        assert.deepEqual(enabledSteps(defaultChain(period, 1)), ['regular', 'odoi', 'broline']);
        assert.deepEqual(enabledSteps(defaultChain(period, 2)), ['regular', 'odoi', 'breiline']);
    }
    assert.deepEqual(enabledSteps(defaultChain('afternoon', 1)), ['regular', 'odoi']);
});

test('slot keys cover the two morning, two evening and one afternoon post', () => {
    assert.deepEqual(allSlotKeys(), ['morning-1', 'morning-2', 'evening-1', 'evening-2', 'afternoon-1']);
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
    assert.deepEqual(getChain(undefined, 'evening', 2), defaultChain('evening', 2));
    assert.deepEqual(normalizeChain('junk', 'morning', 1), defaultChain('morning', 1));
});

test('normalizing repairs duplicates, unknown steps and missing steps', () => {
    const chain = normalizeChain([{ key: 'odoi', on: true }, { key: 'odoi', on: true }, { key: 'nope', on: true }], 'morning', 1);
    assert.deepEqual(chain.map((item) => item.key), ['odoi', 'regular', 'broline', 'breiline']);
    assert.deepEqual(enabledSteps(chain), ['odoi']);
});

test('validateChains accepts a full order and rejects anything else', () => {
    const good = defaultChain('morning', 1);
    assert.deepEqual(validateChains({ chains: { 'morning-1': good } }), { 'morning-1': good });
    assert.throws(() => validateChains({}), /Expected/);
    assert.throws(() => validateChains({ chains: { 'noon-1': good } }), /Unknown post slot/);
    assert.throws(() => validateChains({ chains: { 'morning-1': good.slice(1) } }), /each of/);
    assert.throws(() => validateChains({ chains: { 'morning-1': [...good.slice(1), good[1]] } }), /each of/);
    assert.throws(() => validateChains({ chains: { 'morning-1': good.map((item) => ({ ...item, on: 'yes' })) } }), /on: true or false/);
});

test('the order page lists every post and cannot be broken out of by the token', () => {
    const html = renderOrderPage({ token: 'abc</script><b>', chains: {}, today: { 'morning-1': 'Today: 06:12 - pending' } });
    assert.ok(html.includes('Morning post 1') && html.includes('Evening post 2') && html.includes('Afternoon post'));
    assert.ok(html.includes('Today: 06:12 - pending'));
    assert.ok(!html.includes('abc</script>'));
});
