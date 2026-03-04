const AppError = require("../utils/app-error");

const windows = new Map();

function getWindow(key, windowMs) {
    const now = Date.now();
    const current = windows.get(key);

    if (!current || now > current.resetAt) {
        const next = {
            count: 0,
            resetAt: now + windowMs
        };
        windows.set(key, next);
        return next;
    }

    return current;
}

function assertRateLimit({
    key,
    max,
    windowMs,
    code = "RATE_LIMIT_EXCEEDED",
    message = "Too many requests. Try again later."
}) {
    if (!max || !windowMs) {
        return;
    }

    const bucket = getWindow(key, windowMs);

    if (bucket.count >= max) {
        throw new AppError(429, code, message, {
            retry_after_ms: Math.max(bucket.resetAt - Date.now(), 0)
        });
    }

    bucket.count += 1;
}

module.exports = {
    assertRateLimit
};
