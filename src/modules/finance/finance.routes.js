const express = require("express");

const auth = require("../../middleware/auth");
const authorize = require("../../middleware/authorize");
const idempotency = require("../../middleware/idempotency");
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

router.use(auth);

router.post("/deposit", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TELLER], { allowInternalOps: false }), validate(depositSchema), idempotency, controller.deposit);
router.post("/withdraw", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TELLER], { allowInternalOps: false }), validate(withdrawSchema), idempotency, controller.withdraw);
router.post("/share-contribution", authorize([ROLES.SUPER_ADMIN, ROLES.TELLER], { allowInternalOps: false }), validate(shareContributionSchema), idempotency, controller.shareContribution);
router.post("/dividend-allocation", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(dividendAllocationSchema), idempotency, controller.dividendAllocation);
router.post("/transfer", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.TELLER], { allowInternalOps: false }), validate(transferSchema), idempotency, controller.transfer);
router.post("/loan/disburse", authorize([ROLES.LOAN_OFFICER, ROLES.TELLER], { allowInternalOps: false }), validate(loanDisburseSchema), idempotency, controller.loanDisburse);
router.post("/loan/repay", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER], { allowInternalOps: false }), validate(loanRepaySchema), idempotency, controller.loanRepay);
router.post("/interest-accrual", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(accrualSchema), idempotency, controller.accrueInterest);
router.post("/close-period", authorize([ROLES.SUPER_ADMIN], { allowInternalOps: false }), validate(closePeriodSchema), idempotency, controller.closePeriod);
router.get("/loan/portfolio", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), validate(loanQuerySchema, "query"), controller.getLoans);
router.get("/loan/schedules", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), validate(loanQuerySchema, "query"), controller.getLoanSchedules);
router.get("/loan/transactions", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), validate(loanQuerySchema, "query"), controller.getLoanTransactions);
router.get("/statements", authorize([ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR, ROLES.MEMBER], { allowInternalOps: false }), validate(statementQuerySchema, "query"), controller.getStatements);
router.get("/ledger", authorize([ROLES.SUPER_ADMIN, ROLES.AUDITOR], { allowInternalOps: false }), validate(ledgerQuerySchema, "query"), controller.getLedger);

module.exports = router;
