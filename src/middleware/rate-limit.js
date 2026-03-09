const { assertRateLimit } = require("../services/rate-limit.service");

module.exports = function rateLimit({ max, windowMs, code, message, keyResolver }) {
    return async (req, _res, next) => {
        try {
            const resolvedKey = keyResolver
                ? keyResolver(req)
                : `${req.auth?.user?.id || req.ip}:${req.path}`;

            await assertRateLimit({
                key: resolvedKey,
                max,
                windowMs,
                code,
                message
            });

            next();
        } catch (error) {
            next(error);
        }
    };
};
