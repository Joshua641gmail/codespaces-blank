function ordinalSuffix(day) {
    if (day % 100 >= 11 && day % 100 <= 13) {
        return 'th';
    }

    switch (day % 10) {
        case 1:
            return 'st';
        case 2:
            return 'nd';
        case 3:
            return 'rd';
        default:
            return 'th';
    }
}

function dateNameFor(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'long',
        timeZone,
        year: 'numeric',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const day = Number(values.day);

    return `${day}${ordinalSuffix(day)}_${values.month.toLowerCase()}_${values.year}`;
}

function selectDateImage(files, dateName) {
    const matchingImages = files.filter((file) => (
        file.mimeType?.startsWith('image/')
        && new RegExp(`^${dateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.[^.]+)?$`, 'i').test(file.name)
    ));

    if (matchingImages.length === 0) {
        throw new Error(`No image named ${dateName} (with an image extension) was found in the configured Drive folder.`);
    }
    if (matchingImages.length > 1) {
        throw new Error(`More than one image matches ${dateName}; keep exactly one date-matched image in the Drive folder.`);
    }

    return matchingImages[0];
}

module.exports = { dateNameFor, selectDateImage };
