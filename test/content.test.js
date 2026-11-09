const test = require('node:test');
const assert = require('node:assert/strict');
const { STRIDE, captionFor, captions, messageFor, messages } = require('../lib/content');

function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}

test('rotation strides visit every entry before repeating', () => {
    assert.equal(gcd(STRIDE, captions.length), 1);
    assert.equal(gcd(STRIDE, messages.length), 1);
});

test('no caption or message repeats across 30 days at the maximum posting rate', () => {
    const day0 = 20_400;
    const usedCaptions = new Set();
    const usedMessages = new Set();
    for (let day = 0; day < 30; day += 1) {
        for (let variant = 0; variant < 3; variant += 1) {
            usedCaptions.add(captionFor('MONDAY', day0 + day, variant));
        }
        for (let variant = 0; variant < 2; variant += 1) {
            usedMessages.add(messageFor(day0 + day, variant));
        }
    }
    assert.equal(usedCaptions.size, 90);
    assert.equal(usedMessages.size, 60);
});

test('every message carries the bold ALEX FOR GUILD line and captions fill in the weekday', () => {
    for (const message of messages) {
        assert.ok(message.includes('*ALEX FOR GUILD*'));
    }
    for (let variant = 0; variant < 3; variant += 1) {
        assert.ok(!captionFor('FRIDAY', 20_500, variant).includes('{Day}'));
    }
    assert.ok(captionFor('FRIDAY', 20_500, 0).length > 0);
});

test('two posts on the same day never share wording', () => {
    assert.notEqual(messageFor(20_500, 0), messageFor(20_500, 1));
    assert.notEqual(captionFor('TUESDAY', 20_500, 0), captionFor('TUESDAY', 20_500, 1));
});
