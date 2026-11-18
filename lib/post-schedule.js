// Posts are planned fresh each day: in each of the morning and evening windows, two regular
// image posts and one ODOI post, at random times, at least MIN_GAP apart.

const HOUR = 60 * 60;

const WINDOWS = {
    morning: { start: 5 * HOUR, end: 7 * HOUR + 30 * 60 },
    evening: { start: 17 * HOUR, end: 20 * HOUR },
};
const POSTS_PER_PERIOD = 2;
const ODOI_POSTS_PER_PERIOD = 1;
const MIN_GAP_SECONDS = HOUR;

function nextRandom(random) {
    const value = random();
    if (value < 0 || value >= 1) {
        throw new Error('Random source must return a value in the range [0, 1).');
    }
    return value;
}

// Each window gets POSTS_PER_PERIOD regular image posts plus one ODOI post. All of them are
// spread at random times at least MIN_GAP apart, and which slot is the ODOI post is random,
// so it is mixed in with the others instead of being sent as a batch.
function planPeriod(period, random, fromSecond) {
    const window = WINDOWS[period];
    const start = Math.max(window.start, Math.floor(fromSecond));
    if (start >= window.end) {
        return [];
    }

    for (let count = POSTS_PER_PERIOD + ODOI_POSTS_PER_PERIOD; count > 0; count -= 1) {
        // Room left after reserving the minimum gaps. Too little room: post fewer (late start).
        const room = window.end - start - (count - 1) * MIN_GAP_SECONDS;
        if (room <= 0) {
            continue;
        }

        // Random times with the gaps built in, so the gap rule always holds.
        const offsets = Array.from({ length: count }, () => Math.floor(nextRandom(random) * room))
            .sort((a, b) => a - b);
        const times = offsets.map((offset, index) => start + offset + index * MIN_GAP_SECONDS);

        const odoiSlots = new Set();
        const wanted = Math.min(ODOI_POSTS_PER_PERIOD, count);
        while (odoiSlots.size < wanted) {
            odoiSlots.add(Math.floor(nextRandom(random) * count));
        }

        return times.map((atSecond, index) => ({
            type: 'image',
            kind: odoiSlots.has(index) ? 'odoi' : 'regular',
            period,
            atSecond,
        }));
    }
    return [];
}

function planDay({ random = Math.random, isPostingDay, fromSecond = 0 }) {
    if (!isPostingDay) {
        return [];
    }

    return [...planPeriod('morning', random, fromSecond), ...planPeriod('evening', random, fromSecond)]
        .map((entry, index) => ({ id: `${entry.period}-${index + 1}`, ...entry }));
}

function localSecondsFor(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
    return values.hour * HOUR + values.minute * 60 + values.second;
}

function localDateKeyFor(date, timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

module.exports = {
    MIN_GAP_SECONDS,
    ODOI_POSTS_PER_PERIOD,
    POSTS_PER_PERIOD,
    WINDOWS,
    localDateKeyFor,
    localSecondsFor,
    planDay,
};
