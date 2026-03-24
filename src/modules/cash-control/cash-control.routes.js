const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./cash-control.controller");
const schemas = require("./cash-control.schemas");

const router = express.Router();

router.use(auth);

router.get(
    "/sessions",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.sessionQuerySchema, "query"),
    controller.listSessions
);
router.get(
    "/sessions/current",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.currentSession
);
router.post(
    "/sessions/open",
    authorize([ROLES.TELLER], { allowInternalOps: false }),
    validate(schemas.openSessionSchema),
    controller.openSession
);
router.post(
    "/sessions/:id/close",
    authorize([ROLES.TELLER, ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.closeSessionSchema),
    controller.closeSession
);
router.post(
    "/sessions/:id/review",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.reviewSessionSchema),
    controller.reviewSession
);

router.get(
    "/receipt-policy",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.getReceiptPolicy
);
router.put(
    "/receipt-policy",
    authorize([ROLES.BRANCH_MANAGER], { allowInternalOps: false }),
    validate(schemas.receiptPolicySchema),
    controller.updateReceiptPolicy
);

router.post(
    "/receipts/init",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.receiptInitSchema),
    controller.initReceiptUpload
);
router.post(
    "/receipts/:id/confirm",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.LOAN_OFFICER], { allowInternalOps: false }),
    validate(schemas.receiptConfirmSchema),
    controller.confirmReceiptUpload
);
router.get(
    "/journals/:journalId/receipts",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.listJournalReceipts
);
router.get(
    "/receipts/:id/download",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.LOAN_OFFICER, ROLES.AUDITOR], { allowInternalOps: false }),
    controller.downloadReceipt
);

router.get(
    "/summary/daily",
    authorize([ROLES.BRANCH_MANAGER, ROLES.TELLER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.summaryQuerySchema, "query"),
    controller.dailySummary
);
router.get(
    "/reports/daily-cashbook.csv",
    authorize([ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.summaryQuerySchema, "query"),
    controller.dailyCashbookCsv
);
router.get(
    "/reports/teller-balancing.csv",
    authorize([ROLES.BRANCH_MANAGER, ROLES.AUDITOR], { allowInternalOps: false }),
    validate(schemas.summaryQuerySchema, "query"),
    controller.tellerBalancingCsv
);

module.exports = router;
