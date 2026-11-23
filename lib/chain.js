// What is sent in each group for one scheduled post, and in what order.
// A post is a short chain of steps: the window's own image (with its message), the ODOI image,
// the BROLINE / BREILINE images and any custom images added on the Captions page. Each post
// slot (for example "morning-1") has its own order and on/off switches, set on the /order page.

const { fail } = require('./validation');

const BASE_STEPS = ['regular', 'odoi', 'broline', 'breiline'];
const SLOT_KEY_PATTERN = /^[a-z][a-z0-9]{0,15}-\d{1,2}$/;

// All step keys in use: the four built-in ones plus one per custom image (c1, c2, ...).
function stepKeys(customImages = []) {
    return [...BASE_STEPS, ...customImages.map((image) => image.id)];
}

function slotKey(windowId, slot) {
    return `${windowId}-${slot}`;
}

// Default: window image, then ODOI, then BROLINE in a window's first post and BREILINE in its
// second, so each of them goes out once per window. The afternoon window gets neither by default.
function defaultChain(windowId, slot, keys = BASE_STEPS) {
    const extra = windowId === 'afternoon' ? undefined : { 1: 'broline', 2: 'breiline' }[slot];
    return keys.map((key) => ({
        key,
        on: key === 'regular' || key === 'odoi' || key === extra,
    }));
}

// Turns whatever was saved into a complete, valid chain (every step present once).
function normalizeChain(saved, windowId, slot, keys = BASE_STEPS) {
    if (!Array.isArray(saved)) {
        return defaultChain(windowId, slot, keys);
    }

    const seen = new Set();
    const chain = [];
    for (const item of saved) {
        if (item && keys.includes(item.key) && !seen.has(item.key)) {
            seen.add(item.key);
            chain.push({ key: item.key, on: item.on === true });
        }
    }
    for (const key of keys) {
        if (!seen.has(key)) {
            chain.push({ key, on: false });
        }
    }
    return chain;
}

function getChain(chains, windowId, slot, keys = BASE_STEPS) {
    return normalizeChain(chains?.[slotKey(windowId, slot)], windowId, slot, keys);
}

function enabledSteps(chain) {
    return chain.filter((item) => item.on).map((item) => item.key);
}

// Checks what the /order page sends before it is saved. Strict on purpose.
function validateChains(body, keys = BASE_STEPS) {
    const chains = body?.chains;
    if (!chains || typeof chains !== 'object' || Array.isArray(chains)) {
        fail('Expected {"chains": {...}}.');
    }

    const clean = {};
    for (const [key, chain] of Object.entries(chains)) {
        if (!SLOT_KEY_PATTERN.test(key)) {
            fail(`Unknown post slot: ${key}`);
        }
        const found = Array.isArray(chain) ? chain.map((item) => item?.key) : [];
        if (found.length !== keys.length || new Set(found).size !== keys.length || !found.every((k) => keys.includes(k))) {
            fail(`The order for ${key} must list each of ${keys.join(', ')} once.`);
        }
        if (chain.some((item) => typeof item.on !== 'boolean')) {
            fail(`Every step of ${key} needs on: true or false.`);
        }
        clean[key] = chain.map((item) => ({ key: item.key, on: item.on }));
    }
    return clean;
}

function stepLabel(key, windowName, customImages = []) {
    const fixed = {
        regular: `${windowName} image + message`,
        odoi: 'ODOI',
        broline: 'BROLINE',
        breiline: 'BREILINE',
    }[key];
    if (fixed) {
        return fixed;
    }
    const custom = customImages.find((image) => image.id === key);
    return custom ? `Custom: ${custom.label}` : key;
}

module.exports = {
    BASE_STEPS,
    defaultChain,
    enabledSteps,
    getChain,
    normalizeChain,
    slotKey,
    stepKeys,
    stepLabel,
    validateChains,
};
