const env = require("../config/env");

const UNKNOWN_TENANT = "unknown";
const UNKNOWN_ENDPOINT = "unknown";
const UNKNOWN_OPERATION = "unknown";
const UNKNOWN_JOB = "unknown";

const state = {
    startedAt: new Date().toISOString(),
    request: {
        total: 0,
        failed: 0,
        serverError: 0,
        durations: [],
        listDurations: [],
        heavyReportDurations: [],
        byEndpoint: new Map()
    },
    db: {
        total: 0,
        failed: 0,
        durations: [],
        byOperation: new Map()
    },
    jobs: {
        total: 0,
        failed: 0,
        durations: [],
        byType: new Map()
    },
    tenants: new Map()
};

function nowMs(startedAtNs) {
    return Number(process.hrtime.bigint() - startedAtNs) / 1e6;
}

function toFiniteDuration(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return 0;
    }
    return Number(numeric.toFixed(3));
}

function pushSample(samples, value) {
    samples.push(value);
    if (samples.length > env.observabilitySampleLimit) {
        samples.shift();
    }
}

function percentile(samples, point) {
    if (!samples.length) {
        return null;
    }

    const sorted = [...samples].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil((point / 100) * sorted.length) - 1);
    return Number(sorted[index].toFixed(3));
}

function average(samples) {
    if (!samples.length) {
        return null;
    }

    const sum = samples.reduce((acc, current) => acc + current, 0);
    return Number((sum / samples.length).toFixed(3));
}

function sanitizeTenantId(tenantId) {
    if (!tenantId) {
        return UNKNOWN_TENANT;
    }

    return String(tenantId).trim() || UNKNOWN_TENANT;
}

function shouldTrackAsListEndpoint(method, path) {
    if (String(method || "").toUpperCase() !== "GET") {
        return false;
    }

    const normalizedPath = String(path || "").toLowerCase();
    if (!normalizedPath.startsWith("/api/")) {
        return false;
    }

    if (normalizedPath.includes("/health") || normalizedPath.includes("/metrics") || normalizedPath.includes("/observability")) {
        return false;
    }

    if (normalizedPath.includes("/export")) {
        return false;
    }

    return true;
}

function shouldTrackAsHeavyReport(path) {
    const normalizedPath = String(path || "").toLowerCase();
    return normalizedPath.includes("/api/reports/") && normalizedPath.includes("/export");
}

function getOrCreateCounter(map, key) {
    if (map.has(key)) {
        return map.get(key);
    }

    const bucket = {
        count: 0,
        failed: 0,
        durations: []
    };
    map.set(key, bucket);
    return bucket;
}

function getOrCreateTenantDashboard(tenantId) {
    const tenantKey = sanitizeTenantId(tenantId);
    if (state.tenants.has(tenantKey)) {
        return state.tenants.get(tenantKey);
    }

    const dashboard = {
        requests: {
            total: 0,
            failed: 0,
            serverError: 0,
            durations: []
        },
        db: {
            total: 0,
            failed: 0,
            durations: []
        },
        jobs: {
            total: 0,
            failed: 0,
            durations: []
        }
    };

    state.tenants.set(tenantKey, dashboard);
    return dashboard;
}

function observeRequest({ method, path, statusCode, durationMs, tenantId }) {
    if (!env.observabilityEnabled) {
        return;
    }

    const resolvedDuration = toFiniteDuration(durationMs);
    const resolvedStatusCode = Number(statusCode) || 0;
    const endpoint = `${String(method || "GET").toUpperCase()} ${String(path || UNKNOWN_ENDPOINT)}`;
    const tenantDashboard = getOrCreateTenantDashboard(tenantId);
    const endpointBucket = getOrCreateCounter(state.request.byEndpoint, endpoint);

    state.request.total += 1;
    pushSample(state.request.durations, resolvedDuration);
    endpointBucket.count += 1;
    pushSample(endpointBucket.durations, resolvedDuration);

    tenantDashboard.requests.total += 1;
    pushSample(tenantDashboard.requests.durations, resolvedDuration);

    if (resolvedStatusCode >= 400) {
        state.request.failed += 1;
        endpointBucket.failed += 1;
        tenantDashboard.requests.failed += 1;
    }

    if (resolvedStatusCode >= 500) {
        state.request.serverError += 1;
        tenantDashboard.requests.serverError += 1;
    }

    if (shouldTrackAsListEndpoint(method, path)) {
        pushSample(state.request.listDurations, resolvedDuration);
    }

    if (shouldTrackAsHeavyReport(path)) {
        pushSample(state.request.heavyReportDurations, resolvedDuration);
    }
}

