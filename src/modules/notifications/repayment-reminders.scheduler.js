const env = require("../../config/env");
const { runScheduledRepaymentReminders } = require("./repayment-reminders.service");

let timer = null;
let running = false;

async function runCycle() {
    if (running) {
        return;
    }

    running = true;
    try {
        const summary = await runScheduledRepaymentReminders();
        if ((summary?.tenants_scanned || 0) > 0) {
            console.log("[repayment-reminders] cycle completed", {
                tenants_scanned: summary.tenants_scanned
            });
        }
    } catch (error) {
        console.error("[repayment-reminders] cycle failed", {
            code: error?.code,
            message: error?.message
        });
    } finally {
        running = false;
    }
}

function startRepaymentReminderScheduler() {
    if (!env.repaymentReminderSchedulerEnabled) {
        return () => {};
    }

    const intervalMs = Math.max(10000, Number(env.repaymentReminderIntervalMs || 3600000));

    console.log("[repayment-reminders] scheduler started", {
        interval_ms: intervalMs,
        max_tenants_per_run: env.repaymentReminderMaxTenantsPerRun,
        max_schedules_per_tenant: env.repaymentReminderMaxSchedulesPerTenant,
        due_soon_days: env.repaymentReminderDueSoonDays
    });

    runCycle();
    timer = setInterval(runCycle, intervalMs);

    return () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
            console.log("[repayment-reminders] scheduler stopped");
        }
    };
}

module.exports = {
    startRepaymentReminderScheduler
};
