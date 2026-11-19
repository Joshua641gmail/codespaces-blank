// Wording for the posts. Every post is an image (MORNING.png or EVENING.png) with this text:
//
//   🔷 Good morning 🔷
//
//   <one of the messages for that period>
//
//   🔷 𝗠𝗨𝗧𝗦𝗜𝗡𝗭𝗜 𝗔𝗟𝗘𝗫 🔷
//   🔶 𝗚𝗨𝗜𝗟𝗗 𝗔𝗦𝗣𝗜𝗥𝗔𝗡𝗧 🔶
//
// Morning and evening each have their own pool. A message is not used again until every
// message in its pool has been used once.

const MORNING_MESSAGES = [
    'Take a deep breath, trust what you know, and walk in with a smile. You\'ve got this! 💪',
    'Exam day vibes! ✨ Stay calm, read each question carefully, and show them what you\'re made of.',
    'You\'ve prepared, so just do your best today. Good luck on your paper! 🍀',
    'Today\'s paper is just another step. Relax, breathe, and give it your best shot. We\'re cheering for you! 📣',
    'Wishing you a calm mind and steady hands as you walk into that exam room. Go get it! 🔥',
    'Read slowly, think clearly, and keep smiling. You know more than you think! 😊',
    'One question at a time, and you\'ll sail through. All the best in the exam room! 🙌',
    'Nerves are normal, and they mean you care. Breathe, trust yourself, and shine today! 🌟',
    'Go in with confidence and come out proud. Wishing you the very best on your paper! 👏',
    'You\'ve put in the work, now let it show. Stay relaxed and enjoy the challenge! 😎',
];

const EVENING_MESSAGES = [
    'Rest your mind tonight: a good meal, a few laughs, then a calm look at what\'s next. You\'re doing great! 😄',
    'Books matter, but so does a relaxed mind. 🎶 Take a break, enjoy something you love, then get ready for what\'s next.',
    'Every day is a step toward your future. Study smart, rest well, and make time to smile. 🌟',
    'Stretch, hydrate, share a laugh with friends, then pick up where you left off. You\'ve got plenty to be proud of.',
    'Big dreams need a balanced mind. 🧠✨ Prep a little, relax a little, and sleep well. The days ahead look bright!',
    'Plan a little for tomorrow, then switch off and have some fun. A happy mind learns better! 😊',
    'Your future is built by small steps and good rest. Keep going, keep smiling! 💪',
    'Take a walk, play some music, call a friend. Then give tomorrow\'s prep a friendly look. 🎧',
    'Balance is the secret: a bit of study, a bit of play, plenty of sleep. You\'ve got this! 🙌',
    'Keep your goals in sight and your spirits high. The days ahead are full of possibility! 🚀',
];

// Fixed caption for the ODOI.png post. It is sent exactly as written, with no greeting or signature.
const ODOI_CAPTION = [
    'Success is built long before the results are announced. It is found in the discipline to prepare, the courage to face challenges, and the determination to keep showing up.',
    '',
    'As you write your papers, may your hard work find expression in every answer. Stay calm, trust your preparation, and give each paper your best.',
    '',
    'Remember, you are not just writing exams; you are taking steps towards the future you envision.',
    '',
    'May excellence be your story. All the very best in your papers! ✨',
    '',
    'ODOI JORAM',
].join('\n');

// Saturday afternoon: welcome people back from their papers and encourage them to keep reading.
const AFTERNOON_MESSAGES = [
    'Welcome back from your papers! 🎉 Take a breath, enjoy this afternoon, and then keep reading. Every page counts.',
    'Well done for showing up and giving it your all today! 👏 Rest a little, then get back to your books with a fresh mind.',
    'Another paper behind you. Be proud of the effort! 🌟 Refuel, relax, and keep that reading rhythm going.',
    'Welcome back, champions! 💪 Whatever the paper was like, it\'s done. Eat well, unwind, and keep reading for what\'s next.',
    'You made it through the week\'s papers, and that takes real courage. 🙌 Rest your mind, then keep going. The finish line is closer.',
    'Good to have you back from the exam room! 😊 Celebrate the small wins, then keep your books close for the papers ahead.',
];

const POOLS = { morning: MORNING_MESSAGES, evening: EVENING_MESSAGES, afternoon: AFTERNOON_MESSAGES };

const GREETINGS = {
    morning: '🔷 Good morning 🔷',
    evening: '🔷 Good evening 🔷',
    afternoon: '🔷 Good afternoon 🔷',
};

const SIGNATURE = ['🔷 𝗠𝗨𝗧𝗦𝗜𝗡𝗭𝗜 𝗔𝗟𝗘𝗫 🔷', '🔶 𝗚𝗨𝗜𝗟𝗗 𝗔𝗦𝗣𝗜𝗥𝗔𝗡𝗧 🔶'];

function shuffle(items, random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// Picks the next message for a period. `state` is { bag, last }: the messages still unused
// in this round and the one used most recently. When the bag is empty a new shuffled round
// starts, and its first pick is never the message just used. Nothing is saved here; the
// caller saves the returned state once a post has actually reached a group.
function drawVariant(period, state = {}, random = Math.random) {
    const pool = POOLS[period];
    if (!pool) {
        throw new Error(`Invalid period: ${period}`);
    }

    let bag = (state.bag || []).filter((index) => Number.isInteger(index) && index >= 0 && index < pool.length);
    const last = Number.isInteger(state.last) ? state.last : null;

    if (bag.length === 0) {
        bag = shuffle(pool.map((_, index) => index), random);
        if (bag[0] === last && bag.length > 1) {
            [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
        }
    }

    const [index, ...rest] = bag;
    return { index, state: { bag: rest, last: index } };
}

function formatPost(period, index) {
    return `${GREETINGS[period]}\n\n${POOLS[period][index]}\n\n${SIGNATURE.join('\n')}`;
}

module.exports = { AFTERNOON_MESSAGES, EVENING_MESSAGES, ODOI_CAPTION, GREETINGS, MORNING_MESSAGES, POOLS, SIGNATURE, drawVariant, formatPost };
