const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const requireFeature = require("../../middleware/require-feature");
const idempotency = require("../../middleware/idempotency");
const requireSubscription = require("../../middleware/require-subscription");
const validate = require("../../middleware/validate");
const { ROLES } = require("../../constants/roles");
const controller = require("./finance.controller");
const {
    accrualSchema,
    closePeriodSchema,
    depositSchema,
    dividendAllocationSchema,
    ledgerQuerySchema,
    loanDisburseSchema,
    loanQuerySchema,
    loanRepaySchema,
    shareContributionSchema,
    statementQuerySchema,
    transferSchema,
    withdrawSchema
} = require("./finance.schemas");

const router = express.Router();

router.use(auth, requireSubscription());

router.post("/deposit", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TELLER], { allowInternalOps: false }), validate(depositSchema), idempotency, controller.deposit);
router.post("/withdraw", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TELLER], { allowInternalOps: false }), validate(withdrawSchema), idempotency, controller.withdraw);
router.post("/share-contribution", authorize([ROLES.SUPER_ADMIN, ROLES.TELLER], { allowInternalOps: false }), requireFeature("contributions_enabled"), validate(shareContributionSchema), idempotency, controller.shareContribution);
router.post("/dividend-allocation", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), requireFeature("dividends_enabled"), validate(dividendAllocationSchema), controller.dividendAllocation);
router.post("/transfer", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TELLER], { allowInternalOps: false }), validate(transferSchema), idempotency, controller.transfer);
router.post("/loan/disburse", authorize([ROLES.LOAN_OFFICER, ROLES.TELLER], { allowInternalOps: false }), requireFeature("loans_enabled"), validate(loanDisburseSchema), idempotency, controller.loanDisburse);
router.post("/loan/repay", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER], { allowInternalOps: false }), requireFeature("loans_enabled"), validate(loanRepaySchema), idempotency, controller.loanRepay);
router.post("/interest-accrual", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(accrualSchema), controller.accrueInterest);
router.post("/close-period", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(closePeriodSchema), controller.closePeriod);
router.get("/loan/portfolio", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), requireFeature("loans_enabled"), validate(loanQuerySchema, "query"), controller.getLoans);
router.get("/loan/schedules", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), requireFeature("loans_enabled"), validate(loanQuerySchema, "query"), controller.getLoanSchedules);
router.get("/loan/transactions", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), requireFeature("loans_enabled"), validate(loanQuerySchema, "query"), controller.getLoanTransactions);
router.get("/statements", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), validate(statementQuerySchema, "query"), controller.getStatements);
router.get("/ledger", authorize([ROLES.SUPER_ADMIN, ROLES.AUDITOR], { allowInternalOps: false }), validate(ledgerQuerySchema, "query"), controller.getLedger);

module.exports = router;
