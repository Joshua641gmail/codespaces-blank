// Errors for bad input from the settings pages. `status` 400 makes the web server answer
// with the message instead of a generic failure.
function fail(message) {
    const error = new Error(message);
    error.status = 400;
    throw error;
}

module.exports = { fail };
