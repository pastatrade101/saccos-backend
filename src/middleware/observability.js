const env = require("../config/env");
const { getEffectiveTenantId } = require("../utils/request");
const { observeRequest } = require("../services/observability.service");
const { recordApiMetric } = require("../services/api-metrics-collector.service");

function normalizeRequestPath(req) {
    const routePath = req.route?.path;
    const baseUrl = req.baseUrl || "";

    if (routePath) {
        return `${baseUrl}${routePath}`;
    }

    const rawPath = (req.originalUrl || req.url || "").split("?")[0];
    return rawPath || "/unknown";
}

function parseByteCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }

    return Math.round(parsed);
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

        recordApiMetric({
            tenantId: getEffectiveTenantId(req),
            userId: req.auth?.user?.id || null,
            endpoint: (req.originalUrl || req.url || "").split("?")[0] || normalizeRequestPath(req),
            latencyMs: durationMs,
            statusCode: res.statusCode,
            requestBytes: parseByteCount(req.headers["content-length"]),
            responseBytes: parseByteCount(res.getHeader("content-length")),
            errorMessage: res.locals?.apiErrorMessage || null,
            createdAt: new Date().toISOString()
        });
    });

    return next();
};
