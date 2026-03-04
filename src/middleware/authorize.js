const AppError = require("../utils/app-error");

function authorize(allowedRoles = [], options = {}) {
    const { allowInternalOps = true } = options;

    return (req, res, next) => {
        if (!req.auth) {
            return next(new AppError(500, "AUTH_CONTEXT_MISSING", "Authentication context is missing."));
        }

        if (allowInternalOps && req.auth.isInternalOps) {
            return next();
        }

        if (!allowedRoles.includes(req.auth.role)) {
            return next(new AppError(403, "FORBIDDEN", "You are not authorized to perform this action."));
        }

        return next();
    };
}

module.exports = authorize;
