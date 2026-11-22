// What is sent in each group for one scheduled post, and in what order.
// A post is a short chain of steps: the window's own image (with the rotating message), the
// ODOI image, and the BROLINE / BREILINE images. Each post slot (for example "morning-1") has
// its own order and its own on/off switches, which can be changed from the /order page.

const STEP_KEYS = ['regular', 'odoi', 'broline', 'breiline'];

// How many post slots each window normally has.
const SLOTS = { morning: 2, evening: 2, afternoon: 1 };

function slotKey(period, slot) {
    return `${period}-${slot}`;
}

function allSlotKeys() {
    return Object.entries(SLOTS).flatMap(([period, count]) => (
        Array.from({ length: count }, (_, index) => slotKey(period, index + 1))
    ));
}

// Default: window image, then ODOI, then BROLINE in a window's first post and BREILINE in its
// second, so each of them goes out once per morning and once per evening.
function defaultChain(period, slot) {
    const extra = period === 'afternoon' ? undefined : { 1: 'broline', 2: 'breiline' }[slot];
    return STEP_KEYS.map((key) => ({
        key,
        on: key === 'regular' || key === 'odoi' || key === extra,
    }));
}

// Turns whatever was saved into a complete, valid chain (every step present once).
function normalizeChain(saved, period, slot) {
    if (!Array.isArray(saved)) {
        return defaultChain(period, slot);
    }

    const seen = new Set();
    const chain = [];
    for (const item of saved) {
        if (item && STEP_KEYS.includes(item.key) && !seen.has(item.key)) {
            seen.add(item.key);
            chain.push({ key: item.key, on: item.on === true });
        }
    }
    for (const key of STEP_KEYS) {
        if (!seen.has(key)) {
            chain.push({ key, on: false });
        }
    }
    return chain;
}

function getChain(chains, period, slot) {
    return normalizeChain(chains?.[slotKey(period, slot)], period, slot);
}

function enabledSteps(chain) {
    return chain.filter((item) => item.on).map((item) => item.key);
}

// Checks what the /order page sends before it is saved. Strict on purpose.
function validateChains(body) {
    const chains = body?.chains;
    if (!chains || typeof chains !== 'object' || Array.isArray(chains)) {
        throw new Error('Expected {"chains": {...}}.');
    }

    const allowed = allSlotKeys();
    const clean = {};
    for (const [key, chain] of Object.entries(chains)) {
        if (!allowed.includes(key)) {
            throw new Error(`Unknown post slot: ${key}`);
        }
        const keys = Array.isArray(chain) ? chain.map((item) => item?.key) : [];
        if (keys.length !== STEP_KEYS.length || new Set(keys).size !== STEP_KEYS.length || !keys.every((k) => STEP_KEYS.includes(k))) {
            throw new Error(`The order for ${key} must list each of ${STEP_KEYS.join(', ')} once.`);
        }
        if (chain.some((item) => typeof item.on !== 'boolean')) {
            throw new Error(`Every step of ${key} needs on: true or false.`);
        }
        clean[key] = chain.map((item) => ({ key: item.key, on: item.on }));
    }
    return clean;
}

function stepLabel(key, period) {
    return {
        regular: `${period} image + message`,
        odoi: 'ODOI',
        broline: 'BROLINE',
        breiline: 'BREILINE',
    }[key];
}

module.exports = {
    SLOTS,
    STEP_KEYS,
    allSlotKeys,
    defaultChain,
    enabledSteps,
    getChain,
    normalizeChain,
    slotKey,
    stepLabel,
    validateChains,
};
