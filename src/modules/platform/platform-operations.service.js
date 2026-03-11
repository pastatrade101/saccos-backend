const fs = require("fs");
const os = require("os");

const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");

const DEFAULT_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 7 * 24 * 60;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const METRIC_BATCH_SIZE = 1000;
const MAX_METRIC_ROWS = 50000;

function isMissingRelationError(error) {
    const code = String(error?.code || "");
    return code === "PGRST205" || code === "42P01" || code === "42703";
}

function normalizeWindowMinutes(value) {
    const numeric = Number(value || DEFAULT_WINDOW_MINUTES);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_WINDOW_MINUTES;
    }

    return Math.min(Math.max(Math.round(numeric), 1), MAX_WINDOW_MINUTES);
}

function normalizeLimit(value, fallback = DEFAULT_LIST_LIMIT) {
    const numeric = Number(value || fallback);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.min(Math.max(Math.round(numeric), 1), MAX_LIST_LIMIT);
}

function normalizePage(value) {
    const numeric = Number(value || 1);
    if (!Number.isFinite(numeric)) {
        return 1;
    }

    return Math.max(Math.round(numeric), 1);
}

function toFixedNumber(value, digits = 3) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    return Number(numeric.toFixed(digits));
}

function percentile(values, point) {
    if (!values.length) {
        return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil((point / 100) * sorted.length) - 1);
    return toFixedNumber(sorted[index]);
}

function bucketStartIso(timestamp, bucketMinutes) {
    const rawMs = new Date(timestamp).getTime();
    const sizeMs = bucketMinutes * 60 * 1000;
    const bucketMs = Math.floor(rawMs / sizeMs) * sizeMs;
    return new Date(bucketMs).toISOString();
}

function normalizeSortBy(value) {
    return ["traffic", "errors", "latency", "sms"].includes(value) ? value : "traffic";
}

function normalizeSortDir(value) {
    return String(value || "desc").toLowerCase() === "asc" ? "asc" : "desc";
}

async function fetchMetricRows({ columns, fromIso, tenantId }) {
    let from = 0;
    const output = [];

    while (from < MAX_METRIC_ROWS) {
        const to = from + METRIC_BATCH_SIZE - 1;
        let query = adminSupabase
            .from("api_metrics")
            .select(columns)
            .gte("created_at", fromIso)
            .order("created_at", { ascending: true })
            .range(from, to);

        if (tenantId) {
            query = query.eq("tenant_id", tenantId);
        }

        const { data, error } = await query;

        if (error) {
            throw new AppError(500, "PLATFORM_METRICS_READ_FAILED", "Unable to read API metrics.", error);
        }

        const rows = data || [];
        output.push(...rows);

        if (rows.length < METRIC_BATCH_SIZE) {
            break;
        }

        from += METRIC_BATCH_SIZE;
    }

    return output;
}

async function fetchSmsDispatchRows({ fromIso, tenantId }) {
    let from = 0;
    const output = [];

    while (from < MAX_METRIC_ROWS) {
        const to = from + METRIC_BATCH_SIZE - 1;
        let query = adminSupabase
            .from("notification_dispatches")
            .select("tenant_id,status,created_at")
            .eq("channel", "sms")
            .gte("created_at", fromIso)
            .order("created_at", { ascending: true })
            .range(from, to);

        if (tenantId) {
            query = query.eq("tenant_id", tenantId);
        }

        const { data, error } = await query;

        if (error) {
            if (isMissingRelationError(error)) {
                return [];
            }
            throw new AppError(500, "PLATFORM_SMS_METRICS_READ_FAILED", "Unable to read SMS dispatch metrics.", error);
        }

        const rows = data || [];
        output.push(...rows);

        if (rows.length < METRIC_BATCH_SIZE) {
            break;
        }

        from += METRIC_BATCH_SIZE;
    }

    return output;
}

async function loadTenantNameMap(tenantIds = []) {
    const ids = [...new Set((tenantIds || []).filter(Boolean))];
    if (!ids.length) {
        return new Map();
    }

    const { data, error } = await adminSupabase
        .from("tenants")
        .select("id, name")
        .in("id", ids);

    if (error) {
        throw new AppError(500, "PLATFORM_TENANT_LOOKUP_FAILED", "Unable to load tenant names.", error);
    }

    return new Map((data || []).map((row) => [row.id, row.name]));
}

