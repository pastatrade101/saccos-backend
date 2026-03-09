const AppError = require("../utils/app-error");
const { adminSupabase } = require("../config/supabase");

function isMissingRateLimitFunction(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "42883" && message.includes("consume_rate_limit");
}

function isMissingRateLimitTable(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "42P01" && message.includes("api_rate_limit_windows");
}

function toRateLimitSchemaError(error) {
    return new AppError(
        500,
        "RATE_LIMIT_SCHEMA_MISSING",
        "Distributed rate-limit schema is missing. Apply SQL migration 031_phase4_distributed_rate_limits.sql.",
        error
    );
}

async function consumeDistributedRateLimit({ key, max, windowMs }) {
    const { data, error } = await adminSupabase.rpc("consume_rate_limit", {
        p_scope_key: key,
        p_max_requests: max,
        p_window_ms: windowMs
    });

    if (error) {
        if (isMissingRateLimitFunction(error) || isMissingRateLimitTable(error)) {
            throw toRateLimitSchemaError(error);
        }

        throw new AppError(
            500,
            "RATE_LIMIT_CHECK_FAILED",
            "Unable to validate rate limit.",
            error
        );
    }

    const row = Array.isArray(data) ? (data[0] || null) : data;

    if (!row) {
        throw new AppError(
            500,
            "RATE_LIMIT_CHECK_FAILED",
            "Rate limit check returned no result."
        );
    }

    return row;
}

async function assertRateLimit({
    key,
    max,
    windowMs,
    code = "RATE_LIMIT_EXCEEDED",
    message = "Too many requests. Try again later."
}) {
    if (!max || !windowMs) {
        return;
    }

    const result = await consumeDistributedRateLimit({ key, max, windowMs });

    if (!result.allowed) {
        throw new AppError(429, code, message, {
            retry_after_ms: Math.max(Number(result.retry_after_ms || 0), 0),
            reset_at: result.reset_at || null
        });
    }
}

module.exports = {
    assertRateLimit
};
