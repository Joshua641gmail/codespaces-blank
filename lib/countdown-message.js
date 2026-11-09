const START_DATE = Date.UTC(2026, 9, 26);
const EVENT_DATE = Date.UTC(2026, 10, 14);

function dateInTimeZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
}

function countdownDaysFor(date, timeZone) {
    const currentDate = dateInTimeZone(date, timeZone);
    if (currentDate < START_DATE || currentDate > EVENT_DATE) {
        return undefined;
    }

    return (EVENT_DATE - currentDate) / (24 * 60 * 60 * 1000);
}

function countdownMessage(days) {
    return `📍📍📍The countdown is on — ${days} Days to go! ⏳

The *GLOBAL INTER-UNIVERSITY CONFERENCE* is here!!! 🔥

_...happening on_ *🗓️Saturday,14th November 2026 |* Gates open at *9am | FREE ENTRY*

*#GIC2026 | Phaneroo Grounds, Naguru*`;
}

module.exports = { countdownDaysFor, countdownMessage, dateInTimeZone };