function buildSystemMetricsFromRows(rows, smsRows, windowMinutes) {
    const totalRequests = rows.length;
    const windowSeconds = Math.max(windowMinutes * 60, 1);
    const p95LatencyMs = percentile(rows.map((row) => Number(row.latency_ms || 0)), 95);
    const serverErrors = rows.filter((row) => Number(row.status_code || 0) >= 500).length;
    const errorRatePct = totalRequests ? toFixedNumber((serverErrors / totalRequests) * 100) : 0;
    const activeUsers = new Set(rows.map((row) => row.user_id).filter(Boolean)).size;
    const activeTenants = new Set(rows.map((row) => row.tenant_id).filter(Boolean)).size;
    const smsTotalCount = smsRows.length;
    const smsSentCount = smsRows.filter((row) => row.status === "sent").length;
    const smsFailedCount = smsRows.filter((row) => row.status === "failed").length;
    const smsDeliveryRatePct = smsTotalCount ? toFixedNumber((smsSentCount / smsTotalCount) * 100) : 0;

    const bucketMinutes = Math.max(1, Math.ceil(windowMinutes / 20));
    const buckets = new Map();

    rows.forEach((row) => {
        const key = bucketStartIso(row.created_at, bucketMinutes);
        if (!buckets.has(key)) {
            buckets.set(key, {
                count: 0,
                errors: 0,
                latencies: []
            });
        }

        const bucket = buckets.get(key);
        bucket.count += 1;
        if (Number(row.status_code || 0) >= 500) {
            bucket.errors += 1;
        }
        bucket.latencies.push(Number(row.latency_ms || 0));
    });

    const timeseries = [...buckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([timestamp, bucket]) => {
            const requestsPerSec = bucket.count / Math.max(bucketMinutes * 60, 1);
            return {
                timestamp,
                requests_per_sec: toFixedNumber(requestsPerSec),
                p95_latency_ms: percentile(bucket.latencies, 95),
                error_rate_pct: bucket.count ? toFixedNumber((bucket.errors / bucket.count) * 100) : 0
            };
        });

    return {
        requests_per_sec: toFixedNumber(totalRequests / windowSeconds),
        p95_latency_ms: p95LatencyMs,
        error_rate_pct: errorRatePct,
        active_users: activeUsers,
        active_tenants: activeTenants,
        sms_total_count: smsTotalCount,
        sms_sent_count: smsSentCount,
        sms_failed_count: smsFailedCount,
        sms_delivery_rate_pct: smsDeliveryRatePct,
        window_minutes: windowMinutes,
        timeseries
    };
}

function buildTenantMetricsFromRows(rows, smsRows, tenantNameMap, sortBy, sortDir) {
    const tenantBuckets = new Map();

    rows.forEach((row) => {
        if (!row.tenant_id) {
            return;
        }

        if (!tenantBuckets.has(row.tenant_id)) {
            tenantBuckets.set(row.tenant_id, {
                request_count: 0,
                error_count: 0,
                latency_sum: 0,
                users: new Set(),
                sms_total_count: 0,
                sms_sent_count: 0,
                sms_failed_count: 0
            });
        }

        const bucket = tenantBuckets.get(row.tenant_id);
        bucket.request_count += 1;
        if (Number(row.status_code || 0) >= 500) {
            bucket.error_count += 1;
        }
        bucket.latency_sum += Number(row.latency_ms || 0);
        if (row.user_id) {
            bucket.users.add(row.user_id);
        }
    });

    smsRows.forEach((row) => {
        if (!row.tenant_id) {
            return;
        }

        if (!tenantBuckets.has(row.tenant_id)) {
            tenantBuckets.set(row.tenant_id, {
                request_count: 0,
                error_count: 0,
                latency_sum: 0,
                users: new Set(),
                sms_total_count: 0,
                sms_sent_count: 0,
                sms_failed_count: 0
            });
        }

        const bucket = tenantBuckets.get(row.tenant_id);
        bucket.sms_total_count += 1;
        if (row.status === "sent") {
            bucket.sms_sent_count += 1;
        }
        if (row.status === "failed") {
            bucket.sms_failed_count += 1;
        }
    });

    const data = [...tenantBuckets.entries()].map(([id, bucket]) => ({
        tenant_id: id,
        tenant_name: tenantNameMap.get(id) || "Unknown tenant",
        request_count: bucket.request_count,
        error_count: bucket.error_count,
        avg_latency_ms: bucket.request_count
            ? toFixedNumber(bucket.latency_sum / bucket.request_count)
            : 0,
        active_users: bucket.users.size,
        sms_total_count: bucket.sms_total_count,
        sms_sent_count: bucket.sms_sent_count,
        sms_failed_count: bucket.sms_failed_count,
        sms_delivery_rate_pct: bucket.sms_total_count
            ? toFixedNumber((bucket.sms_sent_count / bucket.sms_total_count) * 100)
            : 0
    }));

    data.sort((left, right) => {
        const leftValue = sortBy === "errors"
            ? left.error_count
            : sortBy === "latency"
                ? left.avg_latency_ms
                : sortBy === "sms"
                    ? left.sms_total_count
                    : left.request_count;

        const rightValue = sortBy === "errors"
            ? right.error_count
            : sortBy === "latency"
                ? right.avg_latency_ms
                : sortBy === "sms"
                    ? right.sms_total_count
                    : right.request_count;

        if (leftValue === rightValue) {
            return left.tenant_name.localeCompare(right.tenant_name);
        }

        return sortDir === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });

    return data;
}

