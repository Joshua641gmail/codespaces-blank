const test = require('node:test');
const assert = require('node:assert/strict');
const { isWeekdayFor, selectWeekdayImage, weekdayNameFor } = require('../lib/image-selection');

test('gets the weekday in the configured timezone', () => {
    assert.equal(weekdayNameFor(new Date('2026-10-19T07:30:00Z'), 'Africa/Nairobi'), 'MONDAY');
    assert.equal(weekdayNameFor(new Date('2026-10-18T21:30:00Z'), 'Africa/Nairobi'), 'MONDAY');
});

test('recognizes weekdays in the configured timezone', () => {
    assert.equal(isWeekdayFor(new Date('2026-10-23T18:30:00Z'), 'Africa/Nairobi'), true);
    assert.equal(isWeekdayFor(new Date('2026-10-24T12:00:00Z'), 'Africa/Nairobi'), false);
});

test('selects the matching weekday PNG while ignoring other files', () => {
    const expected = { id: 'image', name: 'MONDAY.png', mimeType: 'image/png' };
    const files = [
        { id: 'doc', name: 'MONDAY.png', mimeType: 'application/pdf' },
        { id: 'other', name: 'TUESDAY.png', mimeType: 'image/png' },
        { id: 'old', name: '18th_october_2026.png', mimeType: 'image/png' },
        expected,
    ];

    assert.equal(selectWeekdayImage(files, 'MONDAY'), expected);
});

test('skips a missing weekday image and rejects ambiguous weekday images', () => {
    assert.equal(selectWeekdayImage([], 'MONDAY'), undefined);
    assert.throws(() => selectWeekdayImage([
        { id: 'one', name: 'MONDAY.png', mimeType: 'image/png' },
        { id: 'two', name: 'MONDAY.png', mimeType: 'image/png' },
    ], 'MONDAY'), /More than one image named MONDAY\.png/);
    assert.throws(() => selectWeekdayImage([], 'FUNDAY'), /Invalid weekday: FUNDAY/);
});
