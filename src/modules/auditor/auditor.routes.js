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
    auditLogsQuerySchema,
    auditorReportQuerySchema
} = require("./auditor.schemas");

const router = express.Router();

router.use(auth, authorize([ROLES.AUDITOR], { allowInternalOps: false }));

router.get("/summary", validate(summaryQuerySchema, "query"), controller.summary);
router.get("/exceptions", validate(exceptionsQuerySchema, "query"), controller.exceptions);
router.get("/journals", validate(journalsQuerySchema, "query"), controller.journals);
router.get("/journals/:id", validate(journalDetailParamsSchema, "params"), controller.journalDetail);
router.get("/audit-logs", validate(auditLogsQuerySchema, "query"), controller.auditLogs);
router.get("/reports/trial-balance.csv", validate(auditorReportQuerySchema, "query"), controller.trialBalanceCsv);
router.get("/reports/loan-aging.csv", validate(auditorReportQuerySchema, "query"), controller.loanAgingCsv);
router.get("/reports/par.csv", validate(auditorReportQuerySchema, "query"), controller.parCsv);
router.get("/reports/dividends-register.csv", validate(auditorReportQuerySchema, "query"), controller.dividendsRegisterCsv);

module.exports = router;
