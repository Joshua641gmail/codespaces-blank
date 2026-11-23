const PERIODS = ['morning', 'evening', 'afternoon'];

function weekdayNameFor(date, timeZone) {
    return new Intl.DateTimeFormat('en', {
        timeZone,
        weekday: 'long',
    }).format(date).toUpperCase();
}

// Posting runs Monday to Saturday, up to and including lastPostDate ('YYYY-MM-DD', schedule timezone).
function isPostingDay(date, timeZone, dateKey, lastPostDate) {
    if (lastPostDate && dateKey > lastPostDate) {
        return false;
    }
    return weekdayNameFor(date, timeZone) !== 'SUNDAY';
}

// Only MORNING.png, EVENING.png, AFTERNOON.png (Saturday post) and ODOI.png are ever used, and only as real image files.
function selectImage(files, period) {
    if (!PERIODS.includes(period)) {
        throw new Error(`Invalid period: ${period}`);
    }

    const expectedName = `${period.toUpperCase()}.png`;
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

const ODOI_IMAGE_NAME = 'ODOI.png';

// ODOI.png is matched by its exact name, like the other two images.
function selectOdoiImage(files) {
    const matchingImages = files.filter((file) => (
        file.mimeType?.startsWith('image/')
        && file.name === ODOI_IMAGE_NAME
    ));

    if (matchingImages.length > 1) {
        throw new Error(`More than one image named ${ODOI_IMAGE_NAME} was found in the configured Drive folder.`);
    }

    return matchingImages[0];
}

// BROLINE / BREILINE: matched by exact name without the file extension (BROLINE.png, BROLINE.jpg...).
function selectExtraImage(files, baseName) {
    const matchingImages = files.filter((file) => (
        file.mimeType?.startsWith('image/')
        && file.name?.replace(/\.[^.]+$/, '') === baseName
    ));

    if (matchingImages.length > 1) {
        throw new Error(`More than one image named ${baseName} was found in the configured Drive folder.`);
    }

    return matchingImages[0];
}

// Any image in the Drive folder by its exact file name (used for window images and custom images).
function selectNamedImage(files, fileName) {
    const matchingImages = files.filter((file) => (
        file.mimeType?.startsWith('image/')
        && file.name === fileName
    ));

    if (matchingImages.length > 1) {
        throw new Error(`More than one image named ${fileName} was found in the configured Drive folder.`);
    }

    return matchingImages[0];
}

module.exports = { ODOI_IMAGE_NAME, selectNamedImage, selectExtraImage, PERIODS, selectOdoiImage, isPostingDay, selectImage, weekdayNameFor };
