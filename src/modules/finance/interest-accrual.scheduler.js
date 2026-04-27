const env = require("../../config/env");
const { runScheduledInterestAccrual } = require("./finance.service");

let timer = null;
let running = false;

async function runCycle() {
    if (running) {
        return;
    }

    running = true;
    try {
        const summary = await runScheduledInterestAccrual();
        if ((summary?.tenants_scanned || 0) > 0) {
            console.log("[interest-accrual] cycle completed", {
                tenants_scanned: summary.tenants_scanned,
                tenants_failed: summary.tenants_failed || 0,
                tenants_skipped: summary.tenants_skipped || 0
            });
        }
    } catch (error) {
        console.error("[interest-accrual] cycle failed", {
            code: error?.code,
            message: error?.message
        });
    } finally {
        running = false;
    }
}

function startInterestAccrualScheduler() {
    if (!env.interestAccrualSchedulerEnabled) {
        return () => {};
    }

    const intervalMs = Math.max(60000, Number(env.interestAccrualIntervalMs || 86400000));

    console.log("[interest-accrual] scheduler started", {
        interval_ms: intervalMs,
        max_tenants_per_run: env.interestAccrualMaxTenantsPerRun
    });

    runCycle();
    timer = setInterval(runCycle, intervalMs);

    return () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
            console.log("[interest-accrual] scheduler stopped");
        }
    };
}

module.exports = {
    startInterestAccrualScheduler
};
