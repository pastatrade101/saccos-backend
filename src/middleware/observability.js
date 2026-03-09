const env = require("../config/env");
const { getEffectiveTenantId } = require("../utils/request");
const { observeRequest } = require("../services/observability.service");

function normalizeRequestPath(req) {
    const routePath = req.route?.path;
    const baseUrl = req.baseUrl || "";

    if (routePath) {
        return `${baseUrl}${routePath}`;
    }

    const rawPath = (req.originalUrl || req.url || "").split("?")[0];
    return rawPath || "/unknown";
}

module.exports = function observabilityMiddleware(req, res, next) {
    if (!env.observabilityEnabled) {
        return next();
    }

    const startedAtNs = process.hrtime.bigint();

    res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;

        observeRequest({
            method: req.method,
            path: normalizeRequestPath(req),
            statusCode: res.statusCode,
            durationMs,
            tenantId: getEffectiveTenantId(req)
        });
    });

    return next();
};
