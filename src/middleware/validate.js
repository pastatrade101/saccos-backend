const AppError = require("../utils/app-error");

module.exports = (schema, source = "body") => (req, res, next) => {
    const parsed = schema.safeParse(req[source]);

    if (!parsed.success) {
        return next(
            new AppError(400, "VALIDATION_ERROR", "Request validation failed.", {
                issues: parsed.error.flatten()
            })
        );
    }

    req.validated = req.validated || {};
    req.validated[source] = parsed.data;

    return next();
};
