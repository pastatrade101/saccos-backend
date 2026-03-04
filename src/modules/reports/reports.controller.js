const asyncHandler = require("../../utils/async-handler");
const { sendExport, assertExportQuota } = require("../../services/export.service");
const { logAudit } = require("../../services/audit.service");
const reportService = require("./reports.service");

async function runExport(req, res, loader, action) {
    const report = await loader(req.auth, req.validated.query);
    await assertExportQuota(req.subscription, req.tenantId || req.auth.tenantId);
    await logAudit({
        tenantId: req.tenantId || req.auth.tenantId,
        userId: req.auth.user.id,
        table: "reports",
        action,
        afterData: {
            format: req.validated.query.format,
            row_count: report.rows.length
        }
    });
    return sendExport(res, {
        rows: report.rows,
        format: req.validated.query.format,
        filename: report.filename,
        title: report.title
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
