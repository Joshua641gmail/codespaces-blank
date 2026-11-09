// Wording for the daily posts. Edit these lists freely; the rotation below
// walks through every combination before repeating, so with the default
// lists nothing repeats for 30+ days. Keep the {Day} placeholder in captions
// that mention the weekday.
//
// Rules if you change the lists:
//  - captions: (openers x closers) must be at least 30 days x 3 images = 90
//  - messages: (leads x tails x 2 layouts) must be at least 30 days x 2 = 60
// The tests check this.

const { IMAGES_PER_DAY, MESSAGES_PER_DAY } = require('./post-schedule');

const CAPTION_OPENERS = [
    'Happy {Day}! ☀️',
    '{Day} update 📢',
    'Making {Day} count 💪',
    'Here is your {Day} reminder.',
    '{Day} greetings, guild family! 👋',
    'Another {Day}, another step forward.',
    'Blessed {Day}, everyone! 🙏',
    'A quick {Day} note 📌',
    'Starting {Day} together 🤝',
    '{Day} motivation 🔥',
];

const CAPTION_CLOSERS = [
    '*ALEX FOR GUILD*',
    'Vote Alex for Guild. ✅',
    'Share with a friend. 📲',
    'Let us do this together! 🙌',
    'Thank you for your support. 🙏',
    'Stay tuned for more.',
    'Your support means everything.',
    'Tell a classmate today.',
    '#AlexForGuild',
    'Together we rise. 🚀',
];

const MESSAGE_LEADS = [
    'Your vote, your voice. 🗳️',
    'Let us build a guild that works for every student.',
    'Together we can do more. 🤝',
    'Every student counts.',
    'Ready for a stronger guild? 💪',
    'Leadership that listens.',
    'Be part of the change you want to see.',
    'One guild, one community.',
    'Make your vote count. ✅',
    'A guild for all of us.',
    'Stand with us, student to student.',
    'Let us move forward together. 🚀',
];

const MESSAGE_TAILS = [
    '',
    'Spread the word. 📣',
    'Tell a friend today. 📲',
    'Thank you for your support. 🙏',
    'Let us keep the energy going! 🔥',
    'Every voice matters.',
];

const captions = CAPTION_OPENERS.flatMap((opener) => CAPTION_CLOSERS.map((closer) => `${opener}\n\n${closer}`));

const messages = [0, 1].flatMap((layout) => MESSAGE_LEADS.flatMap((lead) => MESSAGE_TAILS.map((tail) => {
    const tailLine = tail ? `\n${tail}` : '';
    return layout === 0
        ? `*ALEX FOR GUILD*\n${lead}${tailLine}`
        : `${lead}\n\n*ALEX FOR GUILD*${tailLine}`;
})));

// A stride that shares no factor with the pool size visits every entry once
// before repeating while keeping neighbouring posts very different.
const STRIDE = 37;

function pick(pool, number) {
    return pool[(number * STRIDE) % pool.length];
}

function titleCase(weekday) {
    return weekday.charAt(0) + weekday.slice(1).toLowerCase();
}

// dayNumber is the number of days since 1970 in the schedule timezone, so the
// rotation carries on correctly across restarts without storing any state.
function captionFor(weekday, dayNumber, variant) {
    const text = pick(captions, dayNumber * IMAGES_PER_DAY.max + variant);
    return text.replaceAll('{Day}', titleCase(weekday));
}

function messageFor(dayNumber, variant) {
    return pick(messages, dayNumber * MESSAGES_PER_DAY.max + variant);
}

module.exports = { STRIDE, captionFor, captions, messageFor, messages };
