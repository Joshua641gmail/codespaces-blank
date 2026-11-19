const test = require('node:test');
const assert = require('node:assert/strict');
const { MIN_GAP_SECONDS, WINDOWS, localDateKeyFor, localSecondsFor, planDay } = require('../lib/post-schedule');

function seeded(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

test('a weekday has two morning and two evening image posts inside their windows, gaps preserved', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
        const plan = planDay({ random: seeded(seed), isPostingDay: true });
        assert.equal(plan.length, 4);
        for (const period of ['morning', 'evening']) {
            const entries = plan.filter((entry) => entry.period === period);
            assert.equal(entries.length, 2);
            for (const { atSecond, type } of entries) {
                assert.equal(type, 'image');
                assert.ok(atSecond >= WINDOWS[period].start && atSecond < WINDOWS[period].end);
            }
            assert.ok(entries[1].atSecond - entries[0].atSecond >= MIN_GAP_SECONDS);
        }
    }
});

test('Saturday adds exactly one random afternoon post between 12:00 and 16:00', () => {
    const times = new Set();
    for (let seed = 1; seed <= 200; seed += 1) {
        const plan = planDay({ random: seeded(seed), isPostingDay: true, isSaturday: true });
        const afternoon = plan.filter((entry) => entry.period === 'afternoon');
        assert.equal(plan.length, 5);
        assert.equal(afternoon.length, 1);
        assert.ok(afternoon[0].atSecond >= 12 * 3600 && afternoon[0].atSecond < 16 * 3600);
        times.add(afternoon[0].atSecond);
    }
    assert.ok(times.size > 100);
    assert.equal(planDay({ random: seeded(1), isPostingDay: true }).some((entry) => entry.period === 'afternoon'), false);
});

test('morning is 5:00-7:30, evening is 17:00-20:00 and Saturday afternoon is 12:00-16:00', () => {
    assert.deepEqual(WINDOWS, {
        morning: { start: 5 * 3600, end: 7.5 * 3600 },
        evening: { start: 17 * 3600, end: 20 * 3600 },
        afternoon: { start: 12 * 3600, end: 16 * 3600 },
    });
});

test('plans are sorted, have unique ids and differ from day to day', () => {
    const signatures = new Set();
    for (let seed = 1; seed <= 30; seed += 1) {
        const plan = planDay({ random: seeded(seed), isPostingDay: true });
        plan.slice(1).forEach(({ atSecond }, index) => assert.ok(atSecond >= plan[index].atSecond));
        assert.equal(new Set(plan.map(({ id }) => id)).size, 4);
        signatures.add(plan.map(({ atSecond }) => atSecond).join(','));
    }
    assert.equal(signatures.size, 30);
});

test('a non-posting day has no posts', () => {
    assert.deepEqual(planDay({ isPostingDay: false }), []);
});

test('a late start only plans what is left of the day', () => {
    const afternoon = planDay({ random: seeded(3), isPostingDay: true, fromSecond: 12 * 3600 });
    assert.ok(afternoon.every((entry) => entry.period === 'evening'));
    assert.equal(afternoon.length, 2);

    const lateEvening = planDay({ random: seeded(3), isPostingDay: true, fromSecond: 19 * 3600 + 15 * 60 });
    assert.ok(lateEvening.length <= 1);
    lateEvening.forEach(({ atSecond }) => assert.ok(atSecond >= 19 * 3600 + 15 * 60));

    assert.deepEqual(planDay({ isPostingDay: true, fromSecond: 21 * 3600 }), []);
});

test('rejects an invalid random source', () => {
    assert.throws(() => planDay({ random: () => 1, isPostingDay: true }), /range \[0, 1\)/);
});

test('reads local time and date in the schedule timezone', () => {
    const date = new Date('2026-11-09T21:30:15Z');
    assert.equal(localSecondsFor(date, 'Africa/Nairobi'), 30 * 60 + 15);
    assert.equal(localDateKeyFor(date, 'Africa/Nairobi'), '2026-11-10');
});