function observeDbQuery({ operation, statusCode, durationMs, tenantId }) {
    if (!env.observabilityEnabled) {
        return;
    }

    const resolvedDuration = toFiniteDuration(durationMs);
    const resolvedStatusCode = Number(statusCode) || 0;
    const operationKey = String(operation || UNKNOWN_OPERATION);
    const tenantDashboard = getOrCreateTenantDashboard(tenantId);
    const operationBucket = getOrCreateCounter(state.db.byOperation, operationKey);

    state.db.total += 1;
    pushSample(state.db.durations, resolvedDuration);
    operationBucket.count += 1;
    pushSample(operationBucket.durations, resolvedDuration);

    tenantDashboard.db.total += 1;
    pushSample(tenantDashboard.db.durations, resolvedDuration);

    if (resolvedStatusCode >= 400 || resolvedStatusCode === 0) {
        state.db.failed += 1;
        operationBucket.failed += 1;
        tenantDashboard.db.failed += 1;
    }
}

function observeJob({ jobType, status, durationMs, tenantId }) {
    if (!env.observabilityEnabled) {
        return;
    }

    const resolvedDuration = toFiniteDuration(durationMs);
    const type = String(jobType || UNKNOWN_JOB);
    const hasFailed = status === "failed";
    const tenantDashboard = getOrCreateTenantDashboard(tenantId);
    const typeBucket = getOrCreateCounter(state.jobs.byType, type);

    state.jobs.total += 1;
    pushSample(state.jobs.durations, resolvedDuration);
    typeBucket.count += 1;
    pushSample(typeBucket.durations, resolvedDuration);

    tenantDashboard.jobs.total += 1;
    pushSample(tenantDashboard.jobs.durations, resolvedDuration);

    if (hasFailed) {
        state.jobs.failed += 1;
        typeBucket.failed += 1;
        tenantDashboard.jobs.failed += 1;
    }
}

async function runObservedJob(jobType, options, task) {
    const startedAtNs = process.hrtime.bigint();
    const tenantId = options?.tenantId || null;

    try {
        const result = await task();
        observeJob({
            jobType,
            tenantId,
            status: "success",
            durationMs: nowMs(startedAtNs)
        });
        return result;
    } catch (error) {
        observeJob({
            jobType,
            tenantId,
            status: "failed",
            durationMs: nowMs(startedAtNs)
        });
        throw error;
    }
}

function mapMetricBuckets(inputMap) {
    return [...inputMap.entries()]
        .map(([name, bucket]) => ({
            name,
            count: bucket.count,
            failed: bucket.failed,
            averageMs: average(bucket.durations),
            p95Ms: percentile(bucket.durations, 95)
        }))
        .sort((left, right) => (right.p95Ms || 0) - (left.p95Ms || 0));
}

function getSloStatus() {
    const listP95 = percentile(state.request.listDurations, 95);
    const heavyReportsP95 = percentile(state.request.heavyReportDurations, 95);
    const totalRequests = state.request.total || 0;
    const errorRatePct = totalRequests
        ? Number(((state.request.serverError / totalRequests) * 100).toFixed(3))
        : 0;

    return {
        targets: {
            listEndpointsP95Ms: env.sloListEndpointP95Ms,
            heavyReportsP95Ms: env.sloHeavyReportP95Ms,
            errorRatePct: env.sloErrorRatePct
        },
        observed: {
            listEndpointsP95Ms: listP95,
            heavyReportsP95Ms: heavyReportsP95,
            errorRatePct
        },
        status: {
            listEndpointsP95Ms: listP95 === null ? "no_data" : listP95 <= env.sloListEndpointP95Ms ? "pass" : "fail",
            heavyReportsP95Ms:
                heavyReportsP95 === null
                    ? "no_data"
                    : heavyReportsP95 <= env.sloHeavyReportP95Ms
                        ? "pass"
                        : "fail",
            errorRatePct: errorRatePct <= env.sloErrorRatePct ? "pass" : "fail"
        }
    };
}

function getSummary() {
    const requestTotal = state.request.total || 0;
    const requestErrorRate = requestTotal
        ? Number(((state.request.failed / requestTotal) * 100).toFixed(3))
        : 0;
    const requestServerErrorRate = requestTotal
        ? Number(((state.request.serverError / requestTotal) * 100).toFixed(3))
        : 0;

    return {
        startedAt: state.startedAt,
        sampleLimitPerSeries: env.observabilitySampleLimit,
        slo: getSloStatus(),
        requests: {
            total: state.request.total,
            failed: state.request.failed,
            serverError: state.request.serverError,
            errorRatePct: requestErrorRate,
            serverErrorRatePct: requestServerErrorRate,
            p50Ms: percentile(state.request.durations, 50),
            p95Ms: percentile(state.request.durations, 95),
            listP95Ms: percentile(state.request.listDurations, 95),
            heavyReportP95Ms: percentile(state.request.heavyReportDurations, 95),
            byEndpoint: mapMetricBuckets(state.request.byEndpoint).slice(0, 20)
        },
        database: {
            total: state.db.total,
            failed: state.db.failed,
            p50Ms: percentile(state.db.durations, 50),
            p95Ms: percentile(state.db.durations, 95),
            byOperation: mapMetricBuckets(state.db.byOperation).slice(0, 20)
        },
        jobs: {
            total: state.jobs.total,
            failed: state.jobs.failed,
            p50Ms: percentile(state.jobs.durations, 50),
            p95Ms: percentile(state.jobs.durations, 95),
            byType: mapMetricBuckets(state.jobs.byType).slice(0, 20)
        }
    };
}

