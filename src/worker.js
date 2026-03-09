require("dotenv").config();

const { runReportExportWorkerLoop } = require("./modules/reports/report-export-jobs.service");

let stopRequested = false;

function requestStop(signal) {
    if (stopRequested) {
        return;
    }
    stopRequested = true;
    console.log(`[report-export-worker] received ${signal}, stopping after current iteration.`);
}

process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));

async function startWorker() {
    console.log("[report-export-worker] started");
    await runReportExportWorkerLoop({
        shouldStop: () => stopRequested
    });
    console.log("[report-export-worker] stopped");
}

startWorker().catch((error) => {
    console.error("[report-export-worker] fatal error", error);
    process.exit(1);
});
