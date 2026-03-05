const asyncHandler = require("../../utils/async-handler");
const { sendExport } = require("../../services/export.service");
const { logAudit } = require("../../services/audit.service");
const auditorService = require("./auditor.service");

function applyNoStore(res) {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization"
    });
}

async function runAuditorExport(req, res, loader, action) {
    const report = await loader(req.auth, req.validated.query);
    await logAudit({
        tenantId: req.auth.tenantId,
        actorUserId: req.auth.user.id,
        table: "reports",
        entityType: "report_export",
        action,
        afterData: {
            row_count: report.rows.length,
            filename: report.filename
        }
    });

    return sendExport(res, {
        rows: report.rows,
        format: "csv",
        filename: report.filename,
        title: report.title
    });
}

exports.summary = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const data = await auditorService.getSummary(req.auth, req.validated.query);
    res.json({ data });
});

exports.exceptions = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const data = await auditorService.getExceptions(req.auth, req.validated.query);
    res.json({ data });
});

exports.journals = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const data = await auditorService.getJournals(req.auth, req.validated.query);
    res.json({ data });
});

exports.journalDetail = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const data = await auditorService.getJournalDetail(req.auth, req.validated.params.id);
    res.json({ data });
});

exports.auditLogs = asyncHandler(async (req, res) => {
    applyNoStore(res);
    const data = await auditorService.getAuditLogs(req.auth, req.validated.query);
    res.json({
        data,
        rows: data.data,
        pagination: data.pagination
    });
});

exports.trialBalanceCsv = asyncHandler(async (req, res) =>
    runAuditorExport(req, res, auditorService.getTrialBalanceReport, "AUDITOR_EXPORT_TRIAL_BALANCE")
);

exports.loanAgingCsv = asyncHandler(async (req, res) =>
    runAuditorExport(req, res, auditorService.getLoanAgingReport, "AUDITOR_EXPORT_LOAN_AGING")
);

exports.parCsv = asyncHandler(async (req, res) =>
    runAuditorExport(req, res, auditorService.getParReport, "AUDITOR_EXPORT_PAR")
);

exports.dividendsRegisterCsv = asyncHandler(async (req, res) =>
    runAuditorExport(req, res, auditorService.getDividendRegister, "AUDITOR_EXPORT_DIVIDEND_REGISTER")
);
