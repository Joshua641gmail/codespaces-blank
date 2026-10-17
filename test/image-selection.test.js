const test = require('node:test');
const assert = require('node:assert/strict');
const { dateNameFor, selectDateImage } = require('../lib/image-selection');

test('formats the date as a lowercase ordinal day, month, and year', () => {
    assert.equal(dateNameFor(new Date('2021-06-21T12:00:00Z'), 'Africa/Nairobi'), '21st_june_2021');
    assert.equal(dateNameFor(new Date('2021-06-22T12:00:00Z'), 'Africa/Nairobi'), '22nd_june_2021');
    assert.equal(dateNameFor(new Date('2021-06-23T12:00:00Z'), 'Africa/Nairobi'), '23rd_june_2021');
    assert.equal(dateNameFor(new Date('2021-06-11T12:00:00Z'), 'Africa/Nairobi'), '11th_june_2021');
});

test('uses the configured timezone when deriving the day', () => {
    assert.equal(dateNameFor(new Date('2021-06-20T22:00:00Z'), 'Africa/Nairobi'), '21st_june_2021');
});

test('selects a date-named image while ignoring non-images and other dates', () => {
    const expected = { id: 'image', name: '21st_june_2021.jpg', mimeType: 'image/jpeg' };
    const files = [
        { id: 'doc', name: '21st_june_2021.pdf', mimeType: 'application/pdf' },
        { id: 'other', name: '20th_june_2021.png', mimeType: 'image/png' },
        expected,
    ];

    assert.equal(selectDateImage(files, '21st_june_2021'), expected);
});

test('rejects missing and ambiguous date-named images', () => {
    assert.throws(() => selectDateImage([], '21st_june_2021'), /No image named 21st_june_2021/);
    assert.throws(() => selectDateImage([
        { id: 'one', name: '21st_june_2021.jpg', mimeType: 'image/jpeg' },
        { id: 'two', name: '21st_june_2021.png', mimeType: 'image/png' },
    ], '21st_june_2021'), /More than one image matches 21st_june_2021/);
});
