const asyncHandler = require("../../utils/async-handler");
const { adminSupabase } = require("../../config/supabase");
const { sendExport, assertExportQuota } = require("../../services/export.service");
const { logAudit } = require("../../services/audit.service");
const { runObservedJob } = require("../../services/observability.service");
const { getSubscriptionStatus } = require("../../services/subscription.service");
const reportService = require("./reports.service");
const reportExportJobsService = require("./report-export-jobs.service");

async function resolveTenantName(tenantId) {
    if (!tenantId) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId)
        .is("deleted_at", null)
        .single();

    if (error || !data) {
        return null;
    }

    return data.name || null;
}

async function runExport(req, res, loader, action) {
    const tenantId = req.validated?.query?.tenant_id || req.tenantId || req.auth.tenantId;
    const subscription = await getSubscriptionStatus(tenantId);
    const requestQuery = { ...(req.validated?.query || {}) };
    const useAsyncExport = Boolean(requestQuery.async);
    delete requestQuery.async;

    if (useAsyncExport) {
        const job = await reportExportJobsService.queueReportExportJob({
            actor: req.auth,
            query: requestQuery,
            reportKey: action.replace(/^export_/, ""),
            subscription
        });
        return res.status(202).json({ data: job });
    }

    return runObservedJob(`report.export.${action}`, { tenantId }, async () => {
        const report = await loader(req.auth, requestQuery);
        const rowCount = Array.isArray(report?.rows) ? report.rows.length : 0;
        const tenantName = await resolveTenantName(tenantId);

        await assertExportQuota(subscription, tenantId);
        await logAudit({
            tenantId,
            userId: req.auth.user.id,
            table: "reports",
            action,
            afterData: {
                format: requestQuery.format,
                row_count: rowCount
            }
        });
        return sendExport(res, {
            rows: report.rows,
            format: requestQuery.format,
            filename: report.filename,
            title: report.title,
            tenantName
        });
    });
}

exports.memberStatement = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.memberStatement, "export_member_statement")
);

exports.trialBalance = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.trialBalance, "export_trial_balance")
);

exports.balanceSheet = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.balanceSheet, "export_balance_sheet")
);

exports.incomeStatement = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.incomeStatement, "export_income_statement")
);

exports.cashPosition = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.cashPosition, "export_cash_position")
);

exports.par = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.parReport, "export_par")
);

exports.loanAging = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.loanAging, "export_loan_aging")
);

exports.loanPortfolioSummary = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.loanPortfolioSummary, "export_loan_portfolio_summary")
);

exports.memberBalancesSummary = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.memberBalancesSummary, "export_member_balances_summary")
);

exports.auditExceptions = asyncHandler(async (req, res) =>
    runExport(req, res, reportService.auditExceptionsReport, "export_audit_exceptions")
);

exports.chargeRevenueSummary = asyncHandler(async (req, res) => {
    const summary = await reportService.chargeRevenueSummary(req.auth, req.validated.query);
    res.json({ data: summary });
});

exports.getExportJob = asyncHandler(async (req, res) => {
    const job = await reportExportJobsService.getReportExportJob(req.auth, req.params.jobId);
    res.json({ data: job });
});

exports.getExportJobDownload = asyncHandler(async (req, res) => {
    const download = await reportExportJobsService.getReportExportJobDownload(req.auth, req.params.jobId);
    res.json({ data: download });
});
