const test = require('node:test');
const assert = require('node:assert/strict');
const { countdownDaysFor, countdownMessage } = require('../lib/countdown-message');

test('counts down by calendar date in the configured timezone', () => {
    assert.equal(countdownDaysFor(new Date('2026-10-25T21:00:00Z'), 'Africa/Nairobi'), 19);
    assert.equal(countdownDaysFor(new Date('2026-11-13T21:00:00Z'), 'Africa/Nairobi'), 0);
});

test('does not schedule a countdown outside the posting date range', () => {
    assert.equal(countdownDaysFor(new Date('2026-10-25T20:59:59Z'), 'Africa/Nairobi'), undefined);
    assert.equal(countdownDaysFor(new Date('2026-11-14T21:00:00Z'), 'Africa/Nairobi'), undefined);
});

test('formats the WhatsApp countdown with the requested event details', () => {
    assert.equal(countdownMessage(19), `📍📍📍The countdown is on — 19 Days to go! ⏳

The *GLOBAL INTER-UNIVERSITY CONFERENCE* is here!!! 🔥

_...happening on_ *🗓️Saturday,14th November 2026 |* Gates open at *9am | FREE ENTRY*

*#GIC2026 | Phaneroo Grounds, Naguru*`);
});
