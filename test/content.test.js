const test = require('node:test');
const assert = require('node:assert/strict');
const { HEADERS, MESSAGES, SIGNATURE, drawVariant, formatPost } = require('../lib/content');

function seeded(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

test('there are 20 distinct messages', () => {
    assert.equal(MESSAGES.length, 20);
    assert.equal(new Set(MESSAGES).size, 20);
});

test('a post is: weekday first line, the message, then the two signature lines', () => {
    const lines = formatPost('TUESDAY', 3).split('\n');
    assert.match(lines[0], /Tuesday/);
    assert.equal(lines[1], '');
    assert.equal(lines[2], MESSAGES[3]);
    assert.equal(lines[3], '');
    assert.deepEqual(lines.slice(4), ['##MUTSINZI ALEX##', '##GUILD ASPIRANT##']);
    assert.deepEqual(SIGNATURE, ['##MUTSINZI ALEX##', '##GUILD ASPIRANT##']);
});

test('every header mentions the weekday and leaves no placeholder', () => {
    for (let i = 0; i < HEADERS.length; i += 1) {
        const first = formatPost('FRIDAY', 0, () => i / HEADERS.length).split('\n')[0];
        assert.ok(first.includes('Friday'));
        assert.ok(!first.includes('{Day}'));
    }
});

test('20 draws in a row use every message exactly once', () => {
    let state;
    const seen = new Set();
    for (let i = 0; i < 20; i += 1) {
        const draw = drawVariant(state, seeded(5));
        seen.add(draw.index);
        state = draw.state;
    }
    assert.equal(seen.size, 20);
    assert.deepEqual(state.bag, []);
});

test('a new round starts after 20 and never begins with the message just used', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
        const random = seeded(seed);
        let state;
        let previous;
        for (let i = 0; i < 60; i += 1) {
            const draw = drawVariant(state, random);
            assert.notEqual(draw.index, previous);
            previous = draw.index;
            state = draw.state;
        }
    }
});

test('drawing does not change the saved state until it is committed', () => {
    const saved = { bag: [4, 7], last: 2 };
    const draw = drawVariant(saved);
    assert.deepEqual(saved, { bag: [4, 7], last: 2 });
    assert.equal(draw.index, 4);
    assert.deepEqual(draw.state, { bag: [7], last: 4 });
});

test('ignores a damaged saved state', () => {
    const draw = drawVariant({ bag: [99, -1, 'x'], last: 'y' });
    assert.ok(draw.index >= 0 && draw.index < 20);
});
