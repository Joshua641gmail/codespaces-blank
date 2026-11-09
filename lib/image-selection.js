const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function weekdayNameFor(date, timeZone) {
    return new Intl.DateTimeFormat('en', {
        timeZone,
        weekday: 'long',
    }).format(date).toUpperCase();
}

function isWeekdayFor(date, timeZone) {
    const weekday = weekdayNameFor(date, timeZone);
    return weekday !== 'SATURDAY' && weekday !== 'SUNDAY';
}

function selectWeekdayImage(files, weekday) {
    if (!weekdays.includes(weekday)) {
        throw new Error(`Invalid weekday: ${weekday}`);
    }

    const expectedName = `${weekday}.png`;
    const matchingImages = files.filter((file) => (
        file.mimeType?.startsWith('image/')
        && file.name === expectedName
    ));

    if (matchingImages.length === 0) {
        return undefined;
    }
    if (matchingImages.length > 1) {
        throw new Error(`More than one image named ${expectedName} was found in the configured Drive folder.`);
    }

    return matchingImages[0];
}

module.exports = { isWeekdayFor, selectWeekdayImage, weekdayNameFor };
