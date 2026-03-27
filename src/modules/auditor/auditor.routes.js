const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./auditor.controller");
const {
    summaryQuerySchema,
    exceptionsQuerySchema,
    journalsQuerySchema,
    journalDetailParamsSchema,
    caseKeyParamsSchema,
    evidenceIdParamsSchema,
    caseDetailQuerySchema,
    auditLogsQuerySchema,
    auditorReportQuerySchema,
    updateCaseSchema,
    createCaseCommentSchema,
    initCaseEvidenceUploadSchema,
    confirmCaseEvidenceUploadSchema,
    riskSummaryQuerySchema,
    exceptionTrendsQuerySchema,
    workstationOverviewQuerySchema
} = require("./auditor.schemas");

const router = express.Router();

router.use(auth, authorize([ROLES.AUDITOR], { allowInternalOps: false }));

router.get("/summary", validate(summaryQuerySchema, "query"), controller.summary);
router.get("/risk-summary", validate(riskSummaryQuerySchema, "query"), controller.riskSummary);
router.get("/exception-trends", validate(exceptionTrendsQuerySchema, "query"), controller.exceptionTrends);
router.get("/workstation-overview", validate(workstationOverviewQuerySchema, "query"), controller.workstationOverview);
router.get("/exceptions", validate(exceptionsQuerySchema, "query"), controller.exceptions);
router.get("/cases/assignees", controller.caseAssignees);
router.get("/cases/:caseKey", validate(caseKeyParamsSchema, "params"), validate(caseDetailQuerySchema, "query"), controller.caseDetail);
router.patch("/cases/:caseKey", validate(caseKeyParamsSchema, "params"), validate(updateCaseSchema), controller.updateCase);
router.post("/cases/:caseKey/comments", validate(caseKeyParamsSchema, "params"), validate(createCaseCommentSchema), controller.addCaseComment);
router.post("/cases/:caseKey/evidence/init", validate(caseKeyParamsSchema, "params"), validate(initCaseEvidenceUploadSchema), controller.initCaseEvidenceUpload);
router.post("/cases/evidence/:evidenceId/confirm", validate(evidenceIdParamsSchema, "params"), validate(confirmCaseEvidenceUploadSchema), controller.confirmCaseEvidenceUpload);
router.get("/cases/evidence/:evidenceId/download", validate(evidenceIdParamsSchema, "params"), controller.downloadCaseEvidence);
router.get("/journals", validate(journalsQuerySchema, "query"), controller.journals);
router.get("/journals/:id", validate(journalDetailParamsSchema, "params"), controller.journalDetail);
router.get("/audit-logs", validate(auditLogsQuerySchema, "query"), controller.auditLogs);
router.get("/reports/trial-balance.csv", validate(auditorReportQuerySchema, "query"), controller.trialBalanceCsv);
router.get("/reports/loan-aging.csv", validate(auditorReportQuerySchema, "query"), controller.loanAgingCsv);
router.get("/reports/par.csv", validate(auditorReportQuerySchema, "query"), controller.parCsv);
router.get("/reports/dividends-register.csv", validate(auditorReportQuerySchema, "query"), controller.dividendsRegisterCsv);

module.exports = router;
