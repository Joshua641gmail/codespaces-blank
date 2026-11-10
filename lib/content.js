// Wording for the posts. Every image caption and every standalone message uses the same
// pool, and a variant is not used again until all of them have been used once.
//
// Each post looks like this:
//
//   Tuesday update
//
//   <one of the messages below>
//
//   ##MUTSINZI ALEX##
//   ##GUILD ASPIRANT##

const MESSAGES = [
    'You have put in the hard work and preparation—now it is time to let it pay off. Trust your training and walk in with confidence!',
    'Believe in your preparation and trust your instincts. You are far more capable than you realize.',
    'An exam is simply your chance to showcase how much you have grown and learned. Go show them what you know!',
    'Success comes to those who prepare with dedication. You’ve done the heavy lifting, now go shine!',
    'Remember how far you have come and how much you have learned. You are completely ready for this challenge.',
    'Every hour of studying you put in was a deposit on your future. Today is the day to collect your return!',
    'Trust the knowledge you\'ve built up along the way. You have all the tools you need to succeed.',
    'Focus on your effort, stay present, and let your brilliance shine through on every page.',
    'You are stronger than your stress and smarter than any exam question. Go prove it to yourself!',
    'Walk into that exam room with your head high—you earned your place, and you are ready.',
    'Challenge yourself to do your absolute best, and leave no room for self-doubt today.',
    'Your dedication and discipline have brought you to this moment. Finish strong!',
    'Success is not about luck; it is about preparation meeting opportunity. This is your opportunity.',
    'Stay calm, stay focused, and remember that you are capable of achieving great things.',
    'One question at a time, one page at a time—you’ve got the knowledge and stamina to pull this off.',
    'Let all your preparation translate into clear thoughts and steady hands. You are made for this!',
    'Do not let fear cloud your potential. You know this material, so trust your intellect.',
    'Your hard work has laid a solid foundation. Step up to the desk with pride and determination.',
    'Believe in your ability to handle whatever questions come your way. You are ready for anything.',
    'Keep your mind sharp, your confidence high, and your heart calm. Wishing you great success on every paper!',
];

// First line of each post. {Day} becomes the weekday name.
const HEADERS = [
    '{Day} update',
    '{Day} encouragement',
    '{Day} motivation',
    'Happy {Day}',
    'A {Day} note for you',
    '{Day} message',
];

const SIGNATURE = ['##MUTSINZI ALEX##', '##GUILD ASPIRANT##'];

function titleCase(weekday) {
    return weekday.charAt(0) + weekday.slice(1).toLowerCase();
}

function shuffle(items, random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// Picks the next message. `state` is { bag, last }: the variants still unused in this round
// and the one used most recently. When the bag is empty a new shuffled round starts, and its
// first pick is never the variant that was just used. Nothing is saved here; the caller saves
// the returned state once a post has actually gone out.
function drawVariant(state = {}, random = Math.random) {
    let bag = (state.bag || []).filter((index) => Number.isInteger(index) && index >= 0 && index < MESSAGES.length);
    const last = Number.isInteger(state.last) ? state.last : null;

    if (bag.length === 0) {
        bag = shuffle(MESSAGES.map((_, index) => index), random);
        if (bag[0] === last && bag.length > 1) {
            [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
        }
    }

    const [index, ...rest] = bag;
    return { index, state: { bag: rest, last: index } };
}

function formatPost(weekday, index, random = Math.random) {
    const header = HEADERS[Math.floor(random() * HEADERS.length)].replaceAll('{Day}', titleCase(weekday));
    return `${header}\n\n${MESSAGES[index]}\n\n${SIGNATURE.join('\n')}`;
}

module.exports = { HEADERS, MESSAGES, SIGNATURE, drawVariant, formatPost };
