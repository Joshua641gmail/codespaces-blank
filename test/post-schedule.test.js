const test = require('node:test');
const assert = require('node:assert/strict');
const { localDateKeyFor, localSecondsFor, planDay } = require('../lib/post-schedule');
const { defaultSchedule, parseTime } = require('../lib/settings');

function seeded(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

const schedule = defaultSchedule();
const MON = { schedule, dateKey: '2026-11-24', weekday: 'TUESDAY' };
const SAT = { schedule, dateKey: '2026-11-28', weekday: 'SATURDAY' };
const SUN = { schedule, dateKey: '2026-11-29', weekday: 'SUNDAY' };

function windowOf(id, special) {
    const base = schedule.windows.find((w) => w.id === id);
    const range = special || base;
    return { start: parseTime(range.start), end: parseTime(range.end), gap: base.gapMinutes * 60 };
}

test('a weekday has two morning and two evening posts inside their windows, gaps preserved', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
        const plan = planDay({ ...MON, random: seeded(seed) });
        assert.equal(plan.length, 4);
        for (const id of ['morning', 'evening']) {
            const entries = plan.filter((entry) => entry.period === id);
            const { start, end, gap } = windowOf(id);
            assert.equal(entries.length, 2);
            for (const { atSecond, type } of entries) {
                assert.equal(type, 'image');
                assert.ok(atSecond >= start && atSecond < end);
            }
            assert.ok(entries[1].atSecond - entries[0].atSecond >= gap);
        }
    }
});

test('Saturday adds exactly one random afternoon post between 12:00 and 16:00; other days have none', () => {
    const times = new Set();
    for (let seed = 1; seed <= 200; seed += 1) {
        const plan = planDay({ ...SAT, random: seeded(seed) });
        const afternoon = plan.filter((entry) => entry.period === 'afternoon');
        assert.equal(plan.length, 5);
        assert.equal(afternoon.length, 1);
        assert.ok(afternoon[0].atSecond >= 12 * 3600 && afternoon[0].atSecond < 16 * 3600);
        times.add(afternoon[0].atSecond);
    }
    assert.ok(times.size > 100);
    assert.equal(planDay({ ...MON, random: seeded(1) }).some((entry) => entry.period === 'afternoon'), false);
});

test('Sunday has no posts because no window runs on Sunday', () => {
    assert.deepEqual(planDay({ ...SUN }), []);
});

test('23 November 2026 keeps the original 5:00-7:30 and 17:00-20:00 windows; other days use the wider ones', () => {
    const special = { morning: { start: '05:00', end: '07:30' }, evening: { start: '17:00', end: '20:00' } };
    let lateMorning = false;
    let lateEvening = false;
    for (let seed = 1; seed <= 300; seed += 1) {
        for (const entry of planDay({ schedule, dateKey: '2026-11-23', weekday: 'MONDAY', random: seeded(seed) })) {
            const { start, end } = windowOf(entry.period, special[entry.period]);
            assert.ok(entry.atSecond >= start && entry.atSecond < end);
        }
        for (const entry of planDay({ ...MON, random: seeded(seed) })) {
            lateMorning ||= entry.period === 'morning' && entry.atSecond > 7.5 * 3600;
            lateEvening ||= entry.period === 'evening' && entry.atSecond > 20 * 3600;
        }
    }
    assert.ok(lateMorning && lateEvening);
});

test('plans are sorted, have unique ids and differ from day to day', () => {
    const a = planDay({ ...MON, random: seeded(1) });
    const b = planDay({ ...MON, random: seeded(2) });
    assert.deepEqual(a.map((e) => e.atSecond), [...a.map((e) => e.atSecond)].sort((x, y) => x - y));
    assert.equal(new Set(a.map(({ id }) => id)).size, 4);
    assert.notDeepEqual(a.map((e) => e.atSecond), b.map((e) => e.atSecond));
});

test('a late start only plans what is left of the day', () => {
    const afternoon = planDay({ ...MON, random: seeded(3), fromSecond: 12 * 3600 });
    assert.equal(afternoon.length, 2);
    afternoon.forEach(({ period }) => assert.equal(period, 'evening'));

    const lateEvening = planDay({ ...MON, random: seeded(3), fromSecond: 21 * 3600 + 15 * 60 });
    assert.ok(lateEvening.length <= 1);
    lateEvening.forEach(({ atSecond }) => assert.ok(atSecond >= 21 * 3600 + 15 * 60));
    assert.deepEqual(planDay({ ...MON, fromSecond: 22 * 3600 }), []);
});

test('a re-plan only fills in what is left: posts already used count towards their window', () => {
    const plan = planDay({ ...MON, random: seeded(4), fromSecond: 8 * 3600, doneByWindow: { morning: 1 }, idSuffix: 'r1-' });
    assert.equal(plan.filter((entry) => entry.period === 'morning').length, 1);
    assert.equal(plan.filter((entry) => entry.period === 'evening').length, 2);
    assert.ok(plan.every((entry) => entry.id.includes('-r1-')));
    assert.deepEqual(planDay({ ...MON, fromSecond: 0, doneByWindow: { morning: 2, evening: 2 } }), []);
});

test('custom windows: any number of windows, posts, gaps and days', () => {
    const custom = {
        windows: [
            { id: 'w1', name: 'Noon', start: '11:00', end: '14:00', posts: 3, gapMinutes: 45, days: ['TUESDAY'], style: 'morning', image: '', textIfMissing: true },
        ],
        exceptions: [],
    };
    for (let seed = 1; seed <= 300; seed += 1) {
        const plan = planDay({ schedule: custom, dateKey: '2026-11-24', weekday: 'TUESDAY', random: seeded(seed) });
        assert.equal(plan.length, 3);
        plan.forEach((entry, index) => {
            assert.equal(entry.period, 'w1');
            assert.ok(entry.atSecond >= 11 * 3600 && entry.atSecond < 14 * 3600);
            if (index > 0) {
                assert.ok(entry.atSecond - plan[index - 1].atSecond >= 45 * 60);
            }
        });
    }
    assert.deepEqual(planDay({ schedule: custom, dateKey: '2026-11-25', weekday: 'WEDNESDAY' }), []);
});

test('rejects an invalid random source', () => {
    assert.throws(() => planDay({ ...MON, random: () => 1 }), /Random source/);
});

test('reads local time and date in the schedule timezone', () => {
    const date = new Date('2026-11-09T21:30:15Z');
    assert.equal(localSecondsFor(date, 'Africa/Nairobi'), 30 * 60 + 15);
    assert.equal(localDateKeyFor(date, 'Africa/Nairobi'), '2026-11-10');
});