function buildSlowEndpointsFromRows(rows, limit) {
    const endpointMap = new Map();

    rows.forEach((row) => {
        const endpoint = String(row.endpoint || "unknown");

        if (!endpointMap.has(endpoint)) {
            endpointMap.set(endpoint, {
                calls: 0,
                latency_sum: 0
            });
        }

        const bucket = endpointMap.get(endpoint);
        bucket.calls += 1;
        bucket.latency_sum += Number(row.latency_ms || 0);
    });

    return [...endpointMap.entries()]
        .map(([endpoint, bucket]) => ({
            endpoint,
            avg_latency_ms: bucket.calls ? toFixedNumber(bucket.latency_sum / bucket.calls) : 0,
            calls: bucket.calls
        }))
        .sort((left, right) => {
            if (right.avg_latency_ms === left.avg_latency_ms) {
                return right.calls - left.calls;
            }
            return right.avg_latency_ms - left.avg_latency_ms;
        })
        .slice(0, limit);
}

function buildInfrastructureMetricsFromRows(rows, windowMinutes) {
    const totalBytes = rows.reduce(
        (sum, row) => sum + Number(row.request_bytes || 0) + Number(row.response_bytes || 0),
        0
    );

    const windowSeconds = Math.max(windowMinutes * 60, 1);
    const networkMbps = toFixedNumber((totalBytes * 8) / windowSeconds / 1_000_000);

    const cpuLoadPct = toFixedNumber(
        (Number(os.loadavg()[0] || 0) / Math.max(Number(os.cpus().length || 1), 1)) * 100
    );

    const totalMem = Number(os.totalmem() || 0);
    const freeMem = Number(os.freemem() || 0);
    const memoryPct = totalMem > 0
        ? toFixedNumber(((totalMem - freeMem) / totalMem) * 100)
        : 0;

    let diskPct = 0;
    try {
        const stat = fs.statfsSync("/");
        const blocks = Number(stat.blocks || 0);
        const freeBlocks = Number(stat.bavail || stat.bfree || 0);

        if (blocks > 0) {
            diskPct = toFixedNumber(((blocks - freeBlocks) / blocks) * 100);
        }
    } catch {
        diskPct = 0;
    }

    return {
        cpu_pct: Math.min(Math.max(cpuLoadPct, 0), 100),
        memory_pct: Math.min(Math.max(memoryPct, 0), 100),
        disk_pct: Math.min(Math.max(diskPct, 0), 100),
        network_mbps: Math.max(networkMbps, 0),
        sampled_at: new Date().toISOString(),
        network_window_minutes: windowMinutes
    };
}

