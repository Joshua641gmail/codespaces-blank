const test = require('node:test');
const assert = require('node:assert/strict');
const { isPostingDay, selectImage, weekdayNameFor } = require('../lib/image-selection');

test('gets the weekday in the configured timezone', () => {
    assert.equal(weekdayNameFor(new Date('2026-10-19T07:30:00Z'), 'Africa/Nairobi'), 'MONDAY');
    assert.equal(weekdayNameFor(new Date('2026-10-18T21:30:00Z'), 'Africa/Nairobi'), 'MONDAY');
});

test('posts Monday to Saturday, never on Sunday', () => {
    const tz = 'Africa/Nairobi';
    assert.equal(isPostingDay(new Date('2026-11-16T05:00:00Z'), tz, '2026-11-16', '2026-12-05'), true); // Monday
    assert.equal(isPostingDay(new Date('2026-11-21T05:00:00Z'), tz, '2026-11-21', '2026-12-05'), true); // Saturday
    assert.equal(isPostingDay(new Date('2026-11-22T05:00:00Z'), tz, '2026-11-22', '2026-12-05'), false); // Sunday
});

test('the last post day is included and the day after is not', () => {
    const tz = 'Africa/Nairobi';
    assert.equal(isPostingDay(new Date('2026-12-05T05:00:00Z'), tz, '2026-12-05', '2026-12-05'), true);
    assert.equal(isPostingDay(new Date('2026-12-07T05:00:00Z'), tz, '2026-12-07', '2026-12-05'), false);
});

test('picks only MORNING.png and EVENING.png and ignores everything else', () => {
    const morning = { id: 'm', name: 'MORNING.png', mimeType: 'image/png' };
    const evening = { id: 'e', name: 'EVENING.png', mimeType: 'image/png' };
    const files = [
        { id: 'doc', name: 'MORNING.png', mimeType: 'application/pdf' },
        { id: 'day', name: 'MONDAY.png', mimeType: 'image/png' },
        { id: 'lower', name: 'morning.png', mimeType: 'image/png' },
        morning,
        evening,
    ];
    assert.equal(selectImage(files, 'morning'), morning);
    assert.equal(selectImage(files, 'evening'), evening);
});

test('skips a missing image, rejects duplicates and unknown periods', () => {
    assert.equal(selectImage([{ id: 'x', name: 'MONDAY.png', mimeType: 'image/png' }], 'morning'), undefined);
    assert.throws(() => selectImage([
        { id: 'one', name: 'EVENING.png', mimeType: 'image/png' },
        { id: 'two', name: 'EVENING.png', mimeType: 'image/png' },
    ], 'evening'), /More than one image named EVENING\.png/);
    assert.throws(() => selectImage([], 'noon'), /Invalid period: noon/);
});
