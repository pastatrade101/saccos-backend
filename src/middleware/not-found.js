const AppError = require("../utils/app-error");

module.exports = (req, res, next) => {
    next(new AppError(404, "ROUTE_NOT_FOUND", `Route ${req.method} ${req.originalUrl} was not found.`));
};
