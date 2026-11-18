const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENING_MESSAGES, MORNING_MESSAGES, POOLS, SIGNATURE, drawVariant, formatPost } = require('../lib/content');

function seeded(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

test('there are 10 distinct messages for each of morning and evening', () => {
    assert.equal(new Set(MORNING_MESSAGES).size, 10);
    assert.equal(new Set(EVENING_MESSAGES).size, 10);
    assert.equal(MORNING_MESSAGES.filter((message) => EVENING_MESSAGES.includes(message)).length, 0);
});

test('posts have the greeting wrapped in blue diamonds, the message, then the styled signature', () => {
    assert.equal(formatPost('morning', 2), `🔷 Good morning 🔷\n\n${MORNING_MESSAGES[2]}\n\n${SIGNATURE.join('\n')}`);
    assert.equal(formatPost('evening', 5), `🔷 Good evening 🔷\n\n${EVENING_MESSAGES[5]}\n\n${SIGNATURE.join('\n')}`);
    assert.deepEqual(SIGNATURE, ['🔷 𝗠𝗨𝗧𝗦𝗜𝗡𝗭𝗜 𝗔𝗟𝗘𝗫 🔷', '🔶 𝗚𝗨𝗜𝗟𝗗 𝗔𝗦𝗣𝗜𝗥𝗔𝗡𝗧 🔶']);
});

test('no day names and no moon or sunrise emoji anywhere in the wording', () => {
    const everything = [...MORNING_MESSAGES, ...EVENING_MESSAGES, formatPost('morning', 0), formatPost('evening', 0)].join('\n');
    assert.doesNotMatch(everything, /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i);
    assert.doesNotMatch(everything, /[🌙🌅☀🌄🌞🌛🌜]/u);
});

test('evening messages do not welcome people back', () => {
    for (const message of EVENING_MESSAGES) {
        assert.doesNotMatch(message, /welcome back|back from/i);
    }
});

test('10 draws per period use every message once, then a new round never starts with the last one', () => {
    for (const period of Object.keys(POOLS)) {
        for (let seed = 1; seed <= 200; seed += 1) {
            const random = seeded(seed);
            let state;
            const firstRound = new Set();
            let previous;
            for (let i = 0; i < 50; i += 1) {
                const draw = drawVariant(period, state, random);
                if (i < 10) {
                    firstRound.add(draw.index);
                }
                assert.notEqual(draw.index, previous);
                previous = draw.index;
                state = draw.state;
            }
            assert.equal(firstRound.size, 10);
        }
    }
});

test('drawing does not change the saved state, and a damaged state is tolerated', () => {
    const saved = { bag: [4, 7], last: 2 };
    const draw = drawVariant('morning', saved);
    assert.deepEqual(saved, { bag: [4, 7], last: 2 });
    assert.deepEqual(draw, { index: 4, state: { bag: [7], last: 4 } });

    const damaged = drawVariant('evening', { bag: [99, -1, 'x'], last: 'y' });
    assert.ok(damaged.index >= 0 && damaged.index < 10);
    assert.throws(() => drawVariant('noon'), /Invalid period/);
});

test('the ODOI caption is the exact fixed text', () => {
    const { ODOI_CAPTION } = require('../lib/content');
    assert.ok(ODOI_CAPTION.startsWith('Success is built long before the results are announced.'));
    assert.ok(ODOI_CAPTION.endsWith('All the very best in your papers! ✨\n\nODOI JORAM'));
    assert.equal(ODOI_CAPTION.split('\n\n').length, 5);
    assert.ok(ODOI_CAPTION.length < 1024);
});
