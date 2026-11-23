// Posts are planned fresh each day at random times from the schedule's windows (see
// lib/settings.js): each window has a number of posts, a minimum gap between them and the days it
// runs on. Everything that follows a post (ODOI, BROLINE, ...) is sent in the same group a
// short while after it and is not planned here.

const { windowsForDate } = require('./settings');

const HOUR = 60 * 60;

function nextRandom(random) {
    const value = random();
    if (value < 0 || value >= 1) {
        throw new Error('Random source must return a value in the range [0, 1).');
    }
    return value;
}

// Plans up to `count` posts inside a window at random times, at least the window's gap apart.
// Too little time left in the window (a late start) means fewer posts rather than squeezed ones.
function planWindow(window, random, fromSecond, count) {
    const start = Math.max(window.start, Math.floor(fromSecond));
    if (start >= window.end) {
        return [];
    }

    for (let posts = count; posts > 0; posts -= 1) {
        const room = window.end - start - (posts - 1) * window.gapSeconds;
        if (room <= 0) {
            continue;
        }

        // Random times with the gaps built in, so the gap rule always holds.
        const offsets = Array.from({ length: posts }, () => Math.floor(nextRandom(random) * room))
            .sort((x, y) => x - y);
        return offsets.map((offset, index) => ({
            type: 'image',
            period: window.id,
            atSecond: start + offset + index * window.gapSeconds,
        }));
    }
    return [];
}

// `doneByWindow` says how many posts of each window are already used today (a re-plan only
// fills in what is left) and `idSuffix` keeps ids of re-planned posts apart from earlier ones.
function planDay({ random = Math.random, schedule, dateKey, weekday, fromSecond = 0, doneByWindow = {}, idSuffix = '' }) {
    const entries = [];
    for (const window of windowsForDate(schedule, dateKey, weekday)) {
        const count = window.posts - (doneByWindow[window.id] || 0);
        if (count > 0) {
            entries.push(...planWindow(window, random, fromSecond, count));
        }
    }

    return entries
        .sort((a, b) => a.atSecond - b.atSecond)
        .map((entry, index) => ({ id: `${entry.period}-${idSuffix}${index + 1}`, ...entry }));
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
    localDateKeyFor,
    localSecondsFor,
    planDay,
};
