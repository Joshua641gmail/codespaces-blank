// Posts are planned fresh each day at random times: two image posts in the morning window and
// two in the evening window (at least MIN_GAP apart), plus one afternoon post on Saturdays.
// The ODOI post is not planned here: it follows each morning/evening post a minute or so later.

const HOUR = 60 * 60;

const WINDOWS = {
    morning: { start: 5 * HOUR, end: 7 * HOUR + 30 * 60 },
    evening: { start: 17 * HOUR, end: 20 * HOUR },
    // Saturdays only: a welcome-back post for people finishing their papers.
    afternoon: { start: 12 * HOUR, end: 16 * HOUR },
};
const POSTS_PER_PERIOD = 2;
const MIN_GAP_SECONDS = HOUR;

function nextRandom(random) {
    const value = random();
    if (value < 0 || value >= 1) {
        throw new Error('Random source must return a value in the range [0, 1).');
    }
    return value;
}

// Plans `count` posts inside a window at random times, at least MIN_GAP apart. Too little time
// left in the window (a late start) means fewer posts rather than squeezed ones.
function planPeriod(period, random, fromSecond, count) {
    const window = WINDOWS[period];
    const start = Math.max(window.start, Math.floor(fromSecond));
    if (start >= window.end) {
        return [];
    }

    for (let posts = count; posts > 0; posts -= 1) {
        const room = window.end - start - (posts - 1) * MIN_GAP_SECONDS;
        if (room <= 0) {
            continue;
        }

        // Random times with the gaps built in, so the gap rule always holds.
        const offsets = Array.from({ length: posts }, () => Math.floor(nextRandom(random) * room))
            .sort((x, y) => x - y);
        return offsets.map((offset, index) => ({
            type: 'image',
            period,
            atSecond: start + offset + index * MIN_GAP_SECONDS,
        }));
    }
    return [];
}

function planDay({ random = Math.random, isPostingDay, isSaturday = false, fromSecond = 0 }) {
    if (!isPostingDay) {
        return [];
    }

    return [
        ...planPeriod('morning', random, fromSecond, POSTS_PER_PERIOD),
        ...(isSaturday ? planPeriod('afternoon', random, fromSecond, 1) : []),
        ...planPeriod('evening', random, fromSecond, POSTS_PER_PERIOD),
    ].map((entry, index) => ({ id: `${entry.period}-${index + 1}`, ...entry }));
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
    POSTS_PER_PERIOD,
    WINDOWS,
    localDateKeyFor,
    localSecondsFor,
    planDay,
};
