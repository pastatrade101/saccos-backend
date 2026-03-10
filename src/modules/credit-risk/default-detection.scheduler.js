const env = require("../../config/env");
const { runScheduledDefaultDetection } = require("./credit-risk.service");

let timer = null;
let running = false;

async function runCycle() {
    if (running) {
        return;
    }

    running = true;
    try {
        const summary = await runScheduledDefaultDetection();
        if ((summary?.tenants_scanned || 0) > 0) {
            console.log("[credit-risk-default-detection] cycle completed", {
                tenants_scanned: summary.tenants_scanned
            });
        }
    } catch (error) {
        console.error("[credit-risk-default-detection] cycle failed", {
            code: error?.code,
            message: error?.message
        });
    } finally {
        running = false;
    }
}

function startDefaultDetectionScheduler() {
    if (!env.creditRiskDefaultDetectionSchedulerEnabled) {
        return () => {};
    }

    const intervalMs = Math.max(10000, Number(env.creditRiskDefaultDetectionIntervalMs || 900000));

    console.log("[credit-risk-default-detection] scheduler started", {
        interval_ms: intervalMs,
        max_tenants_per_run: env.creditRiskDefaultDetectionMaxTenantsPerRun,
        max_loans_per_tenant: env.creditRiskDefaultDetectionMaxLoansPerTenant
    });

    runCycle();
    timer = setInterval(runCycle, intervalMs);

    return () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
            console.log("[credit-risk-default-detection] scheduler stopped");
        }
    };
}

module.exports = {
    startDefaultDetectionScheduler
};
