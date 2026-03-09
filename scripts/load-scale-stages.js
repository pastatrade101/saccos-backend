#!/usr/bin/env node
/* eslint-disable no-console */
const { spawn } = require("child_process");
const fs = require("fs/promises");

function parseStages(rawValue) {
    const fallback = [25, 50, 100];
    if (!rawValue) {
        return fallback;
    }

    const parsed = rawValue
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry) && entry > 0);

    return parsed.length ? parsed : fallback;
}

function runStage({
    stageConcurrency,
    baseUrl,
    durationSeconds,
    timeoutMs,
    sampleLimit,
    authToken,
    targets
}) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ["scripts/load-baseline.js"],
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    LOAD_TEST_BASE_URL: baseUrl,
                    LOAD_TEST_DURATION_SECONDS: String(durationSeconds),
                    LOAD_TEST_CONCURRENCY: String(stageConcurrency),
                    LOAD_TEST_TIMEOUT_MS: String(timeoutMs),
                    LOAD_TEST_SAMPLE_LIMIT: String(sampleLimit),
                    LOAD_TEST_AUTH_TOKEN: authToken || "",
                    LOAD_TEST_TARGETS: targets
                },
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });

        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });

        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error(`Stage ${stageConcurrency} failed: ${stderr || stdout}`));
            }

            const trimmed = stdout.trim();
            if (!trimmed) {
                return reject(new Error(`Stage ${stageConcurrency} returned empty output.`));
            }

            try {
                const parsed = JSON.parse(trimmed);
                return resolve(parsed);
            } catch {
                return reject(new Error(`Stage ${stageConcurrency} output is not valid JSON:\n${trimmed}`));
            }
        });
    });
}

function renderMarkdown({
    baseUrl,
    durationSeconds,
    timeoutMs,
    stages,
    stageSummaries
}) {
    const lines = [];
    lines.push("# Phase 4 Scale Stage Report");
    lines.push("");
    lines.push(`- Base URL: ${baseUrl}`);
    lines.push(`- Duration per stage: ${durationSeconds}s`);
    lines.push(`- Timeout: ${timeoutMs}ms`);
    lines.push(`- Stages (concurrency): ${stages.join(", ")}`);
    lines.push(`- Generated at: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Stage Summary");
    lines.push("");
    lines.push("| Concurrency | Requests | RPS | Error % | Network Failure % | p95 (ms) | p99 (ms) |");
    lines.push("|---:|---:|---:|---:|---:|---:|---:|");

    for (const stage of stageSummaries) {
        lines.push(
            `| ${stage.stage} | ${stage.totals.requests} | ${stage.totals.requestsPerSecond} | ${stage.totals.errorRatePct}% | ${stage.totals.networkFailureRatePct}% | ${stage.totals.p95Ms ?? "N/A"} | ${stage.totals.p99Ms ?? "N/A"} |`
        );
    }

    lines.push("");
    lines.push("## Stage Bottlenecks");
    lines.push("");
    for (const stage of stageSummaries) {
        lines.push(`### Concurrency ${stage.stage}`);
        lines.push("");
        lines.push("| Endpoint | Requests | Error % | p95 (ms) | p99 (ms) |");
        lines.push("|---|---:|---:|---:|---:|");
        for (const endpoint of stage.bottlenecks.slice(0, 5)) {
            lines.push(
                `| ${endpoint.name} | ${endpoint.count} | ${endpoint.errorRatePct}% | ${endpoint.p95Ms ?? "N/A"} | ${endpoint.p99Ms ?? "N/A"} |`
            );
        }
        lines.push("");
    }

    return lines.join("\n");
}

async function main() {
    const baseUrl = process.env.SCALE_LOAD_BASE_URL || process.env.LOAD_TEST_BASE_URL || "http://127.0.0.1:5000";
    const durationSeconds = Number(process.env.SCALE_LOAD_DURATION_SECONDS || 120);
    const timeoutMs = Number(process.env.SCALE_LOAD_TIMEOUT_MS || 10000);
    const sampleLimit = Number(process.env.SCALE_LOAD_SAMPLE_LIMIT || 20000);
    const authToken = process.env.SCALE_LOAD_AUTH_TOKEN || process.env.LOAD_TEST_AUTH_TOKEN || "";
    const outputFile = process.env.SCALE_LOAD_OUTPUT_FILE || "";
    const stages = parseStages(process.env.SCALE_LOAD_STAGES);
    const targets = process.env.SCALE_LOAD_TARGETS
        || process.env.LOAD_TEST_TARGETS
        || "GET /api/members?page=1&limit=20|4,GET /api/loan-applications?page=1&limit=20|3,GET /api/reports/trial-balance/export?format=pdf|1";

    const stageSummaries = [];

    for (const stage of stages) {
        console.log(`[scale-load] running stage concurrency=${stage}`);
        const summary = await runStage({
            stageConcurrency: stage,
            baseUrl,
            durationSeconds,
            timeoutMs,
            sampleLimit,
            authToken,
            targets
        });
        stageSummaries.push({
            stage,
            ...summary
        });
    }

    const result = {
        generated_at: new Date().toISOString(),
        base_url: baseUrl,
        duration_seconds: durationSeconds,
        timeout_ms: timeoutMs,
        stages: stageSummaries
    };

    console.log(JSON.stringify(result, null, 2));

    if (outputFile) {
        const markdown = renderMarkdown({
            baseUrl,
            durationSeconds,
            timeoutMs,
            stages,
            stageSummaries
        });
        await fs.writeFile(outputFile, `${markdown}\n`, "utf8");
        console.log(`\nScale stage markdown saved to ${outputFile}`);
    }
}

main().catch((error) => {
    console.error("Scale load stages failed:", error);
    process.exit(1);
});
