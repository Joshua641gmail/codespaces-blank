// Posting times are planned fresh each day instead of using fixed slots.
// Posts land at random times between DAY_START and DAY_END, never closer
// together than MIN_GAP, and the number of posts also varies day to day.

const HOUR = 60 * 60;

const DAY_START_SECONDS = 6 * HOUR;
const DAY_END_SECONDS = 21 * HOUR + 30 * 60;
const MIN_GAP_SECONDS = HOUR;

// The countdown stays a morning post, but its exact time still varies.
const COUNTDOWN_EARLIEST_SECONDS = 7 * HOUR + 30 * 60;
const COUNTDOWN_LATEST_SECONDS = 10 * HOUR;

const IMAGES_PER_DAY = { min: 2, max: 3 };
const MESSAGES_PER_DAY = { min: 1, max: 2 };

const MAX_ATTEMPTS = 500;

function nextRandom(random) {
    const value = random();
    if (value < 0 || value >= 1) {
        throw new Error('Random source must return a value in the range [0, 1).');
    }
    return value;
}

function randomInt(random, min, max) {
    return min + Math.floor(nextRandom(random) * (max - min + 1));
}

function shuffle(items, random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(nextRandom(random) * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function gapsAreEnough(times, gap) {
    const sorted = times.slice().sort((a, b) => a - b);
    return sorted.every((time, index) => index === 0 || time - sorted[index - 1] >= gap);
}

function planDay({
    random = Math.random,
    isWeekday,
    countdownActive = false,
    fromSecond = DAY_START_SECONDS,
}) {
    const start = Math.max(DAY_START_SECONDS, Math.floor(fromSecond));
    if (start >= DAY_END_SECONDS) {
        return [];
    }

    const fixed = [];
    if (countdownActive) {
        const earliest = Math.max(start, COUNTDOWN_EARLIEST_SECONDS);
        const latest = earliest < COUNTDOWN_LATEST_SECONDS ? COUNTDOWN_LATEST_SECONDS : DAY_END_SECONDS;
        const at = earliest + Math.floor(nextRandom(random) * (latest - earliest));
        fixed.push({ type: 'countdown', atSecond: at });
    }

    let types = [];
    if (isWeekday) {
        types = shuffle([
            ...Array(randomInt(random, IMAGES_PER_DAY.min, IMAGES_PER_DAY.max)).fill('image'),
            ...Array(randomInt(random, MESSAGES_PER_DAY.min, MESSAGES_PER_DAY.max)).fill('message'),
        ], random);
    }

    let times = [];
    while (types.length > 0) {
        let found = false;
        for (let attempt = 0; attempt < MAX_ATTEMPTS && !found; attempt += 1) {
            times = types.map(() => start + Math.floor(nextRandom(random) * (DAY_END_SECONDS - start)));
            found = gapsAreEnough([...fixed.map((entry) => entry.atSecond), ...times], MIN_GAP_SECONDS);
        }
        if (found) {
            break;
        }
        // Not enough room left in the day (for example after a late start): post less.
        types = types.slice(0, -1);
        times = [];
    }

    const counters = { image: 0, message: 0 };
    const planned = times
        .map((atSecond, index) => ({ type: types[index], atSecond }))
        .sort((a, b) => a.atSecond - b.atSecond)
        .map((entry) => {
            const variant = counters[entry.type];
            counters[entry.type] += 1;
            return { ...entry, variant };
        });

    return [...fixed.map((entry) => ({ ...entry, variant: 0 })), ...planned]
        .sort((a, b) => a.atSecond - b.atSecond)
        .map((entry, index) => ({ id: `${entry.type}-${index + 1}`, ...entry }));
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
    DAY_END_SECONDS,
    DAY_START_SECONDS,
    IMAGES_PER_DAY,
    MESSAGES_PER_DAY,
    MIN_GAP_SECONDS,
    localDateKeyFor,
    localSecondsFor,
    planDay,
};
