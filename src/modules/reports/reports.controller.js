const asyncHandler = require("../../utils/async-handler");
const { adminSupabase } = require("../../config/supabase");
const { sendExport, assertExportQuota } = require("../../services/export.service");
const { logAudit } = require("../../services/audit.service");
const { runObservedJob } = require("../../services/observability.service");
const reportService = require("./reports.service");

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
    return runObservedJob(`report.export.${action}`, { tenantId }, async () => {
        const report = await loader(req.auth, req.validated.query);
        const rowCount = Array.isArray(report?.rows) ? report.rows.length : 0;
        const tenantName = await resolveTenantName(tenantId);

        await assertExportQuota(req.subscription, tenantId);
        await logAudit({
            tenantId,
            userId: req.auth.user.id,
            table: "reports",
            action,
            afterData: {
                format: req.validated.query.format,
                row_count: rowCount
            }
        });
        return sendExport(res, {
            rows: report.rows,
            format: req.validated.query.format,
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
