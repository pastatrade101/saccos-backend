const env = require("../config/env");
const { adminSupabase } = require("../config/supabase");

const FLUSH_INTERVAL_MS = Math.max(500, Number(process.env.API_METRICS_FLUSH_INTERVAL_MS || 2000));
const INSERT_BATCH_SIZE = Math.max(50, Number(process.env.API_METRICS_BATCH_SIZE || 250));
const MAX_QUEUE_SIZE = Math.max(500, Number(process.env.API_METRICS_MAX_QUEUE_SIZE || 5000));

const state = {
    metricsQueue: [],
    errorsQueue: [],
    timer: null,
    flushing: false,
    startedAt: null
};

function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return numeric;
}

function normalizeLatency(value) {
    return Number(Math.max(0, toNumber(value, 0)).toFixed(3));
}

function normalizeBytes(value) {
    return Math.max(0, Math.round(toNumber(value, 0)));
}

function normalizeStatusCode(value) {
    const code = Math.round(toNumber(value, 0));
    if (code < 100 || code > 999) {
        return 0;
    }
    return code;
}

function normalizeText(value, fallback = "") {
    const output = String(value || "").trim();
    return output || fallback;
}

function shouldSkipEndpoint(endpoint) {
    const path = normalizeText(endpoint, "/unknown").toLowerCase();

    return (
        path === "/health"
        || path === "/api/health"
        || path.startsWith("/metrics")
        || path.startsWith("/api/platform/metrics")
        || path.startsWith("/api/platform/errors")
    );
}

function trimQueue(queue) {
    if (queue.length <= MAX_QUEUE_SIZE) {
        return;
    }

    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
}

function enqueueMetric(row) {
    state.metricsQueue.push(row);
    trimQueue(state.metricsQueue);
}

function enqueueError(row) {
    state.errorsQueue.push(row);
    trimQueue(state.errorsQueue);
}

async function flushBatch(tableName, batch) {
    if (!batch.length) {
        return;
    }

    const { error } = await adminSupabase
        .from(tableName)
        .insert(batch);

    if (error) {
        throw error;
    }
}

async function flushQueues() {
    if (state.flushing) {
        return;
    }

    if (!state.metricsQueue.length && !state.errorsQueue.length) {
        return;
    }

    state.flushing = true;

    try {
        while (state.metricsQueue.length) {
            const batch = state.metricsQueue.splice(0, INSERT_BATCH_SIZE);
            await flushBatch("api_metrics", batch);
        }

        while (state.errorsQueue.length) {
            const batch = state.errorsQueue.splice(0, INSERT_BATCH_SIZE);
            await flushBatch("api_errors", batch);
        }
    } catch (error) {
        console.error("[api-metrics] flush failed", {
            message: String(error?.message || error)
        });
    } finally {
        state.flushing = false;
    }
}

function recordApiMetric({
    tenantId,
    userId,
    endpoint,
    latencyMs,
    statusCode,
    requestBytes,
    responseBytes,
    errorMessage,
    createdAt
}) {
    if (!env.observabilityEnabled) {
        return;
    }

    const normalizedEndpoint = normalizeText(endpoint, "/unknown");
    if (shouldSkipEndpoint(normalizedEndpoint)) {
        return;
    }

    const metricStatusCode = normalizeStatusCode(statusCode);

    enqueueMetric({
        tenant_id: tenantId || null,
        user_id: userId || null,
        endpoint: normalizedEndpoint,
        latency_ms: normalizeLatency(latencyMs),
        status_code: metricStatusCode,
        request_bytes: normalizeBytes(requestBytes),
        response_bytes: normalizeBytes(responseBytes),
        created_at: createdAt || new Date().toISOString()
    });

    if (metricStatusCode >= 400) {
        enqueueError({
            tenant_id: tenantId || null,
            endpoint: normalizedEndpoint,
            status_code: metricStatusCode,
            message: normalizeText(errorMessage, metricStatusCode >= 500 ? "Internal server error" : "API request error"),
            created_at: createdAt || new Date().toISOString()
        });
    }
}

function startApiMetricsCollector() {
    if (!env.observabilityEnabled) {
        return async () => {};
    }

    if (state.timer) {
        return async () => {
            clearInterval(state.timer);
            state.timer = null;
            await flushQueues();
        };
    }

    state.startedAt = new Date().toISOString();

    state.timer = setInterval(() => {
        void flushQueues();
    }, FLUSH_INTERVAL_MS);

    if (typeof state.timer.unref === "function") {
        state.timer.unref();
    }

    return async () => {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }

        await flushQueues();
    };
}

module.exports = {
    startApiMetricsCollector,
    recordApiMetric,
    flushApiMetrics: flushQueues
};
