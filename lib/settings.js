// Settings that can be changed from the browser pages instead of by redeploying: the daily
// schedule (windows), the texts sent with each image, and extra custom images.

const { fail } = require('./validation');
const { stepKeys, validateChains } = require('./chain');

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const STYLES = ['morning', 'evening', 'afternoon'];
const LIMITS = {
    windows: 8,
    postsPerWindow: 6,
    minGapMinutes: 30,
    maxGapMinutes: 600,
    maxPostsPerDay: 20,
    warnPostsPerDay: 8,
    exceptions: 20,
    customImages: 8,
    captionLength: 1024,
    variants: 20,
};
const ID_PATTERN = /^[a-z][a-z0-9]{0,15}$/;
const GROUP_ID_PATTERN = /^[\d-]+@g\.us$/;

function parseTime(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
    if (!match) {
        return undefined;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours > 23 || minutes > 59 ? undefined : hours * 3600 + minutes * 60;
}

function formatTime(seconds) {
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// The schedule the service started with: two morning and two evening posts Monday to Saturday,
// one Saturday afternoon post, and 23 November 2026 keeping the narrower original windows.
function defaultSchedule() {
    const monToSat = DAYS.slice(0, 6);
    return {
        windows: [
            { id: 'morning', name: 'Morning', start: '05:00', end: '10:00', posts: 2, gapMinutes: 60, days: monToSat, style: 'morning', image: 'MORNING.png', textIfMissing: false },
            { id: 'afternoon', name: 'Afternoon', start: '12:00', end: '16:00', posts: 1, gapMinutes: 60, days: ['SATURDAY'], style: 'afternoon', image: 'AFTERNOON.png', textIfMissing: true },
            { id: 'evening', name: 'Evening', start: '17:00', end: '22:00', posts: 2, gapMinutes: 60, days: monToSat, style: 'evening', image: 'EVENING.png', textIfMissing: false },
        ],
        exceptions: [
            { date: '2026-11-23', window: 'morning', start: '05:00', end: '07:30' },
            { date: '2026-11-23', window: 'evening', start: '17:00', end: '20:00' },
        ],
    };
}

function checkRange(label, start, end, posts, gapMinutes) {
    const from = parseTime(start);
    const to = parseTime(end);
    if (from === undefined || to === undefined) {
        fail(`${label}: times must look like 05:30.`);
    }
    if (to <= from) {
        fail(`${label}: the end time must be after the start time.`);
    }
    if ((posts - 1) * gapMinutes * 60 > to - from) {
        fail(`${label}: ${posts} posts ${gapMinutes} minutes apart do not fit between ${start} and ${end}.`);
    }
}

function isRealDate(text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return false;
    }
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validateSchedule(input) {
    const rawWindows = input?.windows;
    if (!Array.isArray(rawWindows) || rawWindows.length < 1 || rawWindows.length > LIMITS.windows) {
        fail(`Add between 1 and ${LIMITS.windows} windows.`);
    }

    const used = new Set(rawWindows.map((w) => w?.id).filter((id) => typeof id === 'string' && ID_PATTERN.test(id)));
    const seenIds = new Set();
    let nextNumber = 1;
    const windows = rawWindows.map((raw, index) => {
        const label = `Window ${index + 1}`;
        let id = typeof raw?.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : undefined;
        if (!id || seenIds.has(id)) {
            while (used.has(`w${nextNumber}`)) {
                nextNumber += 1;
            }
            id = `w${nextNumber}`;
            used.add(id);
        }
        seenIds.add(id);

        const name = String(raw?.name ?? '').trim();
        if (name.length < 1 || name.length > 30) {
            fail(`${label}: give it a name of 1 to 30 characters.`);
        }
        const posts = Number(raw.posts);
        if (!Number.isInteger(posts) || posts < 1 || posts > LIMITS.postsPerWindow) {
            fail(`${name}: posts must be a whole number from 1 to ${LIMITS.postsPerWindow}.`);
        }
        const gapMinutes = Number(raw.gapMinutes);
        if (!Number.isInteger(gapMinutes) || gapMinutes < LIMITS.minGapMinutes || gapMinutes > LIMITS.maxGapMinutes) {
            fail(`${name}: the gap between posts must be ${LIMITS.minGapMinutes} to ${LIMITS.maxGapMinutes} minutes.`);
        }
        checkRange(name, raw.start, raw.end, posts, gapMinutes);

        const days = Array.isArray(raw.days) ? DAYS.filter((day) => raw.days.includes(day)) : [];
        if (days.length === 0) {
            fail(`${name}: pick at least one day.`);
        }
        if (!STYLES.includes(raw.style)) {
            fail(`${name}: the message style must be one of ${STYLES.join(', ')}.`);
        }
        const image = String(raw.image ?? '').trim();
        if (image.length > 100 || /[/\\]/.test(image)) {
            fail(`${name}: the image name must be a plain file name.`);
        }

        return {
            id,
            name,
            start: formatTime(parseTime(raw.start)),
            end: formatTime(parseTime(raw.end)),
            posts,
            gapMinutes,
            days,
            style: raw.style,
            image,
            textIfMissing: raw.textIfMissing === true,
        };
    });

    const rawExceptions = input.exceptions ?? [];
    if (!Array.isArray(rawExceptions) || rawExceptions.length > LIMITS.exceptions) {
        fail(`At most ${LIMITS.exceptions} special dates.`);
    }
    const exceptionKeys = new Set();
    const exceptions = rawExceptions.map((raw, index) => {
        const label = `Special date ${index + 1}`;
        const date = String(raw?.date ?? '').trim();
        if (!isRealDate(date)) {
            fail(`${label}: the date must look like 2026-11-23.`);
        }
        const target = windows.find((w) => w.id === raw.window);
        if (!target) {
            fail(`${label}: pick one of the windows.`);
        }
        if (exceptionKeys.has(`${date}:${target.id}`)) {
            fail(`${label}: ${target.name} already has a special time on ${date}.`);
        }
        exceptionKeys.add(`${date}:${target.id}`);
        checkRange(`${label} (${target.name})`, raw.start, raw.end, target.posts, target.gapMinutes);
        return { date, window: target.id, start: formatTime(parseTime(raw.start)), end: formatTime(parseTime(raw.end)) };
    });

    for (const day of DAYS) {
        const total = windows.filter((w) => w.days.includes(day)).reduce((sum, w) => sum + w.posts, 0);
        if (total > LIMITS.maxPostsPerDay) {
            fail(`${day[0]}${day.slice(1).toLowerCase()} would have ${total} posts; the limit is ${LIMITS.maxPostsPerDay} per day.`);
        }
    }

    return { windows, exceptions };
}

// A saved schedule that is missing or no longer valid falls back to the default.
function normalizeSchedule(saved) {
    if (!saved) {
        return defaultSchedule();
    }
    try {
        return validateSchedule(saved);
    } catch {
        return defaultSchedule();
    }
}

// Things worth a second look but not wrong enough to refuse.
function scheduleWarnings(schedule) {
    const warnings = [];
    for (const day of DAYS) {
        const todays = schedule.windows.filter((w) => w.days.includes(day));
        const total = todays.reduce((sum, w) => sum + w.posts, 0);
        const name = `${day[0]}${day.slice(1).toLowerCase()}`;
        if (total > LIMITS.warnPostsPerDay) {
            warnings.push(`${name}: ${total} posts per group (each post sends several images). A lot of volume is what WhatsApp tends to react to.`);
        }
        const sorted = [...todays].sort((a, b) => parseTime(a.start) - parseTime(b.start));
        sorted.slice(1).forEach((window, index) => {
            if (parseTime(window.start) < parseTime(sorted[index].end)) {
                warnings.push(`${name}: ${sorted[index].name} and ${window.name} overlap, so their posts can land close together.`);
            }
        });
    }
    return [...new Set(warnings)];
}

// The windows that run on one date, with any special times for that date applied, in seconds.
function windowsForDate(schedule, dateKey, weekday) {
    return schedule.windows
        .filter((window) => window.days.includes(weekday))
        .map((window) => {
            const special = schedule.exceptions.find((e) => e.date === dateKey && e.window === window.id);
            return {
                id: window.id,
                name: window.name,
                style: window.style,
                image: window.image,
                textIfMissing: window.textIfMissing,
                posts: window.posts,
                gapSeconds: window.gapMinutes * 60,
                start: parseTime(special ? special.start : window.start),
                end: parseTime(special ? special.end : window.end),
            };
        });
}

// ---- texts and custom images

function cleanText(value, label) {
    const text = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
    return text;
}

// Several texts for one image are separated by a line with only ---; they rotate.
function splitVariants(text) {
    return String(text || '').split(/^[ \t]*-{3,}[ \t]*$/m).map((part) => part.trim()).filter(Boolean);
}

function validateCaptions(input) {
    const raw = input?.captions ?? {};
    const captions = { window: {}, odoi: '', broline: '', breiline: '' };

    for (const key of ['odoi', 'broline', 'breiline']) {
        const text = cleanText(raw[key]);
        if (text.length > LIMITS.captionLength) {
            fail(`The ${key.toUpperCase()} text is longer than ${LIMITS.captionLength} characters, WhatsApp's limit for a caption.`);
        }
        captions[key] = text;
    }

    for (const [id, value] of Object.entries(raw.window ?? {})) {
        if (!ID_PATTERN.test(id)) {
            fail(`Unknown window: ${id}`);
        }
        const text = cleanText(value);
        const variants = splitVariants(text);
        if (variants.length > LIMITS.variants) {
            fail(`At most ${LIMITS.variants} texts per image.`);
        }
        if (variants.some((variant) => variant.length > LIMITS.captionLength)) {
            fail(`Each text must be at most ${LIMITS.captionLength} characters, WhatsApp's limit for a caption.`);
        }
        if (text) {
            captions.window[id] = text;
        }
    }

    const rawImages = input?.customImages ?? [];
    if (!Array.isArray(rawImages) || rawImages.length > LIMITS.customImages) {
        fail(`At most ${LIMITS.customImages} custom images.`);
    }
    const usedIds = new Set(rawImages.map((image) => image?.id).filter((id) => typeof id === 'string' && /^c\d{1,2}$/.test(id)));
    const seen = new Set();
    let next = 1;
    const customImages = rawImages.map((image, index) => {
        let id = typeof image?.id === 'string' && /^c\d{1,2}$/.test(image.id) ? image.id : undefined;
        if (!id || seen.has(id)) {
            while (usedIds.has(`c${next}`)) {
                next += 1;
            }
            id = `c${next}`;
            usedIds.add(id);
        }
        seen.add(id);

        const label = String(image?.label ?? '').trim();
        const file = String(image?.file ?? '').trim();
        const caption = cleanText(image?.caption);
        if (label.length < 1 || label.length > 30) {
            fail(`Custom image ${index + 1}: give it a label of 1 to 30 characters.`);
        }
        if (file.length < 1 || file.length > 100 || /[/\\]/.test(file)) {
            fail(`Custom image ${index + 1}: enter the exact file name from the Drive folder.`);
        }
        if (caption.length > LIMITS.captionLength) {
            fail(`Custom image ${index + 1}: the text is longer than ${LIMITS.captionLength} characters.`);
        }
        return { id, label, file, caption };
    });

    return { captions, customImages };
}

// ---- backup / restore of everything that can be changed from the pages

const BACKUP_FORMAT = 'alex-settings-1';

function validateBackup(input) {
    if (input?.format !== BACKUP_FORMAT || typeof input.settings !== 'object' || !input.settings) {
        fail('This is not a settings backup made by this service.');
    }
    const source = input.settings;
    const patch = {};

    if (source.schedule) {
        patch.schedule = validateSchedule(source.schedule);
    }
    let customImages = [];
    if (source.captions || source.customImages) {
        const clean = validateCaptions({ captions: source.captions, customImages: source.customImages });
        patch.captions = clean.captions;
        patch.customImages = clean.customImages;
        customImages = clean.customImages;
    }
    if (source.chains) {
        patch.chains = validateChains({ chains: source.chains }, stepKeys(customImages));
    }
    for (const key of ['addedGroups', 'removedGroups']) {
        if (source[key] !== undefined) {
            if (!Array.isArray(source[key]) || !source[key].every((id) => GROUP_ID_PATTERN.test(id))) {
                fail(`${key} must be a list of group IDs.`);
            }
            patch[key] = source[key];
        }
    }
    return patch;
}

function buildBackup(state) {
    const settings = {};
    for (const key of ['schedule', 'captions', 'customImages', 'chains', 'addedGroups', 'removedGroups']) {
        if (state[key] !== undefined) {
            settings[key] = state[key];
        }
    }
    return { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), settings };
}

module.exports = {
    DAYS,
    GROUP_ID_PATTERN,
    LIMITS,
    STYLES,
    buildBackup,
    defaultSchedule,
    formatTime,
    normalizeSchedule,
    parseTime,
    scheduleWarnings,
    splitVariants,
    validateBackup,
    validateCaptions,
    validateSchedule,
    windowsForDate,
};
