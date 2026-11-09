const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DAY_END_SECONDS,
    DAY_START_SECONDS,
    MIN_GAP_SECONDS,
    localDateKeyFor,
    localSecondsFor,
    planDay,
} = require('../lib/post-schedule');

function seeded(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

test('weekday plans have 2-3 images and 1-2 messages inside the day window', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const plan = planDay({ random: seeded(seed), isWeekday: true });
        const images = plan.filter(({ type }) => type === 'image').length;
        const messages = plan.filter(({ type }) => type === 'message').length;
        assert.ok(images >= 2 && images <= 3, `images ${images}`);
        assert.ok(messages >= 1 && messages <= 2, `messages ${messages}`);
        for (const { atSecond } of plan) {
            assert.ok(atSecond >= DAY_START_SECONDS && atSecond < DAY_END_SECONDS);
        }
    }
});

test('posts are never closer together than the minimum gap and ids are unique', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const plan = planDay({ random: seeded(seed), isWeekday: true, countdownActive: true });
        plan.slice(1).forEach(({ atSecond }, index) => {
            assert.ok(atSecond - plan[index].atSecond >= MIN_GAP_SECONDS);
        });
        assert.equal(new Set(plan.map(({ id }) => id)).size, plan.length);
    }
});

test('weekends only get the countdown, and only when it is active', () => {
    assert.deepEqual(planDay({ isWeekday: false }), []);
    const plan = planDay({ isWeekday: false, countdownActive: true });
    assert.deepEqual(plan.map(({ type }) => type), ['countdown']);
});

test('the countdown stays in the morning window', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
        const [countdown] = planDay({ random: seeded(seed), isWeekday: false, countdownActive: true });
        assert.ok(countdown.atSecond >= 7.5 * 3600 && countdown.atSecond < 10 * 3600);
    }
});

test('times differ from day to day', () => {
    const signatures = new Set();
    for (let seed = 1; seed <= 30; seed += 1) {
        signatures.add(planDay({ random: seeded(seed), isWeekday: true }).map(({ atSecond }) => atSecond).join(','));
    }
    assert.equal(signatures.size, 30);
});

test('a late start only plans the rest of the day and may post less', () => {
    const plan = planDay({ random: seeded(7), isWeekday: true, fromSecond: 19 * 3600 });
    for (const { atSecond } of plan) {
        assert.ok(atSecond >= 19 * 3600);
    }
    assert.ok(plan.length <= 3);
    assert.deepEqual(planDay({ isWeekday: true, fromSecond: 22 * 3600 }), []);
});

test('rejects an invalid random source', () => {
    assert.throws(() => planDay({ random: () => 1, isWeekday: true }), /range \[0, 1\)/);
});

test('reads local time and date in the schedule timezone', () => {
    const date = new Date('2026-11-09T21:30:15Z');
    assert.equal(localSecondsFor(date, 'Africa/Nairobi'), 30 * 60 + 15);
    assert.equal(localDateKeyFor(date, 'Africa/Nairobi'), '2026-11-10');
});
