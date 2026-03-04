const AppError = require("../utils/app-error");

module.exports = (err, req, res, next) => {
    const normalizedError =
        err instanceof AppError
            ? err
            : new AppError(500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred.");

    console.error({
        requestId: req.id,
        code: normalizedError.code,
        message: normalizedError.message,
        details: normalizedError.details,
        error: err instanceof AppError ? undefined : err
    });

    res.status(normalizedError.statusCode).json({
        error: {
            code: normalizedError.code,
            message: normalizedError.message,
            details: normalizedError.details,
            requestId: req.id
        }
    });
};
