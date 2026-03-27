const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./reports.controller");
const { exportSchema, chargeRevenueSummarySchema, exportJobParamSchema, exportJobsQuerySchema } = require("./reports.schemas");

const router = express.Router();

router.use(auth);

router.get(
    "/export-jobs",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportJobsQuerySchema, "query"),
    controller.listExportJobs
);
router.get(
    "/export-jobs/:jobId",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportJobParamSchema, "params"),
    controller.getExportJob
);
router.get(
    "/export-jobs/:jobId/download",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportJobParamSchema, "params"),
    controller.getExportJobDownload
);

router.get(
    "/charge-revenue/summary",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(chargeRevenueSummarySchema, "query"),
    controller.chargeRevenueSummary
);
router.get(
    "/revenue/summary",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(chargeRevenueSummarySchema, "query"),
    controller.chargeRevenueSummary
);

router.get(
    "/member-statements/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.memberStatement
);
router.get(
    "/trial-balance/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.trialBalance
);
router.get(
    "/balance-sheet/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.balanceSheet
);
router.get(
    "/income-statement/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.incomeStatement
);
router.get(
    "/cash-position/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.cashPosition
);
router.get(
    "/par/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.par
);
router.get(
    "/loan-aging/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.loanAging
);
router.get(
    "/loan-portfolio-summary/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.loanPortfolioSummary
);
router.get(
    "/member-balances-summary/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.memberBalancesSummary
);
router.get(
    "/audit-exceptions/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.auditExceptions
);
router.get(
    "/audit-evidence-pack/export",
    authorize([ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.auditEvidencePack
);

module.exports = router;
