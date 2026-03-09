#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs/promises");

function percentile(samples, point) {
    if (!samples.length) {
        return null;
    }

    const sorted = [...samples].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil((point / 100) * sorted.length) - 1);
    return Number(sorted[index].toFixed(3));
}

function parseTargets(rawValue) {
    const fallback = [{ method: "GET", path: "/api/health", weight: 1 }];
    if (!rawValue) {
        return fallback;
    }

    const targets = rawValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const [left, weightRaw] = entry.split("|");
            const [methodRaw, ...pathParts] = (left || "").trim().split(" ");
            const method = (methodRaw || "GET").trim().toUpperCase();
            const path = pathParts.join(" ").trim();
            const weight = Number(weightRaw || "1");

            if (!path.startsWith("/")) {
                return null;
            }

            if (!Number.isFinite(weight) || weight <= 0) {
                return null;
            }

            return {
                method,
                path,
                weight
            };
        })
        .filter(Boolean);

    return targets.length ? targets : fallback;
}

function pickTarget(targets) {
    const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0);
    const pick = Math.random() * totalWeight;
    let cumulative = 0;
    for (const target of targets) {
        cumulative += target.weight;
        if (pick <= cumulative) {
            return target;
        }
    }
    return targets[targets.length - 1];
}

function createTracker(targets) {
    const perEndpoint = new Map();
    for (const target of targets) {
        const key = `${target.method} ${target.path}`;
        perEndpoint.set(key, {
            count: 0,
            errors: 0,
            durations: [],
            status: {}
        });
    }

    return {
        startedAt: new Date().toISOString(),
        totals: {
            requests: 0,
            errors: 0,
            networkFailures: 0
        },
        durations: [],
        perEndpoint
    };
}

function addSample(samples, value, limit) {
    samples.push(value);
    if (samples.length > limit) {
        samples.shift();
    }
}

async function workerLoop({
    baseUrl,
    authToken,
    targets,
    tracker,
    stopAtMs,
    timeoutMs,
    sampleLimit
}) {
    while (Date.now() < stopAtMs) {
        const target = pickTarget(targets);
        const key = `${target.method} ${target.path}`;
        const endpoint = tracker.perEndpoint.get(key);
        const startedAt = process.hrtime.bigint();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`${baseUrl}${target.path}`, {
                method: target.method,
                headers: {
                    Accept: "application/json",
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
                },
                signal: controller.signal
            });

            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const normalizedDuration = Number(durationMs.toFixed(3));

            tracker.totals.requests += 1;
            endpoint.count += 1;
            endpoint.status[response.status] = (endpoint.status[response.status] || 0) + 1;

            addSample(tracker.durations, normalizedDuration, sampleLimit);
            addSample(endpoint.durations, normalizedDuration, sampleLimit);

            if (!response.ok) {
                tracker.totals.errors += 1;
                endpoint.errors += 1;
            }
        } catch {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const normalizedDuration = Number(durationMs.toFixed(3));

            tracker.totals.requests += 1;
            tracker.totals.errors += 1;
            tracker.totals.networkFailures += 1;
            endpoint.count += 1;
            endpoint.errors += 1;
            endpoint.status.TIMEOUT_OR_NETWORK = (endpoint.status.TIMEOUT_OR_NETWORK || 0) + 1;

            addSample(tracker.durations, normalizedDuration, sampleLimit);
            addSample(endpoint.durations, normalizedDuration, sampleLimit);
        } finally {
            clearTimeout(timeout);
        }
    }
}

function summarizeResults({
    tracker,
    durationSeconds,
    concurrency,
    baseUrl,
    targets
}) {
    const totalRequests = tracker.totals.requests || 0;
    const errorRatePct = totalRequests
        ? Number(((tracker.totals.errors / totalRequests) * 100).toFixed(3))
        : 0;
    const networkFailureRatePct = totalRequests
        ? Number(((tracker.totals.networkFailures / totalRequests) * 100).toFixed(3))
        : 0;
    const rps = Number((totalRequests / durationSeconds).toFixed(2));

    const endpoints = [...tracker.perEndpoint.entries()]
        .map(([name, stats]) => ({
            name,
            count: stats.count,
            errors: stats.errors,
            errorRatePct: stats.count ? Number(((stats.errors / stats.count) * 100).toFixed(3)) : 0,
            p95Ms: percentile(stats.durations, 95),
            p99Ms: percentile(stats.durations, 99),
            status: stats.status
        }))
        .sort((left, right) => (right.p95Ms || 0) - (left.p95Ms || 0));

    return {
        startedAt: tracker.startedAt,
        finishedAt: new Date().toISOString(),
        setup: {
            baseUrl,
            durationSeconds,
            concurrency,
            targets
        },
        totals: {
            requests: totalRequests,
            errors: tracker.totals.errors,
            networkFailures: tracker.totals.networkFailures,
            errorRatePct,
            networkFailureRatePct,
            requestsPerSecond: rps,
            p50Ms: percentile(tracker.durations, 50),
            p95Ms: percentile(tracker.durations, 95),
            p99Ms: percentile(tracker.durations, 99)
        },
        bottlenecks: endpoints
    };
}

