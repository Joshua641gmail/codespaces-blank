// Posts are planned fresh each day: two image posts in the morning window and two in the
// evening window, at random times, at least MIN_GAP apart.

const HOUR = 60 * 60;

const WINDOWS = {
    morning: { start: 5 * HOUR, end: 7 * HOUR + 30 * 60 },
    evening: { start: 17 * HOUR, end: 20 * HOUR },
};
const POSTS_PER_PERIOD = 2;
const MIN_GAP_SECONDS = HOUR;
const MAX_ATTEMPTS = 500;

function nextRandom(random) {
    const value = random();
    if (value < 0 || value >= 1) {
        throw new Error('Random source must return a value in the range [0, 1).');
    }
    return value;
}

function planPeriod(period, random, fromSecond) {
    const window = WINDOWS[period];
    const start = Math.max(window.start, Math.floor(fromSecond));
    if (start >= window.end) {
        return [];
    }

    for (let count = POSTS_PER_PERIOD; count > 0; count -= 1) {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
            const times = Array.from({ length: count }, () => start + Math.floor(nextRandom(random) * (window.end - start)))
                .sort((a, b) => a - b);
            if (times.every((time, index) => index === 0 || time - times[index - 1] >= MIN_GAP_SECONDS)) {
                return times.map((atSecond) => ({ type: 'image', period, atSecond }));
            }
        }
        // Not enough room left in the window (for example after a late start): post less.
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
    POSTS_PER_PERIOD,
    WINDOWS,
    localDateKeyFor,
    localSecondsFor,
    planDay,
};
