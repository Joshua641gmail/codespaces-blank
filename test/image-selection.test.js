const test = require('node:test');
const assert = require('node:assert/strict');
const { isPostingDay, selectImage, selectExtraImage, selectNamedImage, selectOdoiImage, weekdayNameFor } = require('../lib/image-selection');

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

test('picks only ODOI.png by exact name and image type', () => {
    const odoi = { id: 'o', name: 'ODOI.png', mimeType: 'image/png' };
    const files = [
        { id: 'a', name: 'odoi.png', mimeType: 'image/png' },
        { id: 'b', name: 'ODOI.png', mimeType: 'application/pdf' },
        { id: 'c', name: 'MORNING.png', mimeType: 'image/png' },
        odoi,
    ];
    assert.equal(selectOdoiImage(files), odoi);
    assert.equal(selectOdoiImage([files[2]]), undefined);
    assert.throws(() => selectOdoiImage([odoi, { ...odoi, id: 'o2' }]), /More than one image named ODOI\.png/);
});

test('AFTERNOON.png is matched by exact name; no such image means undefined (text-only fallback)', () => {
    const afternoon = { id: 'a', name: 'AFTERNOON.png', mimeType: 'image/png' };
    assert.equal(selectImage([afternoon], 'afternoon'), afternoon);
    assert.equal(selectImage([{ id: 'm', name: 'MORNING.png', mimeType: 'image/png' }], 'afternoon'), undefined);
});

test('BROLINE and BREILINE are matched by exact name with any image extension', () => {
    const files = [
        { id: '1', name: 'BROLINE.png', mimeType: 'image/png' },
        { id: '2', name: 'BREILINE.jpg', mimeType: 'image/jpeg' },
        { id: '3', name: 'broline.png', mimeType: 'image/png' },
        { id: '4', name: 'BROLINE2.png', mimeType: 'image/png' },
        { id: '5', name: 'BREILINE.pdf', mimeType: 'application/pdf' },
    ];
    assert.equal(selectExtraImage(files, 'BROLINE'), files[0]);
    assert.equal(selectExtraImage(files, 'BREILINE'), files[1]);
    assert.equal(selectExtraImage([files[2]], 'BROLINE'), undefined);
    assert.throws(() => selectExtraImage([files[0], { ...files[0], id: '9', name: 'BROLINE.jpg' }], 'BROLINE'), /More than one image named BROLINE/);
});

test('any image can be picked by its exact file name', () => {
    const files = [
        { id: '1', name: 'Poster.png', mimeType: 'image/png' },
        { id: '2', name: 'poster.png', mimeType: 'image/png' },
        { id: '3', name: 'Poster.pdf', mimeType: 'application/pdf' },
    ];
    assert.equal(selectNamedImage(files, 'Poster.png'), files[0]);
    assert.equal(selectNamedImage(files, 'Poster.pdf'), undefined);
    assert.throws(() => selectNamedImage([files[0], { ...files[0], id: '9' }], 'Poster.png'), /More than one image/);
});