async function fetchRecentErrors({ tenantId, limit }) {
    let dbQuery = adminSupabase
        .from("api_errors")
        .select("tenant_id,endpoint,status_code,message,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

    if (tenantId) {
        dbQuery = dbQuery.eq("tenant_id", tenantId);
    }

    const { data, error } = await dbQuery;

    if (error) {
        throw new AppError(500, "PLATFORM_ERRORS_READ_FAILED", "Unable to load platform errors.", error);
    }

    return data || [];
}

async function getSystemMetrics(query = {}) {
    const windowMinutes = normalizeWindowMinutes(query.window_minutes);
    const tenantId = query.tenant_id || null;
    const fromIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const rows = await fetchMetricRows({
        columns: "tenant_id,user_id,latency_ms,status_code,created_at",
        fromIso,
        tenantId
    });
    const smsRows = await fetchSmsDispatchRows({
        fromIso,
        tenantId
    });

    return buildSystemMetricsFromRows(rows, smsRows, windowMinutes);
}

async function getTenantTrafficMetrics(query = {}) {
    const windowMinutes = normalizeWindowMinutes(query.window_minutes);
    const tenantId = query.tenant_id || null;
    const sortBy = normalizeSortBy(query.sort_by);
    const sortDir = normalizeSortDir(query.sort_dir);
    const fromIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const rows = await fetchMetricRows({
        columns: "tenant_id,user_id,latency_ms,status_code",
        fromIso,
        tenantId
    });
    const smsRows = await fetchSmsDispatchRows({
        fromIso,
        tenantId
    });

    const tenantIds = Array.from(new Set([
        ...rows.map((row) => row.tenant_id).filter(Boolean),
        ...smsRows.map((row) => row.tenant_id).filter(Boolean)
    ]));
    const tenantNameMap = await loadTenantNameMap(tenantIds);
    return buildTenantMetricsFromRows(rows, smsRows, tenantNameMap, sortBy, sortDir);
}

async function getInfrastructureMetrics(query = {}) {
    const tenantId = query.tenant_id || null;
    const windowMinutes = normalizeWindowMinutes(query.window_minutes || 1);
    const fromIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const rows = await fetchMetricRows({
        columns: "request_bytes,response_bytes",
        fromIso,
        tenantId
    });

    return buildInfrastructureMetricsFromRows(rows, windowMinutes);
}

async function listPlatformErrors(query = {}) {
    const page = normalizePage(query.page);
    const limit = normalizeLimit(query.limit);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let dbQuery = adminSupabase
        .from("api_errors")
        .select("tenant_id,endpoint,status_code,message,created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

    if (query.tenant_id) {
        dbQuery = dbQuery.eq("tenant_id", query.tenant_id);
    }

    const { data, error, count } = await dbQuery;

    if (error) {
        throw new AppError(500, "PLATFORM_ERRORS_READ_FAILED", "Unable to load platform errors.", error);
    }

    const rows = data || [];
    const tenantNameMap = await loadTenantNameMap(rows.map((row) => row.tenant_id));

    return {
        data: rows.map((row) => ({
            timestamp: row.created_at,
            endpoint: row.endpoint,
            status_code: row.status_code,
            tenant_id: row.tenant_id,
            tenant_name: row.tenant_id ? tenantNameMap.get(row.tenant_id) || "Unknown tenant" : "System",
            message: row.message
        })),
        pagination: {
            page,
            limit,
            total: count || 0
        }
    };
}

async function getSlowEndpoints(query = {}) {
    const windowMinutes = normalizeWindowMinutes(query.window_minutes);
    const tenantId = query.tenant_id || null;
    const limit = normalizeLimit(query.limit, 10);
    const fromIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const rows = await fetchMetricRows({
        columns: "endpoint,latency_ms",
        fromIso,
        tenantId
    });

    return buildSlowEndpointsFromRows(rows, limit);
}

async function getOperationsOverview(query = {}) {
    const windowMinutes = normalizeWindowMinutes(query.window_minutes);
    const tenantId = query.tenant_id || null;
    const sortBy = normalizeSortBy(query.sort_by);
    const sortDir = normalizeSortDir(query.sort_dir);
    const errorsLimit = normalizeLimit(query.errors_limit, 20);
    const slowLimit = normalizeLimit(query.slow_limit, 10);
    const fromIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const [rows, smsRows, recentErrors] = await Promise.all([
        fetchMetricRows({
            columns: "tenant_id,user_id,endpoint,latency_ms,status_code,created_at,request_bytes,response_bytes",
            fromIso,
            tenantId
        }),
        fetchSmsDispatchRows({
            fromIso,
            tenantId
        }),
        fetchRecentErrors({
            tenantId,
            limit: errorsLimit
        })
    ]);

    const tenantIds = Array.from(new Set([
        ...rows.map((row) => row.tenant_id).filter(Boolean),
        ...smsRows.map((row) => row.tenant_id).filter(Boolean),
        ...recentErrors.map((row) => row.tenant_id).filter(Boolean)
    ]));
    const tenantNameMap = await loadTenantNameMap(tenantIds);

    const system = buildSystemMetricsFromRows(rows, smsRows, windowMinutes);
    const tenants = buildTenantMetricsFromRows(rows, smsRows, tenantNameMap, sortBy, sortDir);
    const infrastructure = buildInfrastructureMetricsFromRows(rows, Math.max(Math.min(windowMinutes, 60), 1));
    const slowEndpoints = buildSlowEndpointsFromRows(rows, slowLimit);
    const errors = recentErrors.map((row) => ({
        timestamp: row.created_at,
        endpoint: row.endpoint,
        status_code: row.status_code,
        tenant_id: row.tenant_id,
        tenant_name: row.tenant_id ? tenantNameMap.get(row.tenant_id) || "Unknown tenant" : "System",
        message: row.message
    }));

    return {
        window_minutes: windowMinutes,
        scope_tenant_id: tenantId,
        system,
        tenants,
        infrastructure,
        slow_endpoints: slowEndpoints,
        errors
    };
}

module.exports = {
    getSystemMetrics,
    getTenantTrafficMetrics,
    getInfrastructureMetrics,
    listPlatformErrors,
    getSlowEndpoints,
    getOperationsOverview
};
