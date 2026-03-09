const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireFeature = require("../../middleware/require-feature");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./reports.controller");
const { exportSchema, exportJobParamSchema } = require("./reports.schemas");

const router = express.Router();

router.use(auth, requireSubscription());

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
    "/member-statements/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(exportSchema, "query"),
    controller.memberStatement
);
router.get(
    "/trial-balance/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    requireFeature("advanced_reports"),
    validate(exportSchema, "query"),
    controller.trialBalance
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
    requireFeature("advanced_reports"),
    validate(exportSchema, "query"),
    controller.par
);
router.get(
    "/loan-aging/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    requireFeature("advanced_reports"),
    validate(exportSchema, "query"),
    controller.loanAging
);
router.get(
    "/loan-portfolio-summary/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    requireFeature("advanced_reports"),
    validate(exportSchema, "query"),
    controller.loanPortfolioSummary
);
router.get(
    "/member-balances-summary/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    requireFeature("advanced_reports"),
    validate(exportSchema, "query"),
    controller.memberBalancesSummary
);
router.get(
    "/audit-exceptions/export",
    authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    requireFeature("advanced_reports"),
    validate(exportSchema, "query"),
    controller.auditExceptions
);

module.exports = router;
