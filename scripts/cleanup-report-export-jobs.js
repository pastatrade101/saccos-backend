require("dotenv").config();

const { runReportExportCleanupOnce } = require("../src/modules/reports/report-export-jobs.service");

async function main() {
    const summary = await runReportExportCleanupOnce();
    console.log(JSON.stringify({ data: summary }, null, 2));
}

main().catch((error) => {
    console.error("[cleanup-report-export-jobs] failed", error);
    process.exit(1);
});