function renderMarkdown(summary) {
    const lines = [];
    lines.push("# Phase 0 Load Test Baseline");
    lines.push("");
    lines.push(`- Started: ${summary.startedAt}`);
    lines.push(`- Finished: ${summary.finishedAt}`);
    lines.push(`- Base URL: ${summary.setup.baseUrl}`);
    lines.push(`- Duration: ${summary.setup.durationSeconds}s`);
    lines.push(`- Concurrency: ${summary.setup.concurrency}`);
    lines.push("");
    lines.push("## Current Max Snapshot");
    lines.push("");
    lines.push(`- Requests: ${summary.totals.requests}`);
    lines.push(`- Approx throughput: ${summary.totals.requestsPerSecond} req/s`);
    lines.push(`- Error rate: ${summary.totals.errorRatePct}%`);
    lines.push(`- Network failure rate: ${summary.totals.networkFailureRatePct}%`);
    lines.push(`- p95 latency: ${summary.totals.p95Ms ?? "N/A"} ms`);
    lines.push("");
    lines.push("## Bottleneck Ranking (Highest p95 First)");
    lines.push("");
    lines.push("| Endpoint | Requests | Error % | p95 (ms) | p99 (ms) | Status mix |");
    lines.push("|---|---:|---:|---:|---:|---|");

    for (const endpoint of summary.bottlenecks) {
        const statusMix = Object.entries(endpoint.status)
            .map(([code, count]) => `${code}:${count}`)
            .join(", ");
        lines.push(
            `| ${endpoint.name} | ${endpoint.count} | ${endpoint.errorRatePct}% | ${endpoint.p95Ms ?? "N/A"} | ${endpoint.p99Ms ?? "N/A"} | ${statusMix || "N/A"} |`
        );
    }

    lines.push("");
    lines.push("## Recommended Next Step");
    lines.push("");
    lines.push("- Use `GET /api/observability/summary` and `GET /api/observability/tenants` to correlate endpoint bottlenecks with tenant load.");
    return lines.join("\n");
}

async function main() {
    const baseUrl = process.env.LOAD_TEST_BASE_URL || "http://127.0.0.1:5000";
    const durationSeconds = Number(process.env.LOAD_TEST_DURATION_SECONDS || 60);
    const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 20);
    const timeoutMs = Number(process.env.LOAD_TEST_TIMEOUT_MS || 10000);
    const authToken = process.env.LOAD_TEST_AUTH_TOKEN || "";
    const sampleLimit = Number(process.env.LOAD_TEST_SAMPLE_LIMIT || 20000);
    const outputFile = process.env.LOAD_TEST_OUTPUT_FILE || "";
    const targets = parseTargets(process.env.LOAD_TEST_TARGETS);

    const tracker = createTracker(targets);
    const stopAtMs = Date.now() + (durationSeconds * 1000);

    const workers = Array.from({ length: concurrency }).map(() =>
        workerLoop({
            baseUrl,
            authToken,
            targets,
            tracker,
            stopAtMs,
            timeoutMs,
            sampleLimit
        })
    );

    await Promise.all(workers);

    const summary = summarizeResults({
        tracker,
        durationSeconds,
        concurrency,
        baseUrl,
        targets
    });

    if (summary.totals.requests > 0 && summary.totals.networkFailures === summary.totals.requests) {
        throw new Error(
            "All requests failed with TIMEOUT_OR_NETWORK. Ensure the API server is reachable before recording baseline."
        );
    }

    console.log(JSON.stringify(summary, null, 2));

    if (outputFile) {
        const markdown = renderMarkdown(summary);
        await fs.writeFile(outputFile, `${markdown}\n`, "utf8");
        console.log(`\nBaseline markdown saved to ${outputFile}`);
    }
}

main().catch((error) => {
    console.error("Load baseline failed:", error);
    process.exit(1);
});
