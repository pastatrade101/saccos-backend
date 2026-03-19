require("dotenv").config();

const { runReportExportWorkerLoop } = require("./modules/reports/report-export-jobs.service");
const { assertRequiredSchemaCapabilities } = require("./services/schema-capabilities.service");

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
    const schemaStatus = await assertRequiredSchemaCapabilities({ context: "worker" });
    if (!schemaStatus.ok) {
        console.warn(
            "[schema-check] Worker startup continuing with missing capabilities because strict mode is disabled:",
            schemaStatus.failures.map((failure) => `${failure.kind}:${failure.name}`).join(", ")
        );
    }

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