function getTenantDashboards() {
    return [...state.tenants.entries()]
        .map(([tenantId, metrics]) => {
            const requestTotal = metrics.requests.total || 0;
            const requestErrorRate = requestTotal
                ? Number(((metrics.requests.failed / requestTotal) * 100).toFixed(3))
                : 0;

            return {
                tenantId,
                requests: {
                    total: metrics.requests.total,
                    failed: metrics.requests.failed,
                    serverError: metrics.requests.serverError,
                    errorRatePct: requestErrorRate,
                    p95Ms: percentile(metrics.requests.durations, 95)
                },
                database: {
                    total: metrics.db.total,
                    failed: metrics.db.failed,
                    p95Ms: percentile(metrics.db.durations, 95)
                },
                jobs: {
                    total: metrics.jobs.total,
                    failed: metrics.jobs.failed,
                    p95Ms: percentile(metrics.jobs.durations, 95)
                }
            };
        })
        .sort((left, right) => (right.requests.total || 0) - (left.requests.total || 0));
}

function getPrometheusMetrics() {
    const summary = getSummary();
    return [
        "# HELP app_requests_total Total HTTP requests observed by the app.",
        "# TYPE app_requests_total counter",
        `app_requests_total ${summary.requests.total}`,
        "# HELP app_request_errors_total Total HTTP requests with status >= 400.",
        "# TYPE app_request_errors_total counter",
        `app_request_errors_total ${summary.requests.failed}`,
        "# HELP app_request_server_errors_total Total HTTP requests with status >= 500.",
        "# TYPE app_request_server_errors_total counter",
        `app_request_server_errors_total ${summary.requests.serverError}`,
        "# HELP app_request_latency_p95_ms HTTP request latency p95 in milliseconds.",
        "# TYPE app_request_latency_p95_ms gauge",
        `app_request_latency_p95_ms ${summary.requests.p95Ms ?? 0}`,
        "# HELP app_db_query_latency_p95_ms Supabase request latency p95 in milliseconds.",
        "# TYPE app_db_query_latency_p95_ms gauge",
        `app_db_query_latency_p95_ms ${summary.database.p95Ms ?? 0}`,
        "# HELP app_jobs_latency_p95_ms Async/heavy workflow latency p95 in milliseconds.",
        "# TYPE app_jobs_latency_p95_ms gauge",
        `app_jobs_latency_p95_ms ${summary.jobs.p95Ms ?? 0}`,
        "# HELP app_slo_list_p95_ms Current list endpoint p95 in milliseconds.",
        "# TYPE app_slo_list_p95_ms gauge",
        `app_slo_list_p95_ms ${summary.requests.listP95Ms ?? 0}`,
        "# HELP app_slo_heavy_report_p95_ms Current heavy report endpoint p95 in milliseconds.",
        "# TYPE app_slo_heavy_report_p95_ms gauge",
        `app_slo_heavy_report_p95_ms ${summary.requests.heavyReportP95Ms ?? 0}`,
        "# HELP app_slo_server_error_rate_pct Current server error rate in percent.",
        "# TYPE app_slo_server_error_rate_pct gauge",
        `app_slo_server_error_rate_pct ${summary.requests.serverErrorRatePct}`
    ].join("\n");
}

function resetObservability() {
    state.startedAt = new Date().toISOString();
    state.request.total = 0;
    state.request.failed = 0;
    state.request.serverError = 0;
    state.request.durations = [];
    state.request.listDurations = [];
    state.request.heavyReportDurations = [];
    state.request.byEndpoint.clear();

    state.db.total = 0;
    state.db.failed = 0;
    state.db.durations = [];
    state.db.byOperation.clear();

    state.jobs.total = 0;
    state.jobs.failed = 0;
    state.jobs.durations = [];
    state.jobs.byType.clear();

    state.tenants.clear();
}

module.exports = {
    observeRequest,
    observeDbQuery,
    observeJob,
    runObservedJob,
    getSloStatus,
    getSummary,
    getTenantDashboards,
    getPrometheusMetrics,
    resetObservability
};
