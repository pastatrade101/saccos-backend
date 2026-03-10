const AppError = require("../utils/app-error");

module.exports = (err, req, res, next) => {
    const normalizedError = (() => {
        if (err instanceof AppError) {
            return err;
        }

        if (typeof err?.message === "string" && err.message.startsWith("Origin not allowed by CORS")) {
            return new AppError(403, "CORS_ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
        }

        return new AppError(500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred.");
    })();

    console.error({
        requestId: req.id,
        code: normalizedError.code,
        message: normalizedError.message,
        details: normalizedError.details,
        error: err instanceof AppError ? undefined : err
    });

    res.locals.apiErrorCode = normalizedError.code;
    res.locals.apiErrorMessage = normalizedError.message;

    res.status(normalizedError.statusCode).json({
        error: {
            code: normalizedError.code,
            message: normalizedError.message,
            details: normalizedError.details,
            requestId: req.id
        }
    });
};
